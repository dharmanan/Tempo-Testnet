import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { isAddress, parseAbiItem } from 'viem';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { addRecentToken, loadRecentTokens, subscribeRecentTokensUpdates } from '@/lib/recentTokens';
import { CONTRACTS } from '@/config/contracts';
import { useI18n } from '@/lib/i18n';
import { discoverFactoryCreatedTokenAddresses } from '@/lib/indexSupply';

const TOKEN_CREATED_EVENT = parseAbiItem(
  'event TokenCreated(address indexed token, string name, string symbol, string currency, address quoteToken, address admin, bytes32 salt)',
);

function TabLink({
  to,
  label,
  search,
  end,
}: {
  to: string;
  label: string;
  search: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={{ pathname: to, search }}
      end={end}
      className={({ isActive }) =>
        cn(
          'inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors',
          isActive
            ? 'bg-[#66D121] text-white'
            : 'text-gray-600 hover:bg-[#66D121]/10 hover:text-[#2F6E0C] dark:text-gray-300 dark:hover:bg-[#66D121]/15 dark:hover:text-[#66D121]',
        )
      }
    >
      {label}
    </NavLink>
  );
}

export default function IssuanceLayout() {
  const { t } = useI18n();
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: tempoTestnet.id });
  const [searchParams, setSearchParams] = useSearchParams();
  const [recentTokens, setRecentTokens] = useState<string[]>([]);
  const [createdTokens, setCreatedTokens] = useState<`0x${string}`[]>([]);
  const [createdTokensLoading, setCreatedTokensLoading] = useState(false);

  const token = (searchParams.get('token') ?? '').trim();
  const tokenIsValid = token.length === 0 ? true : isAddress(token);
  const search = token ? `?token=${encodeURIComponent(token)}` : '';

  const setToken = (tokenAddress: string) => {
    if (!tokenAddress) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('token');
        return next;
      });
      return;
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('token', tokenAddress);
      return next;
    });

    if (typeof address === 'string' && isAddress(tokenAddress)) {
      addRecentToken(tempoTestnet.id, address, tokenAddress);
    }
  };

  const factoryAddress = useMemo(() => CONTRACTS.find((c) => c.key === 'tokenFactory')?.address, []);

  const tokenFactoryStartBlock = useMemo(() => {
    const raw = (import.meta.env.VITE_TOKEN_FACTORY_START_BLOCK as unknown as string | undefined) ?? '';
    if (!raw?.trim()) return 0n;
    try {
      return BigInt(raw.trim());
    } catch {
      return 0n;
    }
  }, []);

  const tokenFactoryLookbackBlocks = useMemo(() => {
    const raw = (import.meta.env.VITE_TOKEN_FACTORY_LOOKBACK_BLOCKS as unknown as string | undefined) ?? '';
    if (!raw?.trim()) return 200_000n;
    try {
      const n = BigInt(raw.trim());
      return n > 0n ? n : 200_000n;
    } catch {
      return 200_000n;
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setRecentTokens([]);
      return;
    }

    const refresh = () => {
      const state = loadRecentTokens(tempoTestnet.id, address);
      setRecentTokens(state.tokens);
    };

    refresh();
    return subscribeRecentTokensUpdates(refresh);
  }, [address]);

  useEffect(() => {
    if (!address || !publicClient || !factoryAddress) {
      setCreatedTokens([]);
      return;
    }

    let cancelled = false;
    setCreatedTokensLoading(true);

    (async () => {
      try {
        // Preferred: IndexSupply can filter by non-indexed params (admin) and scan full history cheaply.
        try {
          const created = await discoverFactoryCreatedTokenAddresses({
            chainId: tempoTestnet.id,
            factoryAddress,
            adminAddress: address,
            limit: 200,
          });
          if (!cancelled && created.length > 0) {
            setCreatedTokens(created.slice(0, 50));
            return;
          }
        } catch {
          // fall back to RPC log scan below
        }

        const latest = await publicClient.getBlockNumber();
        const lookbackFrom = latest > tokenFactoryLookbackBlocks ? latest - tokenFactoryLookbackBlocks : 0n;
        const fromBlock = lookbackFrom > tokenFactoryStartBlock ? lookbackFrom : tokenFactoryStartBlock;

        const logs = await publicClient.getLogs({
          address: factoryAddress,
          event: TOKEN_CREATED_EVENT,
          fromBlock,
          toBlock: 'latest',
        });

        const tokensFromLogs = logs
          .filter((l) => {
            const admin = (l.args as { admin?: `0x${string}` } | undefined)?.admin;
            return typeof admin === 'string' && admin.toLowerCase() === address.toLowerCase();
          })
          .map((l) => (l.args as { token?: `0x${string}` } | undefined)?.token)
          .filter((t): t is `0x${string}` => Boolean(t));

        const unique = Array.from(new Set(tokensFromLogs.map((t) => t.toLowerCase())))
          .map((t) => t as `0x${string}`)
          .slice(0, 50);

        if (!cancelled) setCreatedTokens(unique);
      } catch {
        if (!cancelled) setCreatedTokens([]);
      } finally {
        if (!cancelled) setCreatedTokensLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, factoryAddress, publicClient, tokenFactoryLookbackBlocks, tokenFactoryStartBlock]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('page.issuance.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('page.issuance.subtitle')}</p>
        {chainId !== tempoTestnet.id ? (
          <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-200">
            {t('page.issuance.wrongNetwork', { chainId: tempoTestnet.id })}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full">
            <label className="block text-sm font-medium">{t('page.issuance.tokenAddressLabel')}</label>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              placeholder="0x..."
              className={cn('mt-2 font-mono', tokenIsValid ? '' : 'border-red-400')}
            />
            {!tokenIsValid ? (
              <p className="mt-2 text-xs text-red-600">{t('common.invalidAddress')}</p>
            ) : (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('page.issuance.tokenAddressHelp')}
              </p>
            )}

            {address ? (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('page.issuance.tokenPicker')}</label>
                <Select
                  className="mt-2 font-mono"
                  value=""
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next) setToken(next);
                  }}
                >
                  <option value="">{t('page.issuance.selectPlaceholder')}</option>
                  {createdTokens.length ? (
                    <optgroup
                      label={t(createdTokensLoading ? 'page.issuance.createdLoading' : 'page.issuance.createdOnChain')}
                    >
                      {createdTokens.map((t) => (
                        <option key={t.toLowerCase()} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {recentTokens.length ? (
                    <optgroup label={t('page.issuance.recentLocal')}>
                      {recentTokens.map((t) => (
                        <option key={t.toLowerCase()} value={t}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  {t('page.issuance.recentTip')}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setToken('')}
              disabled={!token}
            >
              {t('page.issuance.clear')}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <TabLink to="/issuance/create" search={search} label={t('page.issuance.tab.create')} end />
        <TabLink to="/issuance/mint" search={search} label={t('page.issuance.tab.supply')} />
        <TabLink to="/issuance/fees" search={search} label={t('page.issuance.tab.fees')} />
        <TabLink to="/issuance/rewards" search={search} label={t('page.issuance.tab.rewards')} />
        <TabLink to="/issuance/manage" search={search} label={t('page.issuance.tab.manage')} />
      </div>

      <Outlet />
    </div>
  );
}
