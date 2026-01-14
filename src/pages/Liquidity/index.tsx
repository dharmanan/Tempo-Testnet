import { useEffect, useMemo, useRef, useState } from 'react';
import { Droplets, ExternalLink, Loader2 } from 'lucide-react';
import { CONTRACTS } from '@/config/contracts';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { TESTNET_ADDRESSES } from '@/contracts/addresses/testnet';
import { ABIS } from '@/contracts/abis';
import { formatUnits, isAddress, maxUint256, parseUnits } from 'viem';
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { markTaskCompleted } from '@/lib/taskProgressStorage';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { formatDecimalStringRounded } from '@/utils/formatters';

const MAX_UINT128 = (1n << 128n) - 1n;

type TokenOption = {
  key: string;
  label: string;
  address: `0x${string}`;
};

type LiquidityMode = 'simple' | 'advanced';

export default function Liquidity() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const dex = useMemo(() => CONTRACTS.find((c) => c.key === 'dex')?.address, []);

  const { t } = useI18n();

  const isTempo = chainId === tempoTestnet.id;

  const tokenOptions = useMemo((): TokenOption[] => {
    const chain = (TESTNET_ADDRESSES as unknown as Record<number, Record<string, string>>)[tempoTestnet.id];
    const base: TokenOption[] = [
      { key: 'PathUSD', label: 'pathUSD', address: chain.PathUSD as `0x${string}` },
      { key: 'AlphaUSD', label: 'AlphaUSD', address: chain.AlphaUSD as `0x${string}` },
      { key: 'BetaUSD', label: 'BetaUSD', address: chain.BetaUSD as `0x${string}` },
      { key: 'ThetaUSD', label: 'ThetaUSD', address: chain.ThetaUSD as `0x${string}` },
    ];

    return base;
  }, []);

  const [mode, setMode] = useState<LiquidityMode>('simple');

  // Simple (beginner) flow: place a flip order around the mid price.
  const [baseKey, setBaseKey] = useState<string>(() => tokenOptions[1]?.key ?? 'AlphaUSD');

  const baseAddress = useMemo(() => {
    return tokenOptions.find((opt) => opt.key === baseKey)?.address ?? null;
  }, [baseKey, tokenOptions]);

  const [amount, setAmount] = useState('');
  const [spreadBps, setSpreadBps] = useState('20'); // 0.20%
  const [startDirection, setStartDirection] = useState<'buyThenSell' | 'sellThenBuy'>('buyThenSell');

  // Advanced (orderbook) controls.
  const [side, setSide] = useState<'bid' | 'ask'>('bid');
  const [price, setPrice] = useState('0.9990');
  const [tick, setTick] = useState('');
  const [cancelOrderId, setCancelOrderId] = useState('');

  const { data: quoteToken } = useReadContract({
    abi: ABIS.TIP20Token,
    address: baseAddress ?? undefined,
    functionName: 'quoteToken',
    query: { enabled: Boolean(isTempo && baseAddress) },
  });

  const { data: priceScale } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'PRICE_SCALE',
    query: { enabled: Boolean(isTempo && dex) },
  });

  const { data: tickSpacing } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'TICK_SPACING',
    query: { enabled: Boolean(isTempo && dex) },
  });

  const canLoadBook = Boolean(
    isTempo && dex && baseAddress && typeof quoteToken === 'string' && isAddress(quoteToken as string),
  );

  const { data: pairKey } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'pairKey',
    args: canLoadBook ? [baseAddress!, quoteToken as `0x${string}`] : undefined,
    query: { enabled: canLoadBook },
  });

  const { data: book } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'books',
    args: canLoadBook && pairKey ? [pairKey as `0x${string}`] : undefined,
    query: { enabled: Boolean(canLoadBook && pairKey) },
  });

  const bestBidTick = useMemo(() => {
    const v = (book as unknown as { bestBidTick?: unknown } | undefined)?.bestBidTick;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    if (Array.isArray(book) && (book as unknown[]).length >= 4) {
      const raw = (book as unknown[])[2];
      if (typeof raw === 'bigint') return Number(raw);
      if (typeof raw === 'number') return raw;
    }
    return null;
  }, [book]);

  const bestAskTick = useMemo(() => {
    const v = (book as unknown as { bestAskTick?: unknown } | undefined)?.bestAskTick;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    if (Array.isArray(book) && (book as unknown[]).length >= 4) {
      const raw = (book as unknown[])[3];
      if (typeof raw === 'bigint') return Number(raw);
      if (typeof raw === 'number') return raw;
    }
    return null;
  }, [book]);

  const { data: bestBidPriceRaw } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'tickToPrice',
    args: bestBidTick != null && canLoadBook ? [bestBidTick] : undefined,
    query: { enabled: Boolean(canLoadBook && bestBidTick != null) },
  });

  const { data: bestAskPriceRaw } = useReadContract({
    abi: ABIS.StablecoinDEX,
    address: dex,
    functionName: 'tickToPrice',
    args: bestAskTick != null && canLoadBook ? [bestAskTick] : undefined,
    query: { enabled: Boolean(canLoadBook && bestAskTick != null) },
  });

  const bestBidPriceText = useMemo(() => {
    const scale = typeof priceScale === 'number' ? priceScale : 100_000;
    const raw = typeof bestBidPriceRaw === 'bigint' ? Number(bestBidPriceRaw) : typeof bestBidPriceRaw === 'number' ? bestBidPriceRaw : null;
    if (raw == null) return '—';
    const p = raw / scale;
    return Number.isFinite(p) ? p.toFixed(4) : '—';
  }, [bestBidPriceRaw, priceScale]);

  const bestAskPriceText = useMemo(() => {
    const scale = typeof priceScale === 'number' ? priceScale : 100_000;
    const raw = typeof bestAskPriceRaw === 'bigint' ? Number(bestAskPriceRaw) : typeof bestAskPriceRaw === 'number' ? bestAskPriceRaw : null;
    if (raw == null) return '—';
    const p = raw / scale;
    return Number.isFinite(p) ? p.toFixed(4) : '—';
  }, [bestAskPriceRaw, priceScale]);

  useEffect(() => {
    // Derive tick from price when price changes, unless user manually set tick.
    const scale = typeof priceScale === 'number' ? priceScale : 100_000;
    const spacing = typeof tickSpacing === 'number' ? tickSpacing : 10;
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    const scaled = Math.round(p * scale);
    let t = scaled - scale;
    // Snap to spacing.
    if (spacing !== 0) t = Math.round(t / spacing) * spacing;
    setTick(String(t));
  }, [price, priceScale, tickSpacing]);

  const midPrice = useMemo(() => {
    const bid = Number(bestBidPriceText);
    const ask = Number(bestAskPriceText);
    if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) return (bid + ask) / 2;
    if (Number.isFinite(ask) && ask > 0) return ask;
    if (Number.isFinite(bid) && bid > 0) return bid;
    return 1.0;
  }, [bestAskPriceText, bestBidPriceText]);

  const spreadBpsInt = useMemo(() => {
    const v = Number(spreadBps);
    if (!Number.isFinite(v) || v < 0 || v > 10_000) return null;
    return Math.floor(v);
  }, [spreadBps]);

  const computedFlipTicks = useMemo(() => {
    if (!spreadBpsInt && spreadBpsInt !== 0) return null;
    const scale = typeof priceScale === 'number' ? priceScale : 100_000;
    const spacing = typeof tickSpacing === 'number' ? tickSpacing : 10;

    // Spread is total distance between bid and ask.
    const half = spreadBpsInt / 2 / 10_000;
    const bidPrice = midPrice * (1 - half);
    const askPrice = midPrice * (1 + half);
    if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0) return null;

    const toTick = (p: number) => {
      const scaled = Math.round(p * scale);
      let t = scaled - scale;
      if (spacing !== 0) t = Math.round(t / spacing) * spacing;
      if (t < -32768 || t > 32767) return null;
      return t;
    };

    const bidTick = toTick(bidPrice);
    const askTick = toTick(askPrice);
    if (bidTick == null || askTick == null) return null;
    if (askTick <= bidTick) return null;
    return { bidTick, askTick, bidPrice, askPrice };
  }, [midPrice, priceScale, spreadBpsInt, tickSpacing]);

  const { data: baseDecimals } = useReadContract({
    abi: ABIS.TIP20Token,
    address: baseAddress ?? undefined,
    functionName: 'decimals',
    query: { enabled: Boolean(isTempo && baseAddress) },
  });

  const { data: baseBalanceRaw, isLoading: isBaseBalanceLoading } = useReadContract({
    abi: ABIS.TIP20Token,
    address: baseAddress ?? undefined,
    functionName: 'balanceOf',
    args: isConnected && address && baseAddress ? [address] : undefined,
    query: { enabled: Boolean(isTempo && isConnected && address && baseAddress) },
  });

  const baseBalanceText = useMemo(() => {
    if (!isTempo) return '—';
    if (!isConnected) return '—';
    if (!address) return '—';
    if (!baseAddress) return '—';
    if (isBaseBalanceLoading) return t('page.common.loadingBalances');
    const decimals = typeof baseDecimals === 'number' ? baseDecimals : 6;
    const raw = typeof baseBalanceRaw === 'bigint' ? baseBalanceRaw : 0n;
    const value = formatUnits(raw, decimals);
    return formatDecimalStringRounded(value, { fractionDigits: 2, groupSeparator: ',' });
  }, [address, baseAddress, baseBalanceRaw, baseDecimals, isBaseBalanceLoading, isConnected, isTempo, t]);

  const amountParsed = useMemo(() => {
    if (!amount.trim()) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = typeof baseDecimals === 'number' ? baseDecimals : 6;
    try {
      const v = parseUnits(amount, d);
      if (v <= 0n || v > MAX_UINT128) return null;
      return v;
    } catch {
      return null;
    }
  }, [amount, baseDecimals]);

  const tickValue = useMemo(() => {
    if (!tick.trim()) return null;
    const v = Number(tick);
    if (!Number.isFinite(v)) return null;
    if (!Number.isInteger(v)) return null;
    if (v < -32768 || v > 32767) return null;
    const spacing = typeof tickSpacing === 'number' ? tickSpacing : 10;
    if (spacing !== 0 && v % spacing !== 0) return null;
    return v;
  }, [tick, tickSpacing]);

  const tokenToApprove = useMemo(() => {
    // Beginners shouldn't have to think about it; we approve what the next action needs.
    const quote = typeof quoteToken === 'string' ? (quoteToken as `0x${string}`) : null;

    if (mode === 'simple') {
      if (!quote) return null;
      return startDirection === 'buyThenSell' ? quote : baseAddress;
    }

    if (side === 'ask') return baseAddress;
    return quote;
  }, [baseAddress, mode, quoteToken, side, startDirection]);

  const tokenToApproveLabel = useMemo(() => {
    if (!tokenToApprove) return t('page.liquidity.token');
    const found = tokenOptions.find((opt) => opt.address.toLowerCase() === tokenToApprove.toLowerCase());
    return found?.label ?? t('page.liquidity.token');
  }, [tokenToApprove, tokenOptions, t]);

  const { data: allowance } = useReadContract({
    abi: ABIS.TIP20Token,
    address: tokenToApprove ?? undefined,
    functionName: 'allowance',
    args: isConnected && address && dex && tokenToApprove ? [address, dex] : undefined,
    query: { enabled: Boolean(isTempo && isConnected && address && dex && tokenToApprove) },
  });

  const { refetch: refetchAllowance } = useReadContract({
    abi: ABIS.TIP20Token,
    address: tokenToApprove ?? undefined,
    functionName: 'allowance',
    args: isConnected && address && dex && tokenToApprove ? [address, dex] : undefined,
    query: { enabled: false },
  });

  const needsApproval = useMemo(() => {
    if (!tokenToApprove) return false;
    if (!amountParsed) return false;
    if (typeof allowance !== 'bigint') return true;
    // We approve max anyway; just check against the base token amount as a heuristic.
    return allowance < amountParsed;
  }, [tokenToApprove, amountParsed, allowance]);

  const {
    data: approveHash,
    writeContract: writeApprove,
    isPending: isApprovePending,
    error: approveError,
  } = useWriteContract();

  const {
    data: placeHash,
    writeContract: writePlace,
    isPending: isPlacePending,
    error: placeError,
  } = useWriteContract();

  const {
    data: placeFlipHash,
    writeContract: writePlaceFlip,
    isPending: isPlaceFlipPending,
    error: placeFlipError,
  } = useWriteContract();

  const {
    data: cancelHash,
    writeContract: writeCancel,
    isPending: isCancelPending,
    error: cancelError,
  } = useWriteContract();

  const approveReceipt = useWaitForTransactionReceipt({ hash: approveHash });
  const placeReceipt = useWaitForTransactionReceipt({ hash: placeHash });
  const placeFlipReceipt = useWaitForTransactionReceipt({ hash: placeFlipHash });
  const cancelReceipt = useWaitForTransactionReceipt({ hash: cancelHash });

  useEffect(() => {
    if (!address) return;
    if (!placeHash) return;
    if (!placeReceipt.isSuccess) return;
    markTaskCompleted(tempoTestnet.id, address, 'add_liquidity_daily', { txHash: placeHash });
  }, [address, placeHash, placeReceipt.isSuccess]);

  useEffect(() => {
    if (!address) return;
    if (!placeFlipHash) return;
    if (!placeFlipReceipt.isSuccess) return;
    markTaskCompleted(tempoTestnet.id, address, 'add_liquidity_daily', { txHash: placeFlipHash });
  }, [address, placeFlipHash, placeFlipReceipt.isSuccess]);

  const approveContextRef = useRef<{
    token: `0x${string}`;
    spender: `0x${string}`;
    hash?: `0x${string}`;
  } | null>(null);

  const approvalCoversCurrent = useMemo(() => {
    if (!approveReceipt.isSuccess) return false;
    if (!dex) return false;
    if (!tokenToApprove) return false;
    const ctx = approveContextRef.current;
    if (!ctx) return false;
    if (!approveHash || ctx.hash?.toLowerCase() !== approveHash.toLowerCase()) return false;
    return ctx.token.toLowerCase() === tokenToApprove.toLowerCase() && ctx.spender.toLowerCase() === dex.toLowerCase();
  }, [approveHash, approveReceipt.isSuccess, dex, tokenToApprove]);

  useEffect(() => {
    if (!approveReceipt.isSuccess) return;
    refetchAllowance();
  }, [approveReceipt.isSuccess, refetchAllowance]);

  const approve = async () => {
    if (!dex) return;
    if (!tokenToApprove) return;

    approveContextRef.current = { token: tokenToApprove, spender: dex, hash: undefined };

    writeApprove({
      abi: ABIS.TIP20Token,
      address: tokenToApprove,
      functionName: 'approve',
      args: [dex, maxUint256],
    });
  };

  useEffect(() => {
    if (!approveHash) return;
    const ctx = approveContextRef.current;
    if (!ctx) return;
    if (ctx.hash) return;
    approveContextRef.current = { ...ctx, hash: approveHash };
  }, [approveHash]);

  const place = async () => {
    if (!dex) return;
    if (!amountParsed || tickValue == null) return;
    if (!baseAddress) return;
    writePlace({
      abi: ABIS.StablecoinDEX,
      address: dex,
      functionName: 'place',
      args: [baseAddress, amountParsed, side === 'bid', tickValue],
    });
  };

  const placeFlip = async () => {
    if (!dex) return;
    if (!amountParsed) return;
    if (!computedFlipTicks) return;
    if (!baseAddress) return;

    const { bidTick, askTick } = computedFlipTicks;
    const isBid = startDirection === 'buyThenSell';
    const tick0 = isBid ? bidTick : askTick;
    const flipTick = isBid ? askTick : bidTick;

    writePlaceFlip({
      abi: ABIS.StablecoinDEX,
      address: dex,
      functionName: 'placeFlip',
      args: [baseAddress, amountParsed, isBid, tick0, flipTick],
    });
  };

  const cancel = async () => {
    if (!dex) return;
    const raw = cancelOrderId.trim();
    if (!raw) return;
    try {
      const v = BigInt(raw);
      if (v < 0n || v > MAX_UINT128) return;
      writeCancel({
        abi: ABIS.StablecoinDEX,
        address: dex,
        functionName: 'cancel',
        args: [v],
      });
    } catch {
      return;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('page.liquidity.title')}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('page.liquidity.subtitle')}</p>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
          <div className="font-semibold">{t('page.liquidity.mmNotice.title')}</div>
          <div className="mt-1 whitespace-pre-line">{t('page.liquidity.mmNotice.body')}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6 flex items-center gap-2">
          <Droplets className="h-6 w-6 text-purple-500" />
          <h2 className="text-xl font-bold">{t('page.liquidity.poolTitle')}</h2>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => setMode('simple')} variant={mode === 'simple' ? 'default' : 'outline'} size="sm">
                {t('page.liquidity.mode.simple')}
              </Button>
              <Button type="button" onClick={() => setMode('advanced')} variant={mode === 'advanced' ? 'default' : 'outline'} size="sm">
                {t('page.liquidity.mode.orderbookTools')}
              </Button>
            </div>
          </div>

          {!isTempo ? (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              {t('page.liquidity.switchNetworkToPlaceOrders', { network: tempoTestnet.name })}
            </div>
          ) : null}

          {dex ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
              href={`${tempoTestnet.blockExplorers.default.url}/address/${dex}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.liquidity.viewDexOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium">{t('page.liquidity.token')}</label>
              <select
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
                value={baseKey}
                onChange={(e) => {
                  setBaseKey(e.target.value);
                }}
              >
                {tokenOptions.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {t('page.liquidity.balance')}{' '}
                <span className="font-mono">{baseBalanceText}</span>
              </p>
              {baseAddress ? (
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {t('page.common.token')}{' '}
                  <span className="font-mono">{baseAddress}</span>
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium">{t('page.liquidity.amount')}</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                step="0.000001"
                placeholder="0.00"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
              />
            </div>
          </div>

          {mode === 'simple' ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center gap-2">
                <Droplets className="h-4 w-4 text-purple-500" />
                <div className="text-sm font-semibold">{t('page.liquidity.twoSided.title')}</div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('page.liquidity.twoSided.desc')}
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium">{t('page.liquidity.spreadBps')}</label>
                  <input
                    value={spreadBps}
                    onChange={(e) => setSpreadBps(e.target.value)}
                    inputMode="numeric"
                    placeholder="20"
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
                  />
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{t('page.liquidity.spreadExample')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium">{t('page.liquidity.startWith')}</label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      onClick={() => setStartDirection('buyThenSell')}
                      variant={startDirection === 'buyThenSell' ? 'default' : 'outline'}
                      size="sm"
                    >
                      {t('page.liquidity.startDirection.buyThenSell')}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setStartDirection('sellThenBuy')}
                      variant={startDirection === 'sellThenBuy' ? 'default' : 'outline'}
                      size="sm"
                    >
                      {t('page.liquidity.startDirection.sellThenBuy')}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    {t('page.liquidity.startDirection.help')}
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                  <div className="mb-2 text-sm font-semibold">{t('page.liquidity.marketSnapshot.title')}</div>
                  <div className="flex items-center justify-between">
                    <span>{t('page.liquidity.marketSnapshot.bestBid')}</span>
                    <span className="font-mono">{bestBidTick == null ? '—' : bestBidPriceText}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>{t('page.liquidity.marketSnapshot.bestAsk')}</span>
                    <span className="font-mono">{bestAskTick == null ? '—' : bestAskPriceText}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>{t('page.liquidity.marketSnapshot.mid')}</span>
                    <span className="font-mono">{midPrice.toFixed(4)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                  <div className="mb-2 text-sm font-semibold">{t('page.liquidity.yourOrderComputed.title')}</div>
                  {computedFlipTicks ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span>{t('page.liquidity.yourOrderComputed.bid')}</span>
                        <span className="font-mono">
                          {computedFlipTicks.bidPrice.toFixed(4)} (tick {computedFlipTicks.bidTick})
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span>{t('page.liquidity.yourOrderComputed.ask')}</span>
                        <span className="font-mono">
                          {computedFlipTicks.askPrice.toFixed(4)} (tick {computedFlipTicks.askTick})
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {t('page.liquidity.enterValidSpread')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <summary className="cursor-pointer select-none text-sm font-semibold">{t('page.liquidity.orderbookToolsAdvanced')}</summary>

              <div className="mt-4 grid grid-cols-1 gap-4">
                <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                  <div className="mb-2 text-sm font-semibold">{t('page.liquidity.orderbookBestTicks.title')}</div>
                  <div className="flex items-center justify-between">
                    <span>{t('page.liquidity.orderbookBestTicks.bestBid')}</span>
                    <span className="font-mono">
                      {bestBidTick == null ? '—' : bestBidTick} ({bestBidPriceText})
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>{t('page.liquidity.orderbookBestTicks.bestAsk')}</span>
                    <span className="font-mono">
                      {bestAskTick == null ? '—' : bestAskTick} ({bestAskPriceText})
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    {t('page.liquidity.orderbookBestTicks.helpPrefix')}{' '}
                    <span className="font-mono">tickToPrice</span>.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium">{t('page.liquidity.side')}</label>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" onClick={() => setSide('bid')} variant={side === 'bid' ? 'default' : 'outline'} size="sm" className="flex-1">
                      {t('page.liquidity.side.bid')}
                    </Button>
                    <Button type="button" onClick={() => setSide('ask')} variant={side === 'ask' ? 'default' : 'outline'} size="sm" className="flex-1">
                      {t('page.liquidity.side.ask')}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                    {t('page.liquidity.side.help')}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium">{t('page.liquidity.priceQuotePerBase')}</label>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    type="number"
                    step="0.0001"
                    placeholder="1.0000"
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
                  />
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    {t('page.liquidity.priceHelp')}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium">{t('page.liquidity.tick')}</label>
                  <input
                    value={tick}
                    onChange={(e) => setTick(e.target.value)}
                    inputMode="numeric"
                    placeholder="-10"
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
                  />
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    {t('page.liquidity.tickMustBeMultipleOf', { spacing: typeof tickSpacing === 'number' ? tickSpacing : 10 })}
                  </p>
                </div>
              </div>
            </details>
          )}

          {approveError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              {approveError.message}
            </div>
          ) : null}
          {placeError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              {placeError.message}
            </div>
          ) : null}
          {placeFlipError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              {placeFlipError.message}
            </div>
          ) : null}
          {cancelError ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              {cancelError.message}
            </div>
          ) : null}

          {approveHash ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
              href={`${tempoTestnet.blockExplorers.default.url}/tx/${approveHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.common.viewApprovalOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          {placeHash ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
              href={`${tempoTestnet.blockExplorers.default.url}/tx/${placeHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.liquidity.viewOrderPlacementOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          {placeFlipHash ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
              href={`${tempoTestnet.blockExplorers.default.url}/tx/${placeFlipHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.liquidity.viewFlipOrderPlacementOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
          {cancelHash ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
              href={`${tempoTestnet.blockExplorers.default.url}/tx/${cancelHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('page.liquidity.viewCancellationOnExplorer')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}

          {needsApproval && !approvalCoversCurrent ? (
            <Button
              type="button"
              onClick={approve}
              disabled={!isConnected || !isTempo || !dex || !tokenToApprove || isApprovePending || approveReceipt.isLoading}
              variant="outline"
              className="w-full"
            >
              {isApprovePending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.confirmApprovalInWallet')}
                </span>
              ) : approveReceipt.isLoading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.approvingYour', { symbol: tokenToApproveLabel })}
                </span>
              ) : (
                t('page.liquidity.approveTokenForDex')
              )}
            </Button>
          ) : mode === 'simple' ? (
            <Button
              type="button"
              onClick={placeFlip}
              disabled={
                !isConnected ||
                !isTempo ||
                !dex ||
                !baseAddress ||
                !amountParsed ||
                !computedFlipTicks ||
                isPlaceFlipPending ||
                placeFlipReceipt.isLoading
              }
              className="w-full"
            >
              {isPlaceFlipPending
                ? t('common.confirmInWallet')
                : placeFlipReceipt.isLoading
                  ? t('common.placing')
                  : placeFlipReceipt.isSuccess
                    ? t('common.liquidityAdded')
                    : t('common.addLiquidity')}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={place}
              disabled={!isConnected || !isTempo || !dex || !baseAddress || !amountParsed || tickValue == null || isPlacePending || placeReceipt.isLoading}
              className="w-full"
            >
              {isPlacePending
                ? t('common.confirmInWallet')
                : placeReceipt.isLoading
                  ? t('common.placing')
                  : placeReceipt.isSuccess
                    ? t('common.orderPlaced')
                    : t('page.liquidity.placeOrder')}
            </Button>
          )}

          {!amountParsed && amount.trim() ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {t('page.liquidity.enterValidAmountUint128')}
            </div>
          ) : null}

          {mode === 'advanced' && tickValue == null && tick.trim() ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {t('page.liquidity.enterValidTick')}
            </div>
          ) : null}

            <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <summary className="cursor-pointer select-none text-sm font-semibold">{t('page.liquidity.cancelOrderAdvanced')}</summary>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={cancelOrderId}
                onChange={(e) => setCancelOrderId(e.target.value)}
                inputMode="numeric"
                placeholder={t('page.liquidity.cancelOrderIdPlaceholder')}
                className="flex-1 rounded-lg border border-gray-200 bg-white p-3 outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-800 dark:bg-gray-900"
              />
              <Button
                type="button"
                onClick={cancel}
                disabled={!isConnected || !isTempo || !dex || isCancelPending || cancelReceipt.isLoading}
                variant="outline"
                size="sm"
              >
                {isCancelPending
                  ? t('common.confirm')
                  : cancelReceipt.isLoading
                    ? t('common.cancelling')
                    : t('common.cancel')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{t('page.liquidity.cancelOwnOrdersOnly')}</p>
          </details>

          {dex && !isAddress(dex) ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {t('page.common.invalidDexAddressConfigured')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
