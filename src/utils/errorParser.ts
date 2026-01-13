import { decodeErrorResult, type Abi } from 'viem';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function getNested(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function getNestedString(value: unknown, path: string[]): string | null {
  const v = getNested(value, path);
  return typeof v === 'string' ? v : null;
}

const BUILTIN_REVERT_ABI = [
  {
    type: 'error',
    name: 'Error',
    inputs: [{ name: 'message', type: 'string' }],
  },
  {
    type: 'error',
    name: 'Panic',
    inputs: [{ name: 'code', type: 'uint256' }],
  },
] as const satisfies Abi;

function findRevertDataHex(err: unknown): `0x${string}` | null {
  const candidates: unknown[] = [
    getNested(err, ['data']),
    getNested(err, ['data', 'data']),
    getNested(err, ['cause', 'data']),
    getNested(err, ['cause', 'data', 'data']),
    getNested(err, ['cause', 'error', 'data']),
    getNested(err, ['cause', 'error', 'data', 'data']),
    getNested(err, ['error', 'data']),
    getNested(err, ['error', 'data', 'data']),
    getNested(err, ['cause', 'cause', 'data']),
    getNested(err, ['cause', 'cause', 'data', 'data']),
  ];

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    if (!c.startsWith('0x')) continue;
    // Needs at least a 4-byte selector.
    if (c.length < 10) continue;
    return c as `0x${string}`;
  }
  return null;
}

function decodeBuiltinRevert(data: `0x${string}`): string | null {
  try {
    const decoded = decodeErrorResult({ abi: BUILTIN_REVERT_ABI, data }) as unknown as {
      errorName?: string;
      args?: readonly unknown[];
    };
    if (decoded.errorName === 'Error') {
      const msg = String(decoded.args?.[0] ?? '').trim();
      return msg ? msg : null;
    }
    if (decoded.errorName === 'Panic') {
      const code = decoded.args?.[0];
      const hex = typeof code === 'bigint' ? `0x${code.toString(16)}` : String(code ?? '').trim();
      return hex ? `Panic (${hex})` : 'Panic';
    }
    return decoded.errorName || null;
  } catch {
    return null;
  }
}

export function parseContractError(error: unknown): string {
  const message =
    getNestedString(error, ['shortMessage']) ??
    getNestedString(error, ['message']) ??
    getNestedString(error, ['details']) ??
    String(error ?? '');

  // viem/wagmi + MetaMask often wrap revert details in nested objects.
  // Try to pull out the most specific hint we can find.
  const nestedMessage =
    getNestedString(error, ['cause', 'shortMessage']) ||
    getNestedString(error, ['cause', 'message']) ||
    getNestedString(error, ['data', 'message']) ||
    getNestedString(error, ['error', 'message']) ||
    null;
  const combined = nestedMessage ? `${message}\n${nestedMessage}` : message;
  const combinedLower = combined.toLowerCase();
  const combinedTrimmed = combined.trim();
  const combinedTrimmedLower = combinedTrimmed.toLowerCase();

  // If we have raw revert data, try to decode a concrete revert string even when
  // wallet/RPC surfaces an empty message.
  const revertData = findRevertDataHex(error);
  const decodedBuiltin = revertData ? decodeBuiltinRevert(revertData) : null;

  const selectorMatch = combined.match(/0x[0-9a-fA-F]{8}/);
  const selector = selectorMatch ? selectorMatch[0].toLowerCase() : null;

  // Some providers return a helpful sentence with only a selector.
  // Example: The contract function "mint" reverted with the following signature: 0x........
  const signatureMatch = combined.match(/reverted with the following signature:\s*(0x[0-9a-fA-F]{8})/i);
  const signature = signatureMatch?.[1]?.toLowerCase() ?? null;

  const code = (signature ?? selector)?.toLowerCase() ?? null;

  const noReasonFallback = () => {
    const suffix = selector ? ` (selector: ${selector})` : '';
    const lookup = selector ? `\nSelector lookup: https://openchain.xyz/signatures?query=${selector}` : '';
    return `Transaction reverted but the node/wallet did not provide a reason (RPC returned no revert details). Common causes: missing role/permission, insufficient balance/allowance, wrong network, or a contract rule failing.${suffix}${lookup}`;
  };

  // Exact/ending placeholder with no actual reason.
  if (
    combinedTrimmedLower === 'with the following reason:' ||
    combinedTrimmedLower === 'with the following reason' ||
    /with the following reason:?\s*$/.test(combinedTrimmedLower)
  ) {
    return decodedBuiltin ?? noReasonFallback();
  }

  // Map known selectors FIRST (even when RPC only provides a signature selector).
  // Tempo Issuance (TIP-20 stablecoin) custom errors may show up as raw selectors
  // when the ABI doesn't include those error definitions.
  // Known selectors (computed as keccak256("ErrorName(...)").slice(0,4)):
  // - Unauthorized()         -> 0x82b42900
  // - SupplyCapExceeded()    -> 0xf58f733a
  // - IssuerRoleRequired()   -> 0x13978a83
  // - NotIssuer()            -> 0x54ec5063
  if (code === '0x82b42900' || combinedLower.includes('unauthorized()')) {
    return 'Unauthorized — missing permission (often ISSUER_ROLE)';
  }
  if (code === '0xf58f733a' || combinedLower.includes('supplycapexceeded')) {
    return 'SupplyCapExceeded — total supply would exceed the cap';
  }
  if (code === '0x13978a83' || combinedLower.includes('issuerrolerequired')) {
    return 'ISSUER_ROLE required — mint/burn requires issuer role';
  }
  if (code === '0x54ec5063' || combinedLower.includes('notissuer')) {
    return 'NotIssuer — mint/burn requires issuer role';
  }
  if (code === '0xaa4bc69a') {
    return 'FeeManager liquidity error (0xaa4bc69a).\nMost common cause on Tempo: the pool is 0/0 and initialization must be validator-token-only.\nFix: set the user-token amount to 0 and mint with validator token only.\nIf you still see this, verify allowances/balances and that your wallet/RPC is not trying to pay tx fees using the chosen custom token.\nSelector lookup: https://openchain.xyz/signatures?query=0xaa4bc69a';
  }
  if (code === '0xbb55fd27') {
    return 'InsufficientLiquidity (0xbb55fd27) — this wallet has 0 burnable liquidity for this pool.\nNote: burn() takes the raw liquidity uint256 minted to the provider, not token amounts.';
  }

  if (signature) {
    return `Contract reverted with a custom error (selector: ${signature}). The ABI in this app does not include the error definition, so it cannot be decoded here.\nSelector lookup: https://openchain.xyz/signatures?query=${signature}`;
  }

  // Some providers return: "...with the following reason" (optionally with :) but omit the reason.
  if (combinedLower.includes('with the following reason')) {
    const m = combined.match(/with the following reason:?\s*(.*)$/i);
    const reason = (m?.[1] ?? '').trim();
    if (!reason) return decodedBuiltin ?? noReasonFallback();
  }

  // (Known selector handling moved earlier to work with signature-only errors.)

  if (combinedLower.includes('transfer amount exceeds balance')) return 'Insufficient balance';
  if (combinedLower.includes('insufficient balance')) return 'Insufficient balance';
  if (combinedLower.includes('insufficient funds')) return 'Insufficient funds for gas';
  if (combinedLower.includes('gas required exceeds allowance')) return 'Gas limit too low';

  if (combinedLower.includes('execution reverted')) {
    const match = combined.match(/execution reverted(?::)?\s*(.+)?/i);
    const reason = (match?.[1] ?? '').trim();
    if (!reason) return decodedBuiltin ?? noReasonFallback();
    if (reason.toLowerCase() === 'with the following reason:' || reason.toLowerCase() === 'with the following reason') {
      return decodedBuiltin ?? noReasonFallback();
    }
    return reason;
  }

  if (combinedLower.includes('internal json-rpc error')) {
    // Many nodes mask revert data behind a generic JSON-RPC error.
    // If we managed to decode a revert string, show it; otherwise, show a helpful generic message.
    if (decodedBuiltin) return decodedBuiltin;
    return noReasonFallback();
  }

  // If no useful text but we managed to decode a revert string, show it.
  if (decodedBuiltin) return decodedBuiltin;

  if (message.includes('InsufficientFeeBalance')) return 'Insufficient fee-token balance';
  if (message.includes('InvalidTick')) return 'Invalid price tick';
  if (message.includes('OrderNotFound')) return 'Order not found';

  if (combinedLower.includes('user denied') || combinedLower.includes('rejected')) return 'Transaction rejected by user';
  if (combinedLower.includes('network')) return 'Network error';

  // Last resort: show something rather than a generic message.
  if (combined.trim()) return combined;
  return selector ? `Unexpected error (selector: ${selector})` : 'Unexpected error';
}
