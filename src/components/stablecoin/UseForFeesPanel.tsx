import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useReadContract, useSimulateContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { useSearchParams } from 'react-router-dom';
import { Coins, Droplet, Info, Loader2, Repeat } from 'lucide-react';
import { formatUnits, isAddress, maxUint256, parseUnits } from 'viem';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { CONTRACTS } from '@/config/contracts';
import { ABIS } from '@/contracts/abis';
import { TESTNET_ADDRESSES } from '@/contracts/addresses/testnet';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { parseContractError } from '@/utils/errorParser';
import { useI18n } from '@/lib/i18n';

type Address = `0x${string}`;

export function UseForFeesPanel() {
  const { t } = useI18n();
  const chainId = useChainId();
  const isTempo = chainId === tempoTestnet.id;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [searchParams] = useSearchParams();

  const debugEnabled = useMemo(() => {
    const q = (searchParams.get('debug') ?? '').trim();
    return Boolean(import.meta.env.DEV || q === '1' || q.toLowerCase() === 'true');
  }, [searchParams]);

  const debug = useMemo(() => {
    return {
      log: (...args: unknown[]) => {
        if (!debugEnabled) return;
        // eslint-disable-next-line no-console
        console.log('[fees-debug]', ...args);
      },
      warn: (...args: unknown[]) => {
        if (!debugEnabled) return;
        // eslint-disable-next-line no-console
        console.warn('[fees-debug]', ...args);
      },
      error: (...args: unknown[]) => {
        if (!debugEnabled) return;
        // eslint-disable-next-line no-console
        console.error('[fees-debug]', ...args);
      },
      groupCollapsed: (label: string) => {
        if (!debugEnabled) return;
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[fees-debug] ${label}`);
      },
      groupEnd: () => {
        if (!debugEnabled) return;
        // eslint-disable-next-line no-console
        console.groupEnd();
      },
    };
  }, [debugEnabled]);

  const token = (searchParams.get('token') ?? '').trim();
  const userToken = isAddress(token) ? (token as Address) : null;
  const hasUserToken = Boolean(userToken);

  const feeManager = useMemo(() => CONTRACTS.find((c) => c.key === 'feeManager')?.address, []);
  const known = TESTNET_ADDRESSES[tempoTestnet.id];

  // Validator fee token can vary by proposer. In practice (and per our RPC probing) PathUSD may be used.
  // Choose the pool based on the *validator's preferred fee token*, not the issued token's quoteToken.
  const [validatorToken, setValidatorToken] = useState<Address>(known.PathUSD);

  const formatKnownSymbol = (addr?: string | null) => {
    if (!addr) return null;
    const a = addr.toLowerCase();
    if (a === known.PathUSD.toLowerCase()) return 'PathUSD';
    if (a === known.AlphaUSD.toLowerCase()) return 'AlphaUSD';
    if (a === known.BetaUSD.toLowerCase()) return 'BetaUSD';
    if (a === known.ThetaUSD.toLowerCase()) return 'ThetaUSD';
    return null;
  };

  const [latestProposer, setLatestProposer] = useState<Address | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!publicClient || !isTempo) return;
      try {
        const block = await publicClient.getBlock({ blockTag: 'latest' });
        const coinbase = (block as { miner?: Address; coinbase?: Address }).miner ?? (block as { coinbase?: Address }).coinbase;
        if (!cancelled && coinbase && isAddress(coinbase)) setLatestProposer(coinbase);
      } catch {
        // ignore
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [publicClient, isTempo]);

  useEffect(() => {
    if (!debugEnabled) return;
    debug.groupCollapsed('panel init');
    debug.log('chainId:', chainId, 'isTempo:', isTempo);
    debug.log('connected:', isConnected, 'wallet:', address);
    debug.log('feeManager:', feeManager);
    debug.log('userToken(from query):', token);
    debug.log('userToken(parsed):', userToken);
    debug.log('validatorToken:', validatorToken);
    debug.log('debugEnabled:', debugEnabled, '(enable via ?debug=1)');
    debug.groupEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugEnabled, chainId, isTempo, isConnected, address, feeManager, token, userToken, validatorToken]);

  const { data: userDecimals } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'decimals',
    query: { enabled: Boolean(isTempo && userToken), refetchOnWindowFocus: false },
  });
  const { data: userSymbol } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'symbol',
    query: { enabled: Boolean(isTempo && userToken), refetchOnWindowFocus: false },
  });
  const { data: userCurrency } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'currency',
    query: { enabled: Boolean(isTempo && userToken), refetchOnWindowFocus: false },
  });
  // Read the user token's quoteToken to help debug
  const { data: userQuoteToken } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'quoteToken',
    query: { enabled: Boolean(isTempo && userToken), refetchOnWindowFocus: false },
  });

  const { data: valDecimals } = useReadContract({
    address: validatorToken,
    abi: ABIS.TIP20Token,
    functionName: 'decimals',
    query: { enabled: Boolean(isTempo && validatorToken), refetchOnWindowFocus: false },
  });
  const { data: valSymbol } = useReadContract({
    address: validatorToken,
    abi: ABIS.TIP20Token,
    functionName: 'symbol',
    query: { enabled: Boolean(isTempo && validatorToken), refetchOnWindowFocus: false },
  });

  const { data: pool, refetch: refetchPool } = useReadContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'getPool',
    args: userToken && feeManager ? [userToken, validatorToken] : undefined,
    query: { enabled: Boolean(isTempo && feeManager && userToken), refetchOnWindowFocus: false },
  });

  const {
    data: onchainUserPrefToken,
    refetch: refetchOnchainUserPrefToken,
    isLoading: isOnchainUserPrefTokenLoading,
  } = useReadContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'userTokens',
    args: feeManager && address ? [address] : undefined,
    query: { enabled: Boolean(isTempo && feeManager && address), refetchOnWindowFocus: false },
  });

  // Prober: what token does the current proposer want to receive fees in?
  const { data: proposerPreferredToken } = useReadContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'validatorTokens',
    args: feeManager && latestProposer ? [latestProposer] : undefined,
    query: { enabled: Boolean(isTempo && feeManager && latestProposer), refetchOnWindowFocus: false },
  });

  const proposerPreferredTokenAddress = useMemo(() => {
    if (typeof proposerPreferredToken !== 'string') return null;
    return isAddress(proposerPreferredToken) ? (proposerPreferredToken as Address) : null;
  }, [proposerPreferredToken]);

  // Calculate pool state early - needed for determining mint type (4-param vs 5-param)
  const poolReserveUser = (pool as { reserveUserToken?: bigint } | undefined)?.reserveUserToken;
  const poolReserveVal = (pool as { reserveValidatorToken?: bigint } | undefined)?.reserveValidatorToken;
  
  // Fee AMM liquidity is primarily about the *validatorToken* reserve.
  // Per spec, providing liquidity can be single-sided (validator token only).
  const isPoolEmpty =
    (poolReserveUser === undefined || poolReserveUser === 0n) && (poolReserveVal === undefined || poolReserveVal === 0n);
  const hasValidatorLiquidity = typeof poolReserveVal === 'bigint' && poolReserveVal > 0n;

  useEffect(() => {
    if (!debugEnabled) return;
    debug.groupCollapsed('pool state');
    debug.log('poolReserveUser:', typeof poolReserveUser === 'bigint' ? poolReserveUser.toString() : poolReserveUser);
    debug.log('poolReserveVal:', typeof poolReserveVal === 'bigint' ? poolReserveVal.toString() : poolReserveVal);
    debug.log('isPoolEmpty:', isPoolEmpty);
    debug.log('mint mode:', isPoolEmpty ? 'single-sided only (validator token; 4 params)' : 'single-sided or dual-sided');
    debug.groupEnd();
  }, [debug, debugEnabled, isPoolEmpty, poolReserveUser, poolReserveVal]);

  const userQuoteTokenAddress = useMemo(() => {
    if (typeof userQuoteToken !== 'string') return null;
    return isAddress(userQuoteToken) ? (userQuoteToken as Address) : null;
  }, [userQuoteToken]);

  const validatorWasManuallyChanged = useRef(false);

  // Auto-select the pool against the current proposer token unless the user has overridden it.
  useEffect(() => {
    if (!proposerPreferredTokenAddress) return;
    if (validatorWasManuallyChanged.current) return;
    if (proposerPreferredTokenAddress.toLowerCase() === validatorToken.toLowerCase()) return;
    setValidatorToken(proposerPreferredTokenAddress);
  }, [proposerPreferredTokenAddress, validatorToken]);

  const { data: allowanceVal, refetch: refetchAllowanceVal } = useReadContract({
    address: validatorToken,
    abi: ABIS.TIP20Token,
    functionName: 'allowance',
    args: address && feeManager ? [address, feeManager] : undefined,
    query: { enabled: Boolean(isTempo && address && feeManager), refetchOnWindowFocus: false },
  });

  const { data: allowanceUser, refetch: refetchAllowanceUser } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'allowance',
    args: address && feeManager && userToken ? [address, feeManager] : undefined,
    query: { enabled: Boolean(isTempo && address && feeManager && userToken), refetchOnWindowFocus: false },
  });

  const [amountUser, setAmountUser] = useState('');
  const [amountVal, setAmountVal] = useState('');
  const [liquidityToBurn, setLiquidityToBurn] = useState('');
  const [isFindingMaxBurn, setIsFindingMaxBurn] = useState(false);
  const [findMaxBurnError, setFindMaxBurnError] = useState<string | null>(null);

  const dUser = typeof userDecimals === 'number' ? userDecimals : 6;
  const dVal = typeof valDecimals === 'number' ? valDecimals : 6;
  const sUser = typeof userSymbol === 'string' ? userSymbol : 'USER';
  const sVal = typeof valSymbol === 'string' ? valSymbol : 'VALIDATOR';

  const { data: userBalance } = useReadContract({
    address: userToken ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'balanceOf',
    args: address && userToken ? [address] : undefined,
    query: { enabled: Boolean(isTempo && address && userToken), refetchOnWindowFocus: false },
  });

  const { data: valBalance } = useReadContract({
    address: validatorToken,
    abi: ABIS.TIP20Token,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(isTempo && address), refetchOnWindowFocus: false },
  });

  const {
    data: setUserTokenHash,
    writeContract: writeSetUserToken,
    isPending: isSetUserTokenPending,
    error: setUserTokenError,
  } = useWriteContract();
  const setUserTokenReceipt = useWaitForTransactionReceipt({ hash: setUserTokenHash });

  useEffect(() => {
    if (!setUserTokenReceipt.isSuccess) return;
    refetchOnchainUserPrefToken();
  }, [refetchOnchainUserPrefToken, setUserTokenReceipt.isSuccess]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!setUserTokenError) return;
    debug.error('setUserToken write failed:', parseContractError(setUserTokenError));
    debug.error('raw error:', setUserTokenError);
  }, [debug, debugEnabled, setUserTokenError]);

  const setUserTokenPreflight = useSimulateContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'setUserToken',
    args: feeManager && userToken ? [userToken] : undefined,
    account: address,
    query: { enabled: Boolean(isConnected && isTempo && feeManager && userToken && address), refetchOnWindowFocus: false },
  });

  // Log preflight errors to help debug
  useEffect(() => {
    if (!debugEnabled) return;

    if (setUserTokenPreflight.isSuccess) {
      debug.log('setUserToken preflight: SUCCESS');
      return;
    }

    // `isSuccess` is false both while loading and while errored; only log errors when present.
    if (setUserTokenPreflight.error) {
      debug.error('setUserToken preflight: FAILED');
      debug.error('reason:', parseContractError(setUserTokenPreflight.error));
      debug.error('raw error:', setUserTokenPreflight.error);
      debug.log('userToken:', userToken);
      debug.log('userCurrency:', userCurrency);
      debug.log('userQuoteToken:', userQuoteToken);
      debug.log('validatorToken:', validatorToken);
    }
  }, [debug, debugEnabled, setUserTokenPreflight.error, setUserTokenPreflight.isSuccess, userCurrency, userQuoteToken, userToken, validatorToken]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!setUserTokenHash) return;
    debug.log('setUserToken tx submitted:', setUserTokenHash);
  }, [debug, debugEnabled, setUserTokenHash]);

  const {
    data: approveValHash,
    writeContract: writeApproveVal,
    isPending: isApproveValPending,
    error: approveValError,
  } = useWriteContract();
  const approveValReceipt = useWaitForTransactionReceipt({ hash: approveValHash });

  const {
    data: approveUserHash,
    writeContract: writeApproveUser,
    isPending: isApproveUserPending,
    error: approveUserError,
  } = useWriteContract();
  const approveUserReceipt = useWaitForTransactionReceipt({ hash: approveUserHash });

  useEffect(() => {
    if (!debugEnabled) return;
    if (!approveValError) return;
    debug.error('approve(validatorToken) write failed:', parseContractError(approveValError));
    debug.error('raw error:', approveValError);
  }, [approveValError, debug, debugEnabled]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!approveUserError) return;
    debug.error('approve(userToken) write failed:', parseContractError(approveUserError));
    debug.error('raw error:', approveUserError);
  }, [approveUserError, debug, debugEnabled]);

  const {
    data: mintHash,
    writeContract: writeMint,
    isPending: isMintPending,
    error: mintError,
  } = useWriteContract();
  const mintReceipt = useWaitForTransactionReceipt({ hash: mintHash });

  useEffect(() => {
    if (!debugEnabled) return;
    if (!mintError) return;
    debug.error('mint write failed:', parseContractError(mintError));
    debug.error('raw error:', mintError);
  }, [debug, debugEnabled, mintError]);

  const {
    data: burnHash,
    writeContract: writeBurn,
    isPending: isBurnPending,
    error: burnError,
  } = useWriteContract();
  const burnReceipt = useWaitForTransactionReceipt({ hash: burnHash });

  useEffect(() => {
    if (!debugEnabled) return;
    if (!burnError) return;
    debug.error('burn write failed:', parseContractError(burnError));
    debug.error('raw error:', burnError);
  }, [burnError, debug, debugEnabled]);

  const requiredVal = useMemo(() => {
    if (!amountVal.trim()) return null;
    try {
      const v = parseUnits(amountVal, dVal);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amountVal, dVal]);

  const requiredUser = useMemo(() => {
    if (!amountUser.trim()) return null;
    try {
      const v = parseUnits(amountUser, dUser);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amountUser, dUser]);

  const canDualSidedMint = useMemo(() => {
    // Tempo Fee AMM initialization (0/0 pool) is validator-token-only.
    // However, AFTER the pool has non-zero reserves, the ABI supports a 5-arg mint overload
    // which can be used to add user-token reserve. This is important if fee charging/swap logic
    // requires reserveUserToken > 0 on the node side.
    return !isPoolEmpty;
  }, [isPoolEmpty]);

  const isDualSidedMint = useMemo(() => {
    if (!canDualSidedMint) return false;
    return requiredUser != null && requiredUser > 0n;
  }, [canDualSidedMint, requiredUser]);

  useEffect(() => {
    // If the pool is empty, force user-side amount to 0 to avoid the known init revert.
    if (canDualSidedMint) return;
    if (!amountUser.trim()) return;
    setAmountUser('');
  }, [amountUser, canDualSidedMint]);

  // Avoid running mint simulations before allowances are sufficient.
  // Otherwise, the UI shows a revert "before clicking" while the user is still approving.
  const allowanceOkValForMint = useMemo(() => {
    if (requiredVal == null) return false;
    return typeof allowanceVal === 'bigint' && allowanceVal >= requiredVal;
  }, [allowanceVal, requiredVal]);

  const allowanceOkUserForMint = useMemo(() => {
    if (!isDualSidedMint) return true;
    if (requiredUser == null) return false;
    return typeof allowanceUser === 'bigint' && allowanceUser >= requiredUser;
  }, [allowanceUser, isDualSidedMint, requiredUser]);

  const shouldSimulateMint = useMemo(() => {
    if (!isConnected || !isTempo || !feeManager || !userToken || !address) return false;
    return allowanceOkValForMint && allowanceOkUserForMint;
  }, [address, allowanceOkUserForMint, allowanceOkValForMint, feeManager, isConnected, isTempo, userToken]);

  const mintArgs = useMemo(() => {
    if (!feeManager || !userToken || !address) return undefined;
    if (requiredVal == null) return undefined;
    // Dual-sided mint when seeding user reserve (amountUserToken > 0)
    if (isDualSidedMint && requiredUser != null) {
      return [userToken, validatorToken, requiredUser, requiredVal, address] as const;
    }
    // Otherwise: single-sided mint (validator token only).
    return [userToken, validatorToken, requiredVal, address] as const;
  }, [feeManager, userToken, validatorToken, address, requiredVal, isDualSidedMint, requiredUser]);

  const mintPreflight = useSimulateContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'mint',
    args: mintArgs,
    account: address,
    query: {
      enabled: Boolean(shouldSimulateMint && mintArgs),
      refetchOnWindowFocus: false,
    },
  });

  // Log mint preflight errors to help debug
  useEffect(() => {
    if (!debugEnabled) return;

    if (!shouldSimulateMint) {
      debug.log('mint preflight: SKIPPED (waiting for approvals/allowances)');
      return;
    }

    if (mintPreflight.isSuccess) {
      debug.log('mint preflight: SUCCESS', isDualSidedMint ? '(dual-sided)' : '(single-sided)');
      return;
    }

    if (mintPreflight.error) {
      debug.error('mint preflight: FAILED');
      debug.error('reason:', parseContractError(mintPreflight.error));
      debug.error('raw error:', mintPreflight.error);
      debug.log('mintType:', 'single-sided (4 params)');
      if (isDualSidedMint) debug.log('mintType:', 'dual-sided (5 params)');
      debug.log('poolReserves:', {
        user: typeof poolReserveUser === 'bigint' ? poolReserveUser.toString() : poolReserveUser,
        validator: typeof poolReserveVal === 'bigint' ? poolReserveVal.toString() : poolReserveVal,
      });
      debug.log('userToken:', userToken);
      debug.log('validatorToken:', validatorToken);
      debug.log('amountUser:', requiredUser?.toString());
      debug.log('amountVal:', requiredVal?.toString());
      debug.log('to:', address);
    }
  }, [address, debug, debugEnabled, isDualSidedMint, mintPreflight.error, mintPreflight.isSuccess, poolReserveUser, poolReserveVal, requiredUser, requiredVal, shouldSimulateMint, userToken, validatorToken]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!mintHash) return;
    debug.log('mint tx submitted:', mintHash);
  }, [debug, debugEnabled, mintHash]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!approveValHash) return;
    debug.log('approve validatorToken tx submitted:', approveValHash);
  }, [debug, debugEnabled, approveValHash]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!approveUserHash) return;
    debug.log('approve userToken tx submitted:', approveUserHash);
  }, [debug, debugEnabled, approveUserHash]);

  useEffect(() => {
    if (!debugEnabled) return;
    if (!burnHash) return;
    debug.log('burn tx submitted:', burnHash);
  }, [debug, debugEnabled, burnHash]);
  const approveValContextRef = useRef<{ token: Address; spender: Address; amount: bigint; hash?: `0x${string}` } | null>(null);
  const approveUserContextRef = useRef<{ token: Address; spender: Address; amount: bigint; hash?: `0x${string}` } | null>(null);

  useEffect(() => {
    if (!approveValHash) return;
    const ctx = approveValContextRef.current;
    if (!ctx) return;
    if (ctx.hash) return;
    approveValContextRef.current = { ...ctx, hash: approveValHash };
  }, [approveValHash]);

  useEffect(() => {
    if (!approveUserHash) return;
    const ctx = approveUserContextRef.current;
    if (!ctx) return;
    if (ctx.hash) return;
    approveUserContextRef.current = { ...ctx, hash: approveUserHash };
  }, [approveUserHash]);

  const approvalCoversVal = useMemo(() => {
    if (!approveValReceipt.isSuccess) return false;
    if (!feeManager) return false;
    const ctx = approveValContextRef.current;
    if (!ctx) return false;
    if (!approveValHash || ctx.hash?.toLowerCase() !== approveValHash.toLowerCase()) return false;
    const needed = requiredVal ?? 0n;
    return ctx.token.toLowerCase() === validatorToken.toLowerCase() && ctx.spender.toLowerCase() === feeManager.toLowerCase() && ctx.amount >= needed;
  }, [approveValHash, approveValReceipt.isSuccess, feeManager, requiredVal, validatorToken]);

  const approvalCoversUser = useMemo(() => {
    if (!isDualSidedMint) return true;
    if (!approveUserReceipt.isSuccess) return false;
    if (!feeManager || !userToken) return false;
    const ctx = approveUserContextRef.current;
    if (!ctx) return false;
    if (!approveUserHash || ctx.hash?.toLowerCase() !== approveUserHash.toLowerCase()) return false;
    const needed = requiredUser ?? 0n;
    return ctx.token.toLowerCase() === userToken.toLowerCase() && ctx.spender.toLowerCase() === feeManager.toLowerCase() && ctx.amount >= needed;
  }, [approveUserHash, approveUserReceipt.isSuccess, feeManager, isDualSidedMint, requiredUser, userToken]);

  useEffect(() => {
    if (!approveValReceipt.isSuccess) return;
    refetchAllowanceVal();
  }, [approveValReceipt.isSuccess, refetchAllowanceVal]);

  useEffect(() => {
    if (!approveUserReceipt.isSuccess) return;
    refetchAllowanceUser();
  }, [approveUserReceipt.isSuccess, refetchAllowanceUser]);

  // After liquidity actions confirm, refresh pool reserves so the UI reflects new reserves.
  useEffect(() => {
    if (!mintReceipt.isSuccess) return;
    refetchPool();
  }, [mintReceipt.isSuccess, refetchPool]);

  useEffect(() => {
    if (!burnReceipt.isSuccess) return;
    refetchPool();
  }, [burnReceipt.isSuccess, refetchPool]);

  const needsApproveVal = useMemo(() => {
    if (approvalCoversVal) return false;
    if (requiredVal == null) return false;
    if (typeof allowanceVal !== 'bigint') return true;
    return allowanceVal < requiredVal;
  }, [allowanceVal, approvalCoversVal, requiredVal]);

  const needsApproveUser = useMemo(() => {
    if (!isDualSidedMint) return false;
    if (approvalCoversUser) return false;
    if (requiredUser == null) return false;
    if (typeof allowanceUser !== 'bigint') return true;
    return allowanceUser < requiredUser;
  }, [allowanceUser, approvalCoversUser, isDualSidedMint, requiredUser]);

  const canMint = useMemo(() => {
    if (!isConnected || !isTempo || !feeManager || !address) return false;
    if (isMintPending || mintReceipt.isLoading) return false;
    if (requiredVal == null) return false;
    if (typeof valBalance === 'bigint' && valBalance < requiredVal) return false;
    if (isDualSidedMint) {
      if (requiredUser == null) return false;
      if (typeof userBalance === 'bigint' && userBalance < requiredUser) return false;
      const userOk = approvalCoversUser || (typeof allowanceUser === 'bigint' && allowanceUser >= requiredUser);
      const valOk = approvalCoversVal || (typeof allowanceVal === 'bigint' && allowanceVal >= requiredVal);
      return userOk && valOk && mintPreflight.isSuccess;
    }
    const valOk = approvalCoversVal || (typeof allowanceVal === 'bigint' && allowanceVal >= requiredVal);
    return valOk && mintPreflight.isSuccess;
  }, [address, allowanceUser, allowanceVal, approvalCoversUser, approvalCoversVal, feeManager, isConnected, isDualSidedMint, isMintPending, isTempo, mintPreflight.isSuccess, mintReceipt.isLoading, requiredUser, requiredVal, userBalance, valBalance]);

  const isMissingAmounts = useMemo(() => {
    if (requiredVal == null) return true;
    if (isDualSidedMint && requiredUser == null) return true;
    return false;
  }, [isDualSidedMint, requiredUser, requiredVal]);

  const balanceIssue = useMemo(() => {
    if (requiredVal == null) return null;
    if (typeof valBalance === 'bigint' && valBalance < requiredVal) {
      return t('issuance.fees.insufficientBalance', { symbol: sVal });
    }
    if (isDualSidedMint && requiredUser != null && typeof userBalance === 'bigint' && userBalance < requiredUser) {
      return t('issuance.fees.insufficientBalance', { symbol: sUser });
    }
    return null;
  }, [isDualSidedMint, requiredUser, requiredVal, sUser, sVal, t, userBalance, valBalance]);

  const approveUser = async () => {
    if (!feeManager || !userToken) return;
    const amountToApprove = requiredUser ?? maxUint256;
    debug.log('approve userToken -> FeeManager', { token: userToken, spender: feeManager, amount: amountToApprove.toString() });
    approveUserContextRef.current = { token: userToken, spender: feeManager as Address, amount: amountToApprove, hash: undefined };
    writeApproveUser({
      address: userToken,
      abi: ABIS.TIP20Token,
      functionName: 'approve',
      args: [feeManager, amountToApprove],
    });
  };

  const approveValidator = async () => {
    if (!feeManager) return;
    const amountToApprove = requiredVal ?? maxUint256;
    debug.log('approve validatorToken -> FeeManager', { token: validatorToken, spender: feeManager, amount: amountToApprove.toString() });
    approveValContextRef.current = { token: validatorToken, spender: feeManager as Address, amount: amountToApprove, hash: undefined };
    writeApproveVal({
      address: validatorToken,
      abi: ABIS.TIP20Token,
      functionName: 'approve',
      args: [feeManager, amountToApprove],
    });
  };

  const setAsFeeToken = async () => {
    if (!feeManager) return;
    debug.log('setUserToken -> FeeManager', {
      feeManager,
      userToken,
      userCurrency,
      userBalance: typeof userBalance === 'bigint' ? userBalance.toString() : userBalance,
      poolReserves: {
        user: typeof poolReserveUser === 'bigint' ? poolReserveUser.toString() : poolReserveUser,
        validator: typeof poolReserveVal === 'bigint' ? poolReserveVal.toString() : poolReserveVal,
      },
      validatorToken,
    });
    writeSetUserToken({
      address: feeManager,
      abi: ABIS.FeeManager,
      functionName: 'setUserToken',
      args: [userToken],
    });
  };

  const mint = async () => {
    if (!feeManager || !address) return;
    if (!amountVal.trim()) return;
    const aVal = parseUnits(amountVal, dVal);
    const aUser = isDualSidedMint && amountUser.trim() ? parseUnits(amountUser, dUser) : 0n;
    debug.log('mint(single-sided)', {
      feeManager,
      userToken,
      validatorToken,
      amountUser: aUser.toString(),
      amountVal: aVal.toString(),
      to: address,
    });
    if (isDualSidedMint && aUser > 0n) {
      writeMint({
        address: feeManager,
        abi: ABIS.FeeManager,
        functionName: 'mint',
        args: [userToken, validatorToken, aUser, aVal, address],
      });
    } else {
      writeMint({
        address: feeManager,
        abi: ABIS.FeeManager,
        functionName: 'mint',
        args: [userToken, validatorToken, aVal, address],
      });
    }
  };

  const isInsufficientLiquidity = (err: unknown) => {
    const msg = parseContractError(err);
    return msg.includes('InsufficientLiquidity') || msg.includes('0xbb55fd27');
  };

  const findMaxBurnableLiquidity = async () => {
    if (!publicClient || !feeManager || !address) return;
    setFindMaxBurnError(null);
    setIsFindingMaxBurn(true);
    try {
      // Exponential search for an upper bound
      let low = 0n;
      let high = 1n;
      const maxExpIters = 24;
      const maxBinIters = 24;

      const canBurn = async (liq: bigint) => {
        try {
          await publicClient.simulateContract({
            address: feeManager as Address,
            abi: ABIS.FeeManager,
            functionName: 'burn',
            args: [userToken, validatorToken, liq, address],
            account: address,
          });
          return true;
        } catch (e) {
          if (isInsufficientLiquidity(e)) return false;
          throw e;
        }
      };

      // If even 1 fails, wallet owns 0 liquidity.
      if (!(await canBurn(1n))) {
        setLiquidityToBurn('');
        setFindMaxBurnError('This wallet owns 0 burnable liquidity for this pool (InsufficientLiquidity).');
        return;
      }

      low = 1n;
      for (let i = 0; i < maxExpIters; i++) {
        const ok = await canBurn(high);
        if (ok) {
          low = high;
          high = high * 2n;
          continue;
        }
        break;
      }

      // Binary search in (low, high)
      let lo = low;
      let hi = high;
      for (let i = 0; i < maxBinIters && lo + 1n < hi; i++) {
        const mid = (lo + hi) / 2n;
        const ok = await canBurn(mid);
        if (ok) lo = mid;
        else hi = mid;
      }

      setLiquidityToBurn(lo.toString());
    } catch (e) {
      setFindMaxBurnError(parseContractError(e));
      debug.error('findMaxBurnableLiquidity failed:', parseContractError(e));
      debug.error('raw error:', e);
    } finally {
      setIsFindingMaxBurn(false);
    }
  };

  const burn = async () => {
    if (!feeManager || !address) return;
    if (!liquidityToBurn.trim()) return;
    const liq = BigInt(liquidityToBurn);
    debug.log('burn', { feeManager, userToken, validatorToken, liquidity: liq.toString(), to: address });
    writeBurn({
      address: feeManager,
      abi: ABIS.FeeManager,
      functionName: 'burn',
      args: [userToken, validatorToken, liq, address],
    });
  };

  const requiredBurnLiq = useMemo(() => {
    const s = liquidityToBurn.trim();
    if (!s) return null;
    try {
      // Liquidity is a raw uint256 value (no decimals surfaced in ABI/UI).
      // Accept only integer input.
      if (!/^[0-9]+$/.test(s)) return null;
      const v = BigInt(s);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [liquidityToBurn]);

  const burnPreflight = useSimulateContract({
    address: feeManager ?? undefined,
    abi: ABIS.FeeManager,
    functionName: 'burn',
    args: feeManager && userToken && address && requiredBurnLiq != null ? [userToken, validatorToken, requiredBurnLiq, address] : undefined,
    account: address,
    query: {
      enabled: Boolean(isConnected && isTempo && feeManager && userToken && address && requiredBurnLiq != null),
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    if (!debugEnabled) return;
    if (burnPreflight.isSuccess) {
      debug.log('burn preflight: SUCCESS');
      return;
    }
    if (burnPreflight.error) {
      debug.error('burn preflight: FAILED');
      debug.error('reason:', parseContractError(burnPreflight.error));
      debug.error('raw error:', burnPreflight.error);
    }
  }, [burnPreflight.error, burnPreflight.isSuccess, debug, debugEnabled]);

  const burnPresets = useMemo(() => {
    // Liquidity is a raw uint256. Without an on-chain "liquidityOf" view, the safest UX is to
    // try small values first: if even "1" fails with InsufficientLiquidity, the wallet owns 0.
    return ['1', '1000', '1000000', '1000000000'] as const;
  }, []);

  useEffect(() => {
    if (!debugEnabled) return;
    // Log a compact snapshot whenever key read-contract values change.
    debug.groupCollapsed('state snapshot');
    debug.log('user:', { symbol: userSymbol, decimals: userDecimals, currency: userCurrency, quoteToken: userQuoteToken });
    debug.log('validator:', { symbol: valSymbol, decimals: valDecimals });
    debug.log('balances:', {
      user: typeof userBalance === 'bigint' ? userBalance.toString() : userBalance,
      validator: typeof valBalance === 'bigint' ? valBalance.toString() : valBalance,
    });
    debug.log('allowances:', {
      user: typeof allowanceUser === 'bigint' ? allowanceUser.toString() : allowanceUser,
      validator: typeof allowanceVal === 'bigint' ? allowanceVal.toString() : allowanceVal,
    });
    debug.log('required:', {
      user: typeof requiredUser === 'bigint' ? requiredUser.toString() : requiredUser,
      validator: typeof requiredVal === 'bigint' ? requiredVal.toString() : requiredVal,
    });
    debug.log('preflight:', {
      setUserToken: { success: setUserTokenPreflight.isSuccess, error: Boolean(setUserTokenPreflight.error) },
      mint: { success: mintPreflight.isSuccess, error: Boolean(mintPreflight.error) },
    });
    debug.groupEnd();
  }, [
    allowanceVal,
    allowanceUser,
    debug,
    debugEnabled,
    isDualSidedMint,
    mintPreflight.error,
    mintPreflight.isSuccess,
    requiredUser,
    requiredVal,
    setUserTokenPreflight.error,
    setUserTokenPreflight.isSuccess,
    userBalance,
    userCurrency,
    userDecimals,
    userQuoteToken,
    userSymbol,
    valBalance,
    valDecimals,
    valSymbol,
  ]);

  // Use pre-calculated pool state for UI
  const reserveUser = poolReserveUser;
  const reserveVal = poolReserveVal;
  // Per Tempo FeeAMM spec, fee swaps only require *validatorToken reserve*.
  // The pool can start one-sided; reserveUserToken can be 0.
  const isPoolReadyForFeePayments = hasValidatorLiquidity;

  const explorerBaseUrl = tempoTestnet.blockExplorers?.default?.url ?? 'https://explore.tempo.xyz';

  // Proof: send a transfer in a *system USD token* so Explorer shows the payment token,
  // while fees are paid in the user's selected fee token.
  const [testPaymentToken, setTestPaymentToken] = useState<Address>(known.PathUSD);
  const { data: testPayDecimals } = useReadContract({
    address: testPaymentToken,
    abi: ABIS.TIP20Token,
    functionName: 'decimals',
    query: { enabled: Boolean(isTempo && testPaymentToken), refetchOnWindowFocus: false },
  });
  const { data: testPaySymbol } = useReadContract({
    address: testPaymentToken,
    abi: ABIS.TIP20Token,
    functionName: 'symbol',
    query: { enabled: Boolean(isTempo && testPaymentToken), refetchOnWindowFocus: false },
  });

  const [testRecipient, setTestRecipient] = useState('');
  const [testAmount, setTestAmount] = useState('1');

  const defaultRecipientAddress = useMemo(() => {
    if (!address) return null;
    return isAddress(address) ? (address as Address) : null;
  }, [address]);

  const testRecipientAddress = useMemo(() => {
    const v = testRecipient.trim();
    return isAddress(v) ? (v as Address) : null;
  }, [testRecipient]);

  const effectiveTestRecipientAddress = useMemo(() => {
    const v = testRecipient.trim();
    if (!v) return defaultRecipientAddress;
    return testRecipientAddress;
  }, [defaultRecipientAddress, testRecipient, testRecipientAddress]);

  const dPay = typeof testPayDecimals === 'number' ? testPayDecimals : 6;
  const sPay = typeof testPaySymbol === 'string' ? testPaySymbol : (formatKnownSymbol(testPaymentToken) ?? 'PAY');

  const testAmountAtomic = useMemo(() => {
    const v = testAmount.trim();
    if (!v) return null;
    try {
      const a = parseUnits(v, dPay);
      return a > 0n ? a : null;
    } catch {
      return null;
    }
  }, [dPay, testAmount]);

  const { data: testPayBalance } = useReadContract({
    address: testPaymentToken,
    abi: ABIS.TIP20Token,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(isTempo && address), refetchOnWindowFocus: false },
  });

  const hasTestPayBalance = useMemo(() => {
    if (testAmountAtomic == null) return false;
    if (typeof testPayBalance !== 'bigint') return false;
    return testPayBalance >= testAmountAtomic;
  }, [testAmountAtomic, testPayBalance]);

  const {
    data: testTransferHash,
    writeContract: writeTestTransfer,
    isPending: isTestTransferPending,
    error: testTransferError,
  } = useWriteContract();
  const testTransferReceipt = useWaitForTransactionReceipt({ hash: testTransferHash });
  const testTransferExplorerUrl = useMemo(() => {
    if (!testTransferHash) return null;
    return `${explorerBaseUrl}/tx/${testTransferHash}`;
  }, [explorerBaseUrl, testTransferHash]);

  if (!hasUserToken) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {t('issuance.fees.enterAddress')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hasValidatorLiquidity ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
          {t('issuance.fees.addLiquidityFirst')}
        </div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center gap-2">
          <Droplet className="h-6 w-6 text-blue-500" />
          <h2 className="text-xl font-bold">{t('issuance.fees.ammTitle')}</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">{t('issuance.fees.userToken')}</label>
            <div className="mt-2 font-mono text-xs text-gray-600 dark:text-gray-400">{userToken}</div>
            {typeof userCurrency === 'string' && userCurrency !== 'USD' ? (
              <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                {t('issuance.fees.currencyMismatch', { currency: userCurrency })}
              </div>
            ) : typeof userCurrency === 'string' && userCurrency === 'USD' ? (
              <>
                <div className="mt-1 text-xs text-green-600 dark:text-green-400">
                  {t('issuance.fees.currencyOk')}
                </div>
                {/* Show quoteToken for debugging */}
                {typeof userQuoteToken === 'string' && (
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('issuance.fees.quoteTokenLabel', {
                      quoteToken:
                        formatKnownSymbol(userQuoteToken) ?? `${userQuoteToken.slice(0, 10)}...`,
                    })}
                  </div>
                )}
              </>
            ) : <></>}
          </div>
          <div>
            <label className="block text-sm font-medium">{t('issuance.fees.validatorToken')}</label>

            {latestProposer && proposerPreferredTokenAddress ? (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
                {t('issuance.fees.activeProposerPrefers', {
                  proposer: latestProposer,
                  preferredToken: formatKnownSymbol(proposerPreferredTokenAddress) ?? proposerPreferredTokenAddress,
                  userSymbol: sUser,
                  validatorSymbol: formatKnownSymbol(proposerPreferredTokenAddress) ?? t('issuance.fees.validatorTokenGeneric'),
                })}
              </div>
            ) : null}

            <Select
              className="mt-2 font-mono"
              value={validatorToken}
              onChange={(e) => {
                validatorWasManuallyChanged.current = true;
                setValidatorToken(e.target.value as Address);
              }}
            >
              <option value={known.PathUSD}>PathUSD</option>
              <option value={known.AlphaUSD}>AlphaUSD</option>
              <option value={known.BetaUSD}>BetaUSD</option>
              <option value={known.ThetaUSD}>ThetaUSD</option>
            </Select>
            {proposerPreferredTokenAddress && proposerPreferredTokenAddress.toLowerCase() !== validatorToken.toLowerCase() ? (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {t('issuance.fees.validatorTokenMismatchWarning')}
              </div>
            ) : null}
            {userQuoteTokenAddress && userQuoteTokenAddress.toLowerCase() !== validatorToken.toLowerCase() ? (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.fees.quoteTokenNote', { quoteToken: userQuoteTokenAddress })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-800">
          <div className="flex items-center justify-between gap-2">
            <Repeat className="h-4 w-4 text-gray-500" />
            <div className="flex items-center gap-2">
              <div className="font-semibold">{t('issuance.fees.poolReserves')}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-3"
                onClick={() => refetchPool()}
              >
                {t('issuance.fees.refresh')}
              </Button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="text-xs text-gray-700 dark:text-gray-200">
              <span className="font-semibold">{sUser}:</span>{' '}
              <span className="font-mono">
                {typeof reserveUser === 'bigint' ? formatUnits(reserveUser, dUser) : '—'}
              </span>
            </div>
            <div className="text-xs text-gray-700 dark:text-gray-200">
              <span className="font-semibold">{sVal}:</span>{' '}
              <span className="font-mono">
                {typeof reserveVal === 'bigint' ? formatUnits(reserveVal, dVal) : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Pool state info */}
        {isPoolReadyForFeePayments ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
            <div className="font-semibold">{t('issuance.fees.poolReadyTitle')}</div>
            <div className="mt-1 text-xs opacity-90">
              {t('issuance.fees.poolReadyBody', { userSymbol: sUser, validatorSymbol: sVal })}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
            <div className="font-semibold">{t('issuance.fees.addValidatorLiquidityTitle')}</div>
            <div className="mt-1 text-xs opacity-90">
              {t('issuance.fees.addValidatorLiquidityBody', { userSymbol: sUser, validatorSymbol: sVal })}
            </div>
            {isPoolEmpty ? (
              <div className="mt-2 text-xs opacity-90">
                {t('issuance.fees.poolEmptyInitNote')}
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">{t('issuance.fees.amountSymbol', { symbol: sUser })}</label>
            <Input
              value={amountUser}
              onChange={(e) => setAmountUser(e.target.value)}
              placeholder={canDualSidedMint ? t('issuance.fees.placeholderUserAmountOptional') : t('issuance.fees.placeholderUserAmountZero')}
              className="mt-2"
              disabled={!canDualSidedMint}
            />
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {!canDualSidedMint
                ? t('issuance.fees.userAmountHelpEmpty', { userSymbol: sUser })
                : t('issuance.fees.userAmountHelpOptional', { userSymbol: sUser })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium">{t('issuance.fees.amountSymbol', { symbol: sVal })}</label>
            <Input value={amountVal} onChange={(e) => setAmountVal(e.target.value)} placeholder="100" className="mt-2" />
          </div>
        </div>

        {balanceIssue ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {balanceIssue}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {needsApproveUser ? (
            <Button
              type="button"
              variant="outline"
              onClick={approveUser}
              disabled={!isConnected || !isTempo || !feeManager || isApproveUserPending || approveUserReceipt.isLoading}
            >
              {isApproveUserPending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.confirmApprovalInWallet')}
                </span>
              ) : approveUserReceipt.isLoading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.approvingYour', { symbol: sUser })}
                </span>
              ) : (
                t('common.approve', { symbol: sUser })
              )}
            </Button>
          ) : null}

          {needsApproveVal ? (
            <Button
              type="button"
              variant="outline"
              onClick={approveValidator}
              disabled={!isConnected || !isTempo || !feeManager || isApproveValPending || approveValReceipt.isLoading}
            >
              {isApproveValPending ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.confirmApprovalInWallet')}
                </span>
              ) : approveValReceipt.isLoading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.approvingYour', { symbol: sVal })}
                </span>
              ) : (
                t('common.approve', { symbol: sVal })
              )}
            </Button>
          ) : null}

          <Button type="button" onClick={mint} disabled={!canMint}>
            {isMintPending
              ? t('common.submitting')
              : isPoolEmpty
                ? 'Initialize pool'
                : t('common.addLiquidity')}
          </Button>
        </div>

        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.allowances')} {typeof allowanceUser === 'bigint' ? formatUnits(allowanceUser, dUser) : '—'} {sUser},{' '}
          {typeof allowanceVal === 'bigint' ? formatUnits(allowanceVal, dVal) : '—'} {sVal}
        </div>

        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.balances')} {typeof userBalance === 'bigint' ? formatUnits(userBalance, dUser) : '—'} {sUser},{' '}
          {typeof valBalance === 'bigint' ? formatUnits(valBalance, dVal) : '—'} {sVal}
        </div>

        {(approveUserError || approveValError || mintError || (shouldSimulateMint ? mintPreflight.error : undefined)) ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {parseContractError(approveUserError ?? approveValError ?? mintError ?? (shouldSimulateMint ? mintPreflight.error : undefined))}
          </div>
        ) : null}

        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.approveStatus')}{' '}
          {approveUserReceipt.isLoading || approveValReceipt.isLoading ? t('common.confirming') : '—'} | {t('issuance.fees.mintStatus')}{' '}
          {mintReceipt.isLoading ? t('common.confirming') : mintReceipt.isSuccess ? t('common.confirmed') : '—'}
          {!canMint && isMissingAmounts ? ` · ${t('issuance.fees.enterAmountsToEnableMint')}` : null}
        </div>

        <details className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
          <summary className="cursor-pointer select-none font-semibold">{t('issuance.fees.advancedTitle')}</summary>
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.fees.advancedNote')}
          </div>

          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="block text-sm font-medium">{t('issuance.fees.burnLiquidityLabel')}</label>
            <Input
              value={liquidityToBurn}
              onChange={(e) => setLiquidityToBurn(e.target.value)}
              placeholder="12345"
              className="mt-2 font-mono"
            />

            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.fees.liquidityRawIntegerNote', { userSymbol: sUser, validatorSymbol: sVal })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>{t('issuance.fees.quickFill')}</span>
              {burnPresets.map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant="outline"
                  onClick={() => setLiquidityToBurn(v)}
                  disabled={!isConnected || !isTempo || !feeManager}
                  className="h-7 px-2 font-mono text-xs"
                >
                  {v}
                </Button>
              ))}
            </div>

            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.fees.burnTipTryOne', { error: 'InsufficientLiquidity' })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={findMaxBurnableLiquidity}
                disabled={!isConnected || !isTempo || !feeManager || isFindingMaxBurn}
                className="h-9"
              >
                {isFindingMaxBurn ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('issuance.fees.findingMaxBurnable')}
                  </span>
                ) : (
                  t('issuance.fees.findMaxBurnable')
                )}
              </Button>

              {findMaxBurnError ? (
                <div className="text-xs text-red-600 dark:text-red-400">{findMaxBurnError}</div>
              ) : null}
            </div>

            <Button type="button" variant="outline" onClick={burn} disabled={!isConnected || !isTempo || !feeManager || isBurnPending} className="mt-3">
              {isBurnPending ? t('common.submitting') : t('issuance.fees.burnLiquidity')}
            </Button>

            {requiredBurnLiq == null && liquidityToBurn.trim() ? (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('issuance.fees.enterPositiveInteger')}</div>
            ) : null}

            {requiredBurnLiq != null && !burnPreflight.isSuccess ? (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                {t('issuance.fees.burnPreflightFailed')}
              </div>
            ) : null}

            {burnPreflight.error ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {parseContractError(burnPreflight.error)}
              </div>
            ) : null}
            {burnError ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                {parseContractError(burnError)}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.fees.burnStatus', {
                status: burnReceipt.isLoading ? t('common.confirming') : burnReceipt.isSuccess ? t('common.confirmed') : '—',
              })}
            </p>
          </div>
        </details>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center gap-2">
          <Coins className="h-6 w-6 text-[#66D121]" />
          <h2 className="text-xl font-bold">{t('issuance.fees.prefTitle')}</h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('issuance.fees.prefSubtitle')}
        </p>

        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
          <div className="font-semibold">{t('issuance.fees.quickCheckTitle')}</div>
          <div className="mt-1">
            {t('issuance.fees.poolReserveLabel', { symbol: sVal })}{' '}
            <span className={typeof reserveVal === 'bigint' && reserveVal > 0n ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}>
              {typeof reserveVal === 'bigint' ? formatUnits(reserveVal, dVal) : '—'}
            </span>
          </div>
        </div>

        {(setUserTokenError || setUserTokenPreflight.error) ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {parseContractError(setUserTokenError ?? setUserTokenPreflight.error)}
          </div>
        ) : null}

        <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.preflightLabel')}{' '}
          {setUserTokenPreflight.isLoading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('issuance.fees.preflightChecking')}
            </span>
          ) : setUserTokenPreflight.isSuccess ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">{t('issuance.fees.preflightOkShort')}</span>
          ) : (
            <span className="font-semibold text-amber-700 dark:text-amber-300">{t('issuance.fees.preflightFailedShort')}</span>
          )}
          <span className="ml-2 text-[11px] text-gray-500 dark:text-gray-500">
            {t('issuance.fees.preflightWalletHint')}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2 sm:w-auto">
            <div className="flex max-w-[360px] items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-300" />
              <div className="leading-snug">
                <div className="font-semibold">{t('issuance.fees.prefCtaTitle')}</div>
                <div className="opacity-90">{t('issuance.fees.prefCtaBody')}</div>
              </div>
            </div>

            <Button
              type="button"
              onClick={setAsFeeToken}
              disabled={!isConnected || !isTempo || !feeManager || isSetUserTokenPending || !setUserTokenPreflight.isSuccess}
              className="sm:w-auto"
            >
              {isSetUserTokenPending ? t('common.submitting') : t('issuance.fees.setAsFeeToken', { symbol: sUser })}
            </Button>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[320px_140px_auto] sm:items-end sm:justify-end">
            <div className="sm:col-start-1 sm:row-start-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('issuance.fees.testRecipient')}</label>
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
                {t('issuance.fees.testRecipientHint')}
              </div>
              <Input
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder={defaultRecipientAddress ? defaultRecipientAddress : '0x...'}
                className="mt-2 font-mono"
              />
            </div>

            <div className="sm:col-start-2 sm:row-start-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('issuance.fees.testPaymentToken')}</label>
              <Select
                className="mt-1 font-mono"
                value={testPaymentToken}
                onChange={(e) => {
                  setTestPaymentToken(e.target.value as Address);
                }}
              >
                <option value={known.PathUSD}>PathUSD</option>
                <option value={known.AlphaUSD}>AlphaUSD</option>
              </Select>
            </div>

            <div className="sm:col-start-3 sm:row-start-1 sm:w-[140px]">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('issuance.fees.testAmount', { symbol: sPay })}</label>
              <Input
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                placeholder="1"
                className="mt-1 font-mono"
              />
            </div>

            <div className="sm:col-start-3 sm:row-start-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={
                  !isConnected ||
                  !isTempo ||
                  !isPoolReadyForFeePayments ||
                  !userToken ||
                  !effectiveTestRecipientAddress ||
                  testAmountAtomic == null ||
                  !hasTestPayBalance ||
                  isTestTransferPending
                }
                onClick={() => {
                  if (!effectiveTestRecipientAddress || testAmountAtomic == null) return;
                  writeTestTransfer({
                    address: testPaymentToken,
                    abi: ABIS.TIP20Token,
                    functionName: 'transfer',
                    args: [effectiveTestRecipientAddress, testAmountAtomic],
                  });
                }}
                className="sm:w-auto"
              >
                {isTestTransferPending ? t('common.submitting') : t('issuance.fees.sendTestTransfer')}
              </Button>
            </div>

            {testAmountAtomic != null && !hasTestPayBalance ? (
              <div className="sm:col-span-3 mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                {t('issuance.fees.testPaymentInsufficient', { symbol: sPay })}
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.metamaskFeeDisplayNote')}
        </p>

        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.fees.testPaymentTokenHint')}
        </p>

        {testTransferError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {parseContractError(testTransferError)}
          </div>
        ) : null}

        {testTransferExplorerUrl ? (
          <div className="mt-3 text-xs text-gray-700 dark:text-gray-300">
            {t('issuance.fees.proofHint')}{' '}
            <a className="font-semibold underline" href={testTransferExplorerUrl} target="_blank" rel="noreferrer">
              {t('issuance.fees.viewInExplorer')}
            </a>
            {testTransferReceipt.isLoading ? ` · ${t('common.confirming')}` : testTransferReceipt.isSuccess ? ` · ${t('common.confirmed')}` : ''}
          </div>
        ) : null}

        <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <p>
            {t('issuance.fees.prefOnchainStatus')}{' '}
            {isOnchainUserPrefTokenLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('common.loading')}
              </span>
            ) : typeof onchainUserPrefToken === 'string' && isAddress(onchainUserPrefToken) ? (
              <span className="font-mono">{formatKnownSymbol(onchainUserPrefToken) ?? onchainUserPrefToken}</span>
            ) : (
              '—'
            )}
            {typeof onchainUserPrefToken === 'string' && userToken && isAddress(onchainUserPrefToken) && onchainUserPrefToken.toLowerCase() === userToken.toLowerCase() ? (
              <span className="ml-2 font-semibold text-emerald-700 dark:text-emerald-300">{t('issuance.fees.preflightOkShort')}</span>
            ) : null}
          </p>
          <p>
            {t('issuance.fees.lastTxStatus')}{' '}
            {setUserTokenReceipt.isLoading ? t('common.confirming') : setUserTokenReceipt.isSuccess ? t('common.confirmed') : setUserTokenHash ? t('issuance.fees.txSubmitted') : '—'}
          </p>
        </div>

        {isConnected && isTempo && feeManager && !setUserTokenPreflight.isSuccess ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {t('issuance.fees.prefPreflightFailed')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
