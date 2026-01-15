import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAccount,
  useChainId,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { Flame, PlusCircle } from 'lucide-react';
import { isAddress, formatUnits, pad, parseUnits, stringToHex } from 'viem';
import { useSearchParams } from 'react-router-dom';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { ABIS } from '@/contracts/abis';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { parseContractError } from '@/utils/errorParser';
import { cn } from '@/lib/utils';
import { addRecentToken } from '@/lib/recentTokens';
import { useI18n } from '@/lib/i18n';

type Address = `0x${string}`;

function parseMemo(rawInput: string) {
  const raw = rawInput.trim();
  if (!raw) return { bytes32: undefined as undefined | `0x${string}`, errorKey: null as string | null };
  const looksLikeBytes32 = /^0x[0-9a-fA-F]{64}$/.test(raw);
  if (looksLikeBytes32) return { bytes32: raw as `0x${string}`, errorKey: null as string | null };

  try {
    const bytes32 = pad(stringToHex(raw), { size: 32 });
    return { bytes32, errorKey: null as string | null };
  } catch {
    return {
      bytes32: undefined,
      errorKey: 'issuance.mintburn.memoInvalid',
    };
  }
}

function getErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in (err as Record<string, unknown>)) {
    const message = (err as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function MintBurnPanel() {
  const { t } = useI18n();
  const chainId = useChainId();
  const isTempo = chainId === tempoTestnet.id;
  const explorerBaseUrl = tempoTestnet.blockExplorers?.default?.url;
  const { address, isConnected } = useAccount();
  const [searchParams] = useSearchParams();

  const savedTxHashesRef = useRef<Set<string>>(new Set());

  const token = (searchParams.get('token') ?? '').trim();
  const tokenAddress = isAddress(token) ? (token as Address) : null;

  const { data: symbol } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'symbol',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const { data: decimals } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'decimals',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const balanceRead = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'balanceOf',
    args: address && tokenAddress ? [address] : undefined,
    query: { enabled: Boolean(isTempo && tokenAddress && address) },
  });

  const balance = balanceRead.data;
  const refetchBalance = balanceRead.refetch;

  const { data: paused } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'paused',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const totalSupplyRead = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'totalSupply',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });

  const totalSupply = totalSupplyRead.data;
  const refetchTotalSupply = totalSupplyRead.refetch;
  const { data: supplyCap } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'supplyCap',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });

  const {
    data: issuerRole,
    isLoading: issuerRoleLoading,
    error: issuerRoleError,
  } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'ISSUER_ROLE',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const hasIssuerRoleRead = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'hasRole',
    args: issuerRole && address && tokenAddress ? [address, issuerRole] : undefined,
    // Some Tempo contracts / RPC nodes appear to revert role reads when `from` is the zero address.
    // Using the connected wallet as the call's `from` matches how preflight (simulation) is executed.
    account: address,
    query: { enabled: Boolean(isTempo && tokenAddress && issuerRole && address) },
  });

  const {
    data: hasIssuerRole,
    isLoading: hasIssuerRoleLoading,
    error: hasIssuerRoleError,
  } = hasIssuerRoleRead;
  const refetchHasIssuerRole = hasIssuerRoleRead.refetch;

  const d = typeof decimals === 'number' ? decimals : 6;
  const symbolText = typeof symbol === 'string' ? symbol : 'TOKEN';

  const issuerRoleKnown = typeof hasIssuerRole === 'boolean';
  const issuerOk = hasIssuerRole === true;

  const roleReadError = issuerRoleError ?? hasIssuerRoleError;
  const roleReadErrorMessage = getErrorMessage(roleReadError);

  const [mintTo, setMintTo] = useState<string>('');
  const [mintAmount, setMintAmount] = useState<string>('');
  const [mintMemo, setMintMemo] = useState<string>('');
  const mintMemoParsed = useMemo(() => parseMemo(mintMemo), [mintMemo]);

  const mintToResolved = (mintTo.trim().length ? mintTo.trim() : address) as Address | undefined;
  const mintToValid = Boolean(mintToResolved && isAddress(mintToResolved));

  const mintValue = useMemo(() => {
    try {
      if (!mintAmount.trim().length) return null;
      return parseUnits(mintAmount, d);
    } catch {
      return null;
    }
  }, [mintAmount, d]);

  const willExceedCap = useMemo(() => {
    if (typeof supplyCap !== 'bigint') return false;
    if (typeof totalSupply !== 'bigint') return false;
    if (typeof mintValue !== 'bigint') return false;
    return totalSupply + mintValue > supplyCap;
  }, [supplyCap, totalSupply, mintValue]);

  const [burnAmount, setBurnAmount] = useState<string>('');
  const [burnMemo, setBurnMemo] = useState<string>('');
  const burnMemoParsed = useMemo(() => parseMemo(burnMemo), [burnMemo]);

  const {
    data: mintHash,
    writeContract: writeMint,
    isPending: isMintPending,
    error: mintError,
  } = useWriteContract();
  const mintReceipt = useWaitForTransactionReceipt({ hash: mintHash });

  const {
    data: burnHash,
    writeContract: writeBurn,
    isPending: isBurnPending,
    error: burnError,
  } = useWriteContract();
  const burnReceipt = useWaitForTransactionReceipt({ hash: burnHash });

  useEffect(() => {
    if (mintReceipt.isSuccess) {
      void refetchBalance();
      void refetchTotalSupply();
      void refetchHasIssuerRole();
    }
  }, [mintReceipt.isSuccess, refetchBalance, refetchHasIssuerRole, refetchTotalSupply]);

  useEffect(() => {
    if (burnReceipt.isSuccess) {
      void refetchBalance();
      void refetchTotalSupply();
    }
  }, [burnReceipt.isSuccess, refetchBalance, refetchTotalSupply]);

  useEffect(() => {
    if (!chainId || !address || !tokenAddress) return;

    const mintTx = mintReceipt.data?.transactionHash;
    if (mintTx && !savedTxHashesRef.current.has(mintTx)) {
      addRecentToken(chainId, address, tokenAddress);
      savedTxHashesRef.current.add(mintTx);
    }

    const burnTx = burnReceipt.data?.transactionHash;
    if (burnTx && !savedTxHashesRef.current.has(burnTx)) {
      addRecentToken(chainId, address, tokenAddress);
      savedTxHashesRef.current.add(burnTx);
    }
  }, [address, burnReceipt.data?.transactionHash, chainId, mintReceipt.data?.transactionHash, tokenAddress]);

  const mintPreflight = useSimulateContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: (mintMemoParsed.bytes32 ? 'mintWithMemo' : 'mint') as 'mint' | 'mintWithMemo',
    args:
      tokenAddress && address && mintToResolved && mintToValid && mintValue && !mintMemoParsed.errorKey
        ? (mintMemoParsed.bytes32
            ? [mintToResolved, mintValue, mintMemoParsed.bytes32]
            : [mintToResolved, mintValue])
        : undefined,
    account: address,
    query: {
      enabled: Boolean(isConnected && isTempo && tokenAddress && address && mintToValid && mintValue && !mintMemoParsed.errorKey),
    },
  });

  const canMint =
    Boolean(
      isConnected &&
        isTempo &&
        tokenAddress &&
        mintToValid &&
        mintValue &&
        !mintMemoParsed.errorKey &&
        mintPreflight.isSuccess,
    ) && !isMintPending;

  const canBurn =
    Boolean(isConnected && isTempo && tokenAddress && burnAmount.trim().length > 0 && !burnMemoParsed.errorKey) &&
    !isBurnPending;

  const mintStatusText = isMintPending
    ? t('common.submitting')
    : mintReceipt.isLoading
      ? t('common.confirming')
      : mintReceipt.isSuccess
        ? t('common.confirmed')
        : mintHash
          ? t('common.submitted')
          : '—';

  const burnStatusText = isBurnPending
    ? t('common.submitting')
    : burnReceipt.isLoading
      ? t('common.confirming')
      : burnReceipt.isSuccess
        ? t('common.confirmed')
        : burnHash
          ? t('common.submitted')
          : '—';

  const submitMint = async () => {
    if (!tokenAddress) return;
    const to = mintToResolved;
    if (!to || !isAddress(to)) return;
    if (!mintAmount.trim().length) return;
    const value = parseUnits(mintAmount, d);

    if (mintMemoParsed.bytes32) {
      writeMint({
        address: tokenAddress,
        abi: ABIS.TIP20Token,
        functionName: 'mintWithMemo',
        args: [to, value, mintMemoParsed.bytes32],
      });
      return;
    }

    writeMint({
      address: tokenAddress,
      abi: ABIS.TIP20Token,
      functionName: 'mint',
      args: [to, value],
    });
  };

  const submitBurn = async () => {
    if (!tokenAddress) return;
    const value = parseUnits(burnAmount, d);
    if (burnMemoParsed.bytes32) {
      writeBurn({
        address: tokenAddress,
        abi: ABIS.TIP20Token,
        functionName: 'burnWithMemo',
        args: [value, burnMemoParsed.bytes32],
      });
      return;
    }

    writeBurn({
      address: tokenAddress,
      abi: ABIS.TIP20Token,
      functionName: 'burn',
      args: [value],
    });
  };

  if (!tokenAddress) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {t('issuance.mintburn.enterAddress')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">{t('issuance.mintburn.token')}</h2>
            <div className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-400">{tokenAddress}</div>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {t('issuance.mintburn.balance')}{' '}
            <span className="font-mono">
              {typeof balance === 'bigint' ? `${formatUnits(balance, d)} ${symbolText}` : '—'}
            </span>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.mintburn.issuerRole')}{' '}
          {issuerRoleLoading || hasIssuerRoleLoading
            ? t('common.checking')
            : typeof hasIssuerRole === 'boolean'
              ? hasIssuerRole
                ? t('common.yes')
                : t('common.no')
              : issuerRoleError || hasIssuerRoleError
                ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-red-700 dark:text-red-300">{t('common.error')}</span>
                      {roleReadErrorMessage ? (
                        <details>
                          <summary className="cursor-pointer text-xs opacity-90">{t('common.details')}</summary>
                          <div className="mt-2 max-w-[72ch] break-words font-mono text-[11px] opacity-90">
                            {roleReadErrorMessage}
                          </div>
                        </details>
                      ) : null}
                    </span>
                  )
                : '—'}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
          <div>
            {t('issuance.mintburn.paused')}{' '}
            {typeof paused === 'boolean' ? (
              paused ? (
                <span className="text-red-700 dark:text-red-300">{t('common.yes')}</span>
              ) : (
                <span className="text-green-700 dark:text-green-300">{t('common.no')}</span>
              )
            ) : (
              '—'
            )}
          </div>
          <div>
            {t('issuance.mintburn.supply')}{' '}
            <span className="font-mono">
              {typeof totalSupply === 'bigint' ? `${formatUnits(totalSupply, d)} / ` : '— / '}
              {typeof supplyCap === 'bigint' ? formatUnits(supplyCap, d) : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-[#66D121]" />
            <h3 className="text-lg font-bold">{t('issuance.mintburn.mintTitle')}</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium">{t('issuance.mintburn.toOptional')}</label>
              <Input
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                placeholder={address ?? '0x...'}
                className={cn('mt-2 font-mono', mintTo.trim().length === 0 || isAddress(mintTo) ? '' : 'border-red-400')}
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.mintburn.toHelp')}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium">{t('issuance.mintburn.amount')}</label>
              <Input value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} placeholder="100" className="mt-2" />
            </div>
            <div>
              <label className="block text-sm font-medium">{t('issuance.mintburn.memoOptional')}</label>
              <Input
                value={mintMemo}
                onChange={(e) => setMintMemo(e.target.value)}
                placeholder={t('issuance.mintburn.memoPlaceholder')}
                className="mt-2"
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.mintburn.memoHelp')}
              </p>
              {mintMemoParsed.errorKey ? (
                <p className="mt-1 text-xs text-red-600">{t(mintMemoParsed.errorKey)}</p>
              ) : null}
            </div>

            {!issuerRoleKnown && !roleReadError ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
                {t('issuance.mintburn.checkingPermissions')}
              </div>
            ) : null}

            {roleReadError ? (
              <div
                className={cn(
                  'rounded-lg border p-3 text-sm',
                  mintPreflight.isSuccess
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-200'
                    : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200',
                )}
              >
                {mintPreflight.isSuccess
                  ? t('issuance.mintburn.roleCheckFailedPreflightOk')
                  : t('issuance.mintburn.roleCheckFailed')}
                {roleReadErrorMessage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs opacity-90">{t('common.details')}</summary>
                    <div className="mt-2 break-words font-mono text-xs opacity-90">{roleReadErrorMessage}</div>
                  </details>
                ) : null}
              </div>
            ) : null}

            {typeof paused === 'boolean' && paused ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {t('issuance.mintburn.tokenPaused')}
              </div>
            ) : null}

            {willExceedCap ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {t('issuance.mintburn.exceedsCap')}
              </div>
            ) : null}

            {mintPreflight.isFetching ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
                {t('issuance.mintburn.preflightChecking')}
              </div>
            ) : null}

            {mintPreflight.isError && mintPreflight.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {t('issuance.mintburn.preflightFailed')}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-90">{t('common.details')}</summary>
                  <div className="mt-2 break-words font-mono text-xs opacity-90">
                    {getErrorMessage(mintPreflight.error)}
                  </div>
                </details>
              </div>
            ) : null}

            {mintPreflight.isSuccess ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-200">
                {t('issuance.mintburn.preflightOk')}
              </div>
            ) : null}

            {issuerRoleKnown && !issuerOk ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-200">
                {t('issuance.mintburn.noIssuerRole')}
              </div>
            ) : null}

            {mintError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {parseContractError(mintError)}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-90">{t('common.details')}</summary>
                  <div className="mt-2 break-words font-mono text-xs opacity-90">
                    {String((mintError as { message?: unknown } | null)?.message ?? mintError ?? '')}
                  </div>
                </details>
              </div>
            ) : null}

            {mintReceipt.isError && mintReceipt.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {parseContractError(mintReceipt.error)}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs opacity-90">{t('common.details')}</summary>
                  <div className="mt-2 break-words font-mono text-xs opacity-90">
                    {String((mintReceipt.error as { message?: unknown } | null)?.message ?? mintReceipt.error ?? '')}
                  </div>
                </details>
              </div>
            ) : null}

            <Button type="button" onClick={submitMint} disabled={!canMint} className="w-full">
              {isMintPending ? t('common.submitting') : t('issuance.mintburn.mintButton')}
            </Button>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.mintburn.requiresRoleStatus', {
                status: mintStatusText,
              })}
            </p>

            {mintHash && explorerBaseUrl ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <a
                  className="font-mono text-[#2F6E0C] underline underline-offset-2 hover:opacity-90 dark:text-[#66D121]"
                  href={`${explorerBaseUrl}/tx/${mintHash}`}
                  target="_blank"
                  rel="noreferrer"
                  title={mintHash}
                >
                  {t('page.transfer.viewTxOnExplorer')}
                </a>
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <Flame className="h-5 w-5 text-red-500" />
            <h3 className="text-lg font-bold">{t('issuance.mintburn.burnTitle')}</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium">{t('issuance.mintburn.amount')}</label>
              <Input value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} placeholder="10" className="mt-2" />
            </div>
            <div>
              <label className="block text-sm font-medium">{t('issuance.mintburn.memoOptional')}</label>
              <Input
                value={burnMemo}
                onChange={(e) => setBurnMemo(e.target.value)}
                placeholder={t('issuance.mintburn.memoPlaceholder')}
                className="mt-2"
              />
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.mintburn.memoHelp')}
              </p>
              {burnMemoParsed.errorKey ? (
                <p className="mt-1 text-xs text-red-600">{t(burnMemoParsed.errorKey)}</p>
              ) : null}
            </div>

            {burnError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {parseContractError(burnError)}
              </div>
            ) : null}

            <Button type="button" onClick={submitBurn} disabled={!canBurn} className="w-full" tone="red">
              {isBurnPending ? t('common.submitting') : t('issuance.mintburn.burnButton')}
            </Button>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.mintburn.burnStatus', {
                status: burnStatusText,
              })}
            </p>

            {burnHash && explorerBaseUrl ? (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <a
                  className="font-mono text-[#2F6E0C] underline underline-offset-2 hover:opacity-90 dark:text-[#66D121]"
                  href={`${explorerBaseUrl}/tx/${burnHash}`}
                  target="_blank"
                  rel="noreferrer"
                  title={burnHash}
                >
                  {t('page.transfer.viewTxOnExplorer')}
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
