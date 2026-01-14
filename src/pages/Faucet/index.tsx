import { useMemo } from 'react';
import { Droplet, ExternalLink } from 'lucide-react';
import { useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { TESTNET_ADDRESSES } from '@/contracts/addresses/testnet';
import { Button } from '@/components/ui/button';
import { useFaucet } from '@/hooks/contracts/useFaucet';
import { addRecentToken } from '@/lib/recentTokens';
import { useI18n } from '@/lib/i18n';
import { formatDecimalStringRounded } from '@/utils/formatters';

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

export default function Faucet() {
  const { t } = useI18n();
  const {
    address,
    isConnected,
    isPending,
    lastError,
    txHashes,
    resultText,
    canClaim,
    claimTokens,
  } = useFaucet();

  const buttonLabel = useMemo(() => {
    if (!isConnected) return t('page.faucet.button.connectToClaim');
    if (isPending) return t('page.faucet.button.requesting');
    return t('page.faucet.button.claim');
  }, [isConnected, isPending, t]);

  // txHashes + resultText come from the hook.

  const stablecoins = useMemo(() => {
    const chainAddresses = (TESTNET_ADDRESSES as unknown as Record<
      number,
      {
        PathUSD: `0x${string}`;
        AlphaUSD: `0x${string}`;
        BetaUSD: `0x${string}`;
        ThetaUSD: `0x${string}`;
      }
    >)[tempoTestnet.id];
    if (!chainAddresses) return [] as Array<{ key: string; label: string; address: `0x${string}` }>;
    return [
      { key: 'PathUSD', label: 'pathUSD', address: chainAddresses.PathUSD as `0x${string}` },
      { key: 'AlphaUSD', label: 'AlphaUSD', address: chainAddresses.AlphaUSD as `0x${string}` },
      { key: 'BetaUSD', label: 'BetaUSD', address: chainAddresses.BetaUSD as `0x${string}` },
      { key: 'ThetaUSD', label: 'ThetaUSD', address: chainAddresses.ThetaUSD as `0x${string}` },
    ];
  }, []);

  const balanceContracts = useMemo(() => {
    if (!address) return [];
    return stablecoins.flatMap((token) => [
      {
        abi: ERC20_ABI,
        address: token.address,
        functionName: 'decimals' as const,
      },
      {
        abi: ERC20_ABI,
        address: token.address,
        functionName: 'balanceOf' as const,
        args: [address] as const,
      },
    ]);
  }, [address, stablecoins]);

  const balancesQuery = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: Boolean(address && stablecoins.length > 0),
      refetchInterval: 15_000,
    },
    allowFailure: true,
  });

  const balances = useMemo(() => {
    if (!address || stablecoins.length === 0)
      return [] as Array<{ label: string; value: string; tokenAddress: `0x${string}` }>;

    const rows: Array<{ label: string; value: string; tokenAddress: `0x${string}` }> = [];
    for (let i = 0; i < stablecoins.length; i++) {
      const decimalsResult = balancesQuery.data?.[i * 2]?.result;
      const balanceResult = balancesQuery.data?.[i * 2 + 1]?.result;

      const decimals = typeof decimalsResult === 'number' ? decimalsResult : 6;
      const raw = typeof balanceResult === 'bigint' ? balanceResult : 0n;
      const formatted = formatUnits(raw, decimals);

      rows.push({ label: stablecoins[i].label, value: formatted, tokenAddress: stablecoins[i].address });
    }
    return rows;
  }, [address, stablecoins, balancesQuery.data]);

  const claim = async () => {
    await claimTokens();

    // Make faucet tokens show up under "My Tokens" even without IndexSupply discovery.
    if (address) {
      for (const t of stablecoins) {
        addRecentToken(tempoTestnet.id, address, t.address);
      }
    }

    // Balances may update a moment later; refetch shortly after.
    window.setTimeout(() => {
      balancesQuery.refetch();
    }, 1500);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('page.faucet.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('page.faucet.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6 flex items-center gap-2">
          <Droplet className="h-6 w-6 text-[#66D121]" />
          <h2 className="text-xl font-bold">{t('page.faucet.claimTitle')}</h2>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {t('page.faucet.rpcInfoPrefix')}
            <span className="ml-1 font-mono">tempo_fundAddress</span> {t('page.faucet.rpcInfoSuffix')}
          </div>

          {!isConnected ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {t('page.faucet.walletNotConnected')}
            </div>
          ) : null}

          <a
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
            href="https://docs.tempo.xyz/quickstart/faucet"
            target="_blank"
            rel="noreferrer"
          >
            {t('page.faucet.openDocs')}
            <ExternalLink className="h-4 w-4" />
          </a>

          <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
            {t('page.faucet.rpcLabel')}: <span className="font-mono">{tempoTestnet.rpcUrls.default.http[0]}</span>
          </div>

          {address ? (
            <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
              {t('page.faucet.walletLabel')}: <span className="font-mono">{address}</span>
            </div>
          ) : null}

          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{t('page.faucet.balancesTitle')}</div>
              <Button
                type="button"
                onClick={() => balancesQuery.refetch()}
                disabled={!isConnected || balancesQuery.isFetching}
                variant="outline"
                size="sm"
              >
                {balancesQuery.isFetching ? t('page.faucet.refreshing') : t('page.faucet.refresh')}
              </Button>
            </div>

            {!isConnected ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('page.common.connectToViewBalances')}</div>
            ) : balancesQuery.isLoading ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">{t('page.common.loadingBalances')}</div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {balances.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 dark:text-gray-400">{row.label}</span>
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
                        href={`${tempoTestnet.blockExplorers.default.url}/address/${row.tokenAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('page.faucet.aria.openTokenOnExplorer', { symbol: row.label })}
                      >
                        {t('page.faucet.tokenLink')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]" 
                        href={`${tempoTestnet.blockExplorers.default.url}/address/${address}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('page.faucet.aria.openWalletOnExplorer')}
                      >
                        {t('page.faucet.walletLink')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <span className="font-mono">{formatDecimalStringRounded(row.value, { fractionDigits: 2, groupSeparator: ',' })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {txHashes ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
              {t('page.faucet.successTransactions')}
              <div className="mt-2 space-y-2">
                {txHashes.map((hash) => (
                  <div key={hash} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono break-all">{hash}</span>
                    <a
                      className="inline-flex items-center gap-2 font-semibold text-green-700 hover:underline dark:text-green-200"
                      href={`${tempoTestnet.blockExplorers.default.url}/tx/${hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('page.common.explorer')}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {resultText && !txHashes ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
              {t('page.faucet.result')}
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/60 p-3 font-mono text-xs dark:bg-black/20">
                {resultText}
              </pre>
            </div>
          ) : null}

          {resultText && txHashes ? (
            <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <summary className="cursor-pointer select-none font-semibold">{t('page.faucet.rawRpcResponse')}</summary>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                {resultText}
              </pre>
            </details>
          ) : null}

          {lastError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {t('common.error')}: <span className="font-mono">{lastError}</span>
            </div>
          ) : null}

          <Button type="button" disabled={!canClaim} onClick={claim} className="w-full">
            {buttonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
