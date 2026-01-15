import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { isAddress, parseAbiItem } from 'viem';
import { TASK_DEFINITIONS, type TaskKey } from '@/lib/tasks';
import { useI18n } from '@/lib/i18n';
import { CONTRACTS } from '@/config/contracts';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { discoverFactoryCreatedTokenAddresses } from '@/lib/indexSupply';
import {
  isTaskCompletedOnce,
  isTaskCompletedToday,
  loadTaskProgress,
  markTaskCompleted,
  subscribeTaskProgressUpdates,
} from '@/lib/taskProgressStorage';

const TOKEN_CREATED_EVENT = parseAbiItem(
  'event TokenCreated(address indexed token, string name, string symbol, string currency, address quoteToken, address admin, bytes32 salt)',
);

export type TaskRow = {
  key: TaskKey;
  name: string;
  description: string;
  href: string;
  cadence: 'daily' | 'once';
  enabled: boolean;
  completed: boolean;
};

export function useTaskProgress() {
  const { t: tr } = useI18n();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: tempoTestnet.id });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return subscribeTaskProgressUpdates(() => setVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!address || !isConnected) return;
    if (chainId !== tempoTestnet.id) return;

    // If already completed, skip network checks.
    const state = loadTaskProgress(chainId, address);
    if (isTaskCompletedOnce(state, 'create_token_once')) return;

    const factoryAddress = CONTRACTS.find((c) => c.key === 'tokenFactory')?.address;
    if (!factoryAddress || !isAddress(factoryAddress)) return;

    let cancelled = false;

    (async () => {
      // 1) Preferred: IndexSupply (fast, full-history, filters by non-indexed `admin`).
      try {
        const created = await discoverFactoryCreatedTokenAddresses({
          chainId: tempoTestnet.id,
          factoryAddress,
          adminAddress: address,
          limit: 1,
        });

        if (cancelled) return;
        if (created.length > 0) {
          markTaskCompleted(chainId, address, 'create_token_once');
          return;
        }
      } catch {
        // fall through to RPC scan
      }

      // 2) Fallback: RPC log scan over recent history.
      if (!publicClient) return;

      try {
        const latest = await publicClient.getBlockNumber();

        const startBlockRaw = (import.meta.env.VITE_TOKEN_FACTORY_START_BLOCK as unknown as string | undefined) ?? '';
        const lookbackRaw = (import.meta.env.VITE_TOKEN_FACTORY_LOOKBACK_BLOCKS as unknown as string | undefined) ?? '';

        let startBlock = 0n;
        try {
          startBlock = startBlockRaw.trim() ? BigInt(startBlockRaw.trim()) : 0n;
        } catch {
          startBlock = 0n;
        }

        let lookback = 200_000n;
        try {
          lookback = lookbackRaw.trim() ? BigInt(lookbackRaw.trim()) : 200_000n;
          if (lookback <= 0n) lookback = 200_000n;
        } catch {
          lookback = 200_000n;
        }

        const lookbackFrom = latest > lookback ? latest - lookback : 0n;
        const fromBlock = lookbackFrom > startBlock ? lookbackFrom : startBlock;

        const logs = await publicClient.getLogs({
          address: factoryAddress,
          event: TOKEN_CREATED_EVENT,
          fromBlock,
          toBlock: 'latest',
        });

        if (cancelled) return;

        const found = logs.some((l) => {
          const admin = (l.args as { admin?: `0x${string}` } | undefined)?.admin;
          return typeof admin === 'string' && admin.toLowerCase() === address.toLowerCase();
        });

        if (found) markTaskCompleted(chainId, address, 'create_token_once');
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, chainId, isConnected, publicClient]);

  const tasks = useMemo(() => {
    // Recompute when task progress storage changes.
    void version;
    if (!address || !isConnected) {
      return TASK_DEFINITIONS.map((def) => ({
        key: def.key,
        name: tr(def.nameKey),
        description: tr(def.descriptionKey),
        href: def.href,
        cadence: def.cadence,
        enabled: def.enabled,
        completed: false,
      })) as TaskRow[];
    }

    const state = loadTaskProgress(chainId, address);
    return TASK_DEFINITIONS.map((def) => {
      const completed = def.cadence === 'daily'
        ? isTaskCompletedToday(state, def.key)
        : isTaskCompletedOnce(state, def.key);

      return {
        key: def.key,
        name: tr(def.nameKey),
        description: tr(def.descriptionKey),
        href: def.href,
        cadence: def.cadence,
        enabled: def.enabled,
        completed,
      };
    }) as TaskRow[];
  }, [address, isConnected, chainId, version, tr]);

  const totalCount = tasks.length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const progress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return {
    tasks,
    completedCount,
    totalCount,
    progress,
  } as const;
}
