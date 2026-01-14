import { useEffect, useMemo, useState } from 'react';
import { Send, ExternalLink } from 'lucide-react';
import { formatUnits, isAddress, pad, parseUnits, stringToHex, toHex } from 'viem';
import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { markTaskCompleted } from '@/lib/taskProgressStorage';
import { Button } from '@/components/ui/button';
import { ABIS } from '@/contracts/abis';
import { TESTNET_ADDRESSES } from '@/contracts/addresses/testnet';
import { useI18n } from '@/lib/i18n';
import { formatDecimalStringRounded } from '@/utils/formatters';

type AssetKey = 'PathUSD' | 'AlphaUSD' | 'BetaUSD' | 'ThetaUSD';

const GREEN_FOCUS = 'focus:ring-[#66D121]';

const TOKEN_KEYS: AssetKey[] = ['PathUSD', 'AlphaUSD', 'BetaUSD', 'ThetaUSD'];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export default function Transfer() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { t } = useI18n();
  const [asset, setAsset] = useState<AssetKey>('PathUSD');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const isTempo = chainId === tempoTestnet.id;
  const recipientOk = useMemo(() => (recipient.length === 0 ? true : isAddress(recipient)), [recipient]);
  const amountOk = useMemo(() => {
    if (amount.trim().length === 0) return true;
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  }, [amount]);

  const memoParsed = useMemo(() => {
    const raw = memo.trim();
    if (!raw) return { bytes32: undefined as undefined | `0x${string}`, error: null as string | null };

    const looksLikeBytes32 = /^0x[0-9a-fA-F]{64}$/.test(raw);
    if (looksLikeBytes32) return { bytes32: raw as `0x${string}`, error: null as string | null };

    try {
      // Convert short strings into a fixed 32-byte value.
      // If the string is longer than 32 bytes, pad() will throw.
      const bytes32 = pad(stringToHex(raw), { size: 32 });
      return { bytes32, error: null as string | null };
    } catch {
      return {
        bytes32: undefined,
        error: t('page.transfer.memoTooLong'),
      };
    }
  }, [memo, t]);

  const tokenAddress = useMemo(() => {
    const onTempo = TESTNET_ADDRESSES[tempoTestnet.id as keyof typeof TESTNET_ADDRESSES];
    return onTempo?.[asset];
  }, [asset]);

  const tokenAddresses = useMemo(() => {
    const onTempo = TESTNET_ADDRESSES[tempoTestnet.id as keyof typeof TESTNET_ADDRESSES];
    if (!onTempo) return [] as Array<{ key: Exclude<AssetKey, 'native'>; address: `0x${string}` }>;
    return TOKEN_KEYS.map((key) => ({ key, address: onTempo[key] }));
  }, []);

  const tokenBalanceContracts = useMemo(() => {
    if (!address || tokenAddresses.length === 0) return [];
    return tokenAddresses.flatMap((t) => [
      { abi: ERC20_ABI, address: t.address, functionName: 'decimals' as const },
      { abi: ERC20_ABI, address: t.address, functionName: 'balanceOf' as const, args: [address] as const },
    ]);
  }, [address, tokenAddresses]);

  const tokenBalancesQuery = useReadContracts({
    contracts: tokenBalanceContracts,
    allowFailure: true,
    query: { enabled: Boolean(isTempo && address && tokenAddresses.length > 0), refetchInterval: 15_000 },
  });

  const balances = useMemo(() => {
    const map: Partial<
      Record<
        AssetKey,
        {
          raw: bigint;
          decimals: number;
          formatted: string;
          displayFormatted: string;
          symbol: string;
          tokenAddress?: `0x${string}`;
        }
      >
    > = {};

    for (let i = 0; i < tokenAddresses.length; i++) {
      const decimalsResult = tokenBalancesQuery.data?.[i * 2]?.result;
      const balanceResult = tokenBalancesQuery.data?.[i * 2 + 1]?.result;
      const decimals = typeof decimalsResult === 'number' ? decimalsResult : 6;
      const raw = typeof balanceResult === 'bigint' ? balanceResult : 0n;
      const formatted = formatUnits(raw, decimals);
      map[tokenAddresses[i].key] = {
        raw,
        decimals,
        formatted,
        displayFormatted: formatDecimalStringRounded(formatted, { fractionDigits: 2, groupSeparator: ',' }),
        symbol: tokenAddresses[i].key,
        tokenAddress: tokenAddresses[i].address,
      };
    }

    return map;
  }, [tokenAddresses, tokenBalancesQuery.data]);

  const selectedBalance = balances[asset];

  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: ABIS.TIP20Token,
    functionName: 'decimals',
    query: {
      enabled: Boolean(isTempo && tokenAddress),
    },
  });

  const {
    data: tokenHash,
    writeContract,
    isPending: isTokenPending,
    error: tokenError,
  } = useWriteContract();

  const activeHash = tokenHash;
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: activeHash,
  });

  useEffect(() => {
    if (!address) return;
    if (!activeHash) return;
    if (!isConfirmed) return;
    markTaskCompleted(tempoTestnet.id, address, 'make_transfer_daily', { txHash: activeHash });
  }, [address, activeHash, isConfirmed]);

  const submit = async () => {
    if (!isConnected) return;
    if (!isTempo) return;
    if (!isAddress(recipient)) return;
    if (!amountOk || amount.trim().length === 0) return;
    if (memoParsed.error) return;

    if (!tokenAddress) return;
    const decimals = typeof tokenDecimals === 'number' ? tokenDecimals : 18;
    const value = parseUnits(amount, decimals);

    if (memoParsed.bytes32) {
      writeContract({
        address: tokenAddress,
        abi: ABIS.TIP20Token,
        functionName: 'transferWithMemo',
        args: [recipient as `0x${string}`, value, memoParsed.bytes32],
      });
      return;
    }

    writeContract({
      address: tokenAddress,
      abi: ABIS.TIP20Token,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, value],
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('page.transfer.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('page.transfer.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6 flex items-center gap-2">
          <Send className="h-6 w-6 text-[#66D121]" />
          <h2 className="text-xl font-bold">{t('page.transfer.cardTitle')}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">{t('page.transfer.assetLabel')}</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {TOKEN_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  onClick={() => setAsset(key)}
                  variant={asset === key ? 'default' : 'outline'}
                  size="sm"
                  disabled={!isTempo}
                >
                  {key}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{t('page.transfer.assetHelp')}</p>

            {isConnected && selectedBalance ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t('page.transfer.balanceLabel')}:</span>
                  <span className="font-mono">
                    {selectedBalance.displayFormatted} {selectedBalance.symbol}
                  </span>
                  {selectedBalance.tokenAddress ? (
                    <a
                      className="inline-flex items-center gap-1 font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
                      href={`${tempoTestnet.blockExplorers.default.url}/address/${selectedBalance.tokenAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('page.transfer.aria.openTokenOnExplorer')}
                    >
                      {t('page.transfer.tokenLink')}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const formatted = selectedBalance.formatted;
                    setAmount(formatted === '0' ? '' : formatted);
                  }}
                >
                  {t('common.max')}
                </Button>
              </div>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-medium">{t('page.transfer.recipientLabel')}</label>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className={`mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 ${GREEN_FOCUS} dark:border-gray-800 dark:bg-gray-900`}
            />
            {!recipientOk ? (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t('common.invalidAddress')}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-medium">{t('page.transfer.amountLabel')}</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              step="0.000001"
              placeholder="0.00"
              className={`mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 ${GREEN_FOCUS} dark:border-gray-800 dark:bg-gray-900`}
            />
            {!amountOk ? (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t('common.enterValidAmount')}</p>
            ) : null}
          </div>

          <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
            <summary className="cursor-pointer select-none font-semibold">{t('common.advanced')}</summary>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium">{t('page.transfer.memoLabel')}</label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder={t('page.acceptPayment.memoPlaceholder')}
                  className={`mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 ${GREEN_FOCUS} dark:border-gray-800 dark:bg-gray-900`}
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t('page.transfer.memoHelpPrefix')} <span className="font-mono">transferWithMemo</span>.
                </p>
                {memoParsed.error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{memoParsed.error}</p> : null}
                {memoParsed.bytes32 ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t('page.transfer.memoBytes32')}</span>
                      <span className="font-mono break-all">{memoParsed.bytes32}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const bytes = new Uint8Array(32);
                        crypto.getRandomValues(bytes);
                        setMemo(toHex(bytes));
                      }}
                    >
                      {t('common.generate')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </details>

          {!isTempo ? (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              {t('page.common.switchNetworkToContinue', { network: tempoTestnet.name })}
            </div>
          ) : null}

          {tokenError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              {tokenError.message}
            </div>
          ) : null}

          {activeHash ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
              href={`${tempoTestnet.blockExplorers.default.url}/tx/${activeHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.transfer.viewTxOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}

          <Button
            type="button"
            onClick={submit}
            disabled={
              !isConnected ||
              !isTempo ||
              !isAddress(recipient) ||
              amount.trim().length === 0 ||
              !amountOk ||
              Boolean(memoParsed.error) ||
              isTokenPending ||
              isConfirming
            }
            className="w-full"
          >
            {isTokenPending
              ? t('common.submitting')
              : isConfirming
                ? t('common.confirming')
                : isConfirmed
                  ? t('page.transfer.sent')
                  : t('page.transfer.sendAction')}
          </Button>
        </div>
      </div>
    </div>
  );
}
