import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { Shield, PauseCircle, PlayCircle, KeyRound } from 'lucide-react';
import { formatUnits, isAddress, keccak256, parseUnits, toBytes } from 'viem';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { ABIS } from '@/contracts/abis';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/common/CopyButton';
import { parseContractError } from '@/utils/errorParser';
import { useI18n } from '@/lib/i18n';

type Address = `0x${string}`;

type RoleKey =
  | 'DEFAULT_ADMIN_ROLE'
  | 'ISSUER_ROLE'
  | 'PAUSE_ROLE'
  | 'UNPAUSE_ROLE'
  | 'BURN_BLOCKED_ROLE';

const ROLE_KEYS: RoleKey[] = [
  'DEFAULT_ADMIN_ROLE',
  'ISSUER_ROLE',
  'PAUSE_ROLE',
  'UNPAUSE_ROLE',
  'BURN_BLOCKED_ROLE',
];

function truncateHex(value: string, head = 10, tail = 8) {
  const v = String(value ?? '');
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

export function TokenManagement() {
  const { t } = useI18n();
  const chainId = useChainId();
  const isTempo = chainId === tempoTestnet.id;
  const explorerBaseUrl = tempoTestnet.blockExplorers?.default?.url;
  const { address, isConnected } = useAccount();
  const [searchParams] = useSearchParams();

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

  const { data: paused } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'paused',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const { data: supplyCap } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'supplyCap',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });
  const { data: transferPolicyId } = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'transferPolicyId',
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });

  const d = typeof decimals === 'number' ? decimals : 6;
  const s = typeof symbol === 'string' ? symbol : 'TOKEN';

  const [capInput, setCapInput] = useState<string>('');
  const [policyIdInput, setPolicyIdInput] = useState<string>('');

  const [roleKey, setRoleKey] = useState<RoleKey>('ISSUER_ROLE');
  const [roleAccount, setRoleAccount] = useState<string>('');
  const targetAccount = useMemo(() => {
    const raw = roleAccount.trim();
    if (!raw) return address ?? null;
    return isAddress(raw) ? (raw as Address) : null;
  }, [roleAccount, address]);

  const computedRoleId = useMemo(() => {
    if (roleKey === 'DEFAULT_ADMIN_ROLE') {
      return ('0x' + '00'.repeat(32)) as `0x${string}`;
    }
    return keccak256(toBytes(roleKey)) as `0x${string}`;
  }, [roleKey]);

  const roleConstant = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: roleKey,
    query: { enabled: Boolean(isTempo && tokenAddress) },
  });

  const roleId = (roleConstant.data as `0x${string}` | undefined) ?? computedRoleId;

  const roleHas = useReadContract({
    address: tokenAddress ?? undefined,
    abi: ABIS.TIP20Token,
    functionName: 'hasRole',
    args: targetAccount && tokenAddress ? [targetAccount, roleId] : undefined,
    account: address,
    query: { enabled: Boolean(isTempo && tokenAddress && targetAccount) },
  });

  const {
    data: pauseHash,
    writeContract: writePause,
    isPending: isPausePending,
    error: pauseError,
  } = useWriteContract();
  const pauseReceipt = useWaitForTransactionReceipt({ hash: pauseHash });

  const {
    data: unpauseHash,
    writeContract: writeUnpause,
    isPending: isUnpausePending,
    error: unpauseError,
  } = useWriteContract();
  const unpauseReceipt = useWaitForTransactionReceipt({ hash: unpauseHash });

  const {
    data: capHash,
    writeContract: writeCap,
    isPending: isCapPending,
    error: capError,
  } = useWriteContract();
  const capReceipt = useWaitForTransactionReceipt({ hash: capHash });

  const {
    data: policyHash,
    writeContract: writePolicy,
    isPending: isPolicyPending,
    error: policyError,
  } = useWriteContract();
  const policyReceipt = useWaitForTransactionReceipt({ hash: policyHash });

  const {
    data: grantHash,
    writeContract: writeGrant,
    isPending: isGrantPending,
    error: grantError,
  } = useWriteContract();
  const grantReceipt = useWaitForTransactionReceipt({ hash: grantHash });

  const {
    data: revokeHash,
    writeContract: writeRevoke,
    isPending: isRevokePending,
    error: revokeError,
  } = useWriteContract();
  const revokeReceipt = useWaitForTransactionReceipt({ hash: revokeHash });

  useEffect(() => {
    if (grantReceipt.isSuccess || revokeReceipt.isSuccess) {
      void roleHas.refetch();
    }
  }, [grantReceipt.isSuccess, revokeReceipt.isSuccess, roleHas.refetch]);

  if (!tokenAddress) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {t('issuance.manage.enterAddress')}
      </div>
    );
  }

  const doPause = async () => {
    writePause({ address: tokenAddress, abi: ABIS.TIP20Token, functionName: 'pause', args: [] });
  };
  const doUnpause = async () => {
    writeUnpause({ address: tokenAddress, abi: ABIS.TIP20Token, functionName: 'unpause', args: [] });
  };
  const doSetCap = async () => {
    if (!capInput.trim()) return;
    const cap = parseUnits(capInput, d);
    writeCap({ address: tokenAddress, abi: ABIS.TIP20Token, functionName: 'setSupplyCap', args: [cap] });
  };
  const doSetPolicy = async () => {
    if (!policyIdInput.trim()) return;
    const id = BigInt(policyIdInput);
    writePolicy({ address: tokenAddress, abi: ABIS.TIP20Token, functionName: 'changeTransferPolicyId', args: [id] });
  };
  const doGrant = async () => {
    if (!targetAccount) return;
    writeGrant({
      address: tokenAddress,
      abi: ABIS.TIP20Token,
      functionName: 'grantRole',
      args: [roleId, targetAccount],
    });
  };
  const doRevoke = async () => {
    if (!targetAccount) return;
    writeRevoke({
      address: tokenAddress,
      abi: ABIS.TIP20Token,
      functionName: 'revokeRole',
      args: [roleId, targetAccount],
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-6 flex items-center gap-2">
        <Shield className="h-6 w-6 text-[#66D121]" />
        <h2 className="text-xl font-bold">{t('issuance.manage.title', { symbol: s })}</h2>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">{t('issuance.manage.pauseTitle')}</h3>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {t('issuance.manage.pausedLabel')}{' '}
              {typeof paused === 'boolean' ? (paused ? t('common.yes') : t('common.no')) : '—'}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={doPause} disabled={!isConnected || !isTempo || isPausePending}>
              <PauseCircle className="h-4 w-4" /> {t('issuance.manage.pauseButton')}
            </Button>
            <Button type="button" variant="outline" onClick={doUnpause} disabled={!isConnected || !isTempo || isUnpausePending}>
              <PlayCircle className="h-4 w-4" /> {t('issuance.manage.unpauseButton')}
            </Button>
          </div>
          {(pauseError || unpauseError) ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {parseContractError(pauseError ?? unpauseError)}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.pauseStatus', {
              status: pauseReceipt.isLoading ? t('common.confirming') : pauseReceipt.isSuccess ? t('common.confirmed') : '—',
            })}{' '}
            |{' '}
            {t('issuance.manage.unpauseStatus', {
              status: unpauseReceipt.isLoading ? t('common.confirming') : unpauseReceipt.isSuccess ? t('common.confirmed') : '—',
            })}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          <h3 className="text-lg font-bold">{t('issuance.manage.supplyCapTitle')}</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.current')}{' '}
            {typeof supplyCap === 'bigint' ? `${formatUnits(supplyCap, d)} ${s}` : '—'}
          </p>
          <label className="mt-3 block text-sm font-medium">{t('issuance.manage.newCap', { symbol: s })}</label>
          <Input value={capInput} onChange={(e) => setCapInput(e.target.value)} placeholder="1000000" className="mt-2" />
          <Button type="button" onClick={doSetCap} disabled={!isConnected || !isTempo || !capInput.trim() || isCapPending} className="mt-3">
            {isCapPending ? t('common.submitting') : t('issuance.manage.setSupplyCap')}
          </Button>
          {capError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {parseContractError(capError)}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('common.status')}{' '}
            {capReceipt.isLoading ? t('common.confirming') : capReceipt.isSuccess ? t('common.confirmed') : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          <h3 className="text-lg font-bold">{t('issuance.manage.transferPolicyTitle')}</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.currentPolicyId')}{' '}
            {typeof transferPolicyId === 'bigint' ? transferPolicyId.toString() : '—'}
          </p>
          <label className="mt-3 block text-sm font-medium">{t('issuance.manage.newPolicyId')}</label>
          <Input value={policyIdInput} onChange={(e) => setPolicyIdInput(e.target.value)} placeholder="1" className="mt-2" />
          <Button type="button" onClick={doSetPolicy} disabled={!isConnected || !isTempo || !policyIdInput.trim() || isPolicyPending} className="mt-3">
            {isPolicyPending ? t('common.submitting') : t('issuance.manage.setTransferPolicy')}
          </Button>
          {policyError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {parseContractError(policyError)}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('common.status')}{' '}
            {policyReceipt.isLoading ? t('common.confirming') : policyReceipt.isSuccess ? t('common.confirmed') : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-800">
          <div className="mb-2 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-purple-500" />
            <h3 className="text-lg font-bold">{t('issuance.manage.rolesTitle')}</h3>
          </div>

          <label className="mt-2 block text-sm font-medium">{t('issuance.manage.roleLabel')}</label>
          <Select className="mt-2" value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleKey)}>
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>

          <label className="mt-3 block text-sm font-medium">{t('issuance.manage.accountOptional')}</label>
          <Input value={roleAccount} onChange={(e) => setRoleAccount(e.target.value)} placeholder={address ?? '0x...'} className="mt-2 font-mono" />

          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.hasRole')}{' '}
            {typeof roleHas.data === 'boolean' ? (roleHas.data ? t('common.yes') : t('common.no')) : '—'}
          </div>

          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.roleId')}{' '}
            <span className="inline-flex min-w-0 items-center gap-2 align-middle">
              <span className="min-w-0 truncate font-mono" title={roleId}>
                {truncateHex(roleId)}
              </span>
              <CopyButton value={roleId} />
            </span>
            {roleConstant.error ? ` · ${t('issuance.manage.roleIdReadFailed')}` : roleConstant.isLoading ? ` · ${t('issuance.manage.roleIdReading')}` : ''}
          </div>

          {roleConstant.error ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              {parseContractError(roleConstant.error)}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={doGrant} disabled={!isConnected || !isTempo || !targetAccount || isGrantPending}>
              {isGrantPending ? t('common.submitting') : t('issuance.manage.grant')}
            </Button>
            <Button type="button" variant="outline" onClick={doRevoke} disabled={!isConnected || !isTempo || !targetAccount || isRevokePending}>
              {isRevokePending ? t('common.submitting') : t('issuance.manage.revoke')}
            </Button>
          </div>

          {(grantError || revokeError) ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
              {parseContractError(grantError ?? revokeError)}
            </div>
          ) : null}

          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.manage.grantStatus', {
              status: isGrantPending
                ? t('common.submitting')
                : grantReceipt.isLoading
                  ? t('common.confirming')
                  : grantReceipt.isSuccess
                    ? t('common.confirmed')
                    : grantHash
                      ? t('common.submitted')
                      : '—',
            })}{' '}
            |{' '}
            {t('issuance.manage.revokeStatus', {
              status: isRevokePending
                ? t('common.submitting')
                : revokeReceipt.isLoading
                  ? t('common.confirming')
                  : revokeReceipt.isSuccess
                    ? t('common.confirmed')
                    : revokeHash
                      ? t('common.submitted')
                      : '—',
            })}
          </div>

          {(grantHash || revokeHash) && explorerBaseUrl ? (
            <div className="mt-2 flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-400">
              {grantHash ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">Grant tx:</span>
                  <a
                    className="font-mono text-[#2F6E0C] underline underline-offset-2 hover:opacity-90 dark:text-[#66D121]"
                    href={`${explorerBaseUrl}/tx/${grantHash}`}
                    target="_blank"
                    rel="noreferrer"
                    title={grantHash}
                  >
                    {truncateHex(grantHash)}
                  </a>
                  <CopyButton value={grantHash} />
                </div>
              ) : null}

              {revokeHash ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">Revoke tx:</span>
                  <a
                    className="font-mono text-[#2F6E0C] underline underline-offset-2 hover:opacity-90 dark:text-[#66D121]"
                    href={`${explorerBaseUrl}/tx/${revokeHash}`}
                    target="_blank"
                    rel="noreferrer"
                    title={revokeHash}
                  >
                    {truncateHex(revokeHash)}
                  </a>
                  <CopyButton value={revokeHash} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
