import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { Coins } from 'lucide-react';
import { isAddress, keccak256, parseEventLogs, toBytes } from 'viem';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { CONTRACTS } from '@/config/contracts';
import { ABIS } from '@/contracts/abis';
import { TESTNET_ADDRESSES } from '@/contracts/addresses/testnet';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/common/CopyButton';
import { parseContractError } from '@/utils/errorParser';
import { cn } from '@/lib/utils';
import { addRecentToken } from '@/lib/recentTokens';
import { useI18n } from '@/lib/i18n';
import { markTaskCompleted } from '@/lib/taskProgressStorage';

type Address = `0x${string}`;

function randomSalt(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (`0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`) as Address;
}

function asBytes32(userInput: string): Address | null {
  const value = userInput.trim();
  if (!value) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value as Address;
  return keccak256(toBytes(value)) as Address;
}

export function CreateTokenForm() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const isTempo = chainId === tempoTestnet.id;
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const factory = useMemo(() => CONTRACTS.find((c) => c.key === 'tokenFactory')?.address, []);
  const known = TESTNET_ADDRESSES[tempoTestnet.id];

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [quoteToken, setQuoteToken] = useState<Address>(known.PathUSD);
  const [showCurrency, setShowCurrency] = useState(false);
  const [showQuotePicker, setShowQuotePicker] = useState(false);
  const [useCustomAdmin, setUseCustomAdmin] = useState(false);
  const [admin, setAdmin] = useState<Address | ''>('');
  const [useCustomSalt, setUseCustomSalt] = useState(false);
  const [saltInput, setSaltInput] = useState<string>(() => randomSalt());

  const saltBytes32 = useMemo(() => asBytes32(saltInput), [saltInput]);
  const adminAddress: Address | null = useMemo(() => {
    if (!useCustomAdmin) return address ?? null;
    const raw = admin.trim();
    if (raw.length === 0) return null;
    return isAddress(raw) ? (raw as Address) : null;
  }, [admin, address, useCustomAdmin]);

  const { data: predicted } = useReadContract({
    address: factory,
    abi: ABIS.TokenFactory,
    functionName: 'getTokenAddress',
    args: address && saltBytes32 ? [address, saltBytes32] : undefined,
    query: { enabled: Boolean(isTempo && factory && address && saltBytes32) },
  });

  const {
    data: createHash,
    writeContract: writeCreate,
    isPending: isCreatePending,
    error: createError,
  } = useWriteContract();

  const createReceipt = useWaitForTransactionReceipt({ hash: createHash });

  const createdToken = useMemo(() => {
    if (!createReceipt.data?.logs?.length) return null;
    try {
      const parsed = parseEventLogs({
        abi: ABIS.TokenFactory,
        logs: createReceipt.data.logs,
        eventName: 'TokenCreated',
      }) as unknown as Array<{ args?: { token?: Address } }>;
      const first = parsed[0];
      const token = first?.args?.token;
      return token ?? null;
    } catch {
      return null;
    }
  }, [createReceipt.data]);

  useEffect(() => {
    if (!address) return;
    if (!isTempo) return;
    if (!createReceipt.isSuccess) return;
    markTaskCompleted(chainId, address, 'create_token_once', { txHash: createHash });
  }, [address, chainId, createHash, createReceipt.isSuccess, isTempo]);

  const quoteTokenLabel = useMemo(() => {
    const lowered = quoteToken.toLowerCase();
    if (known.PathUSD.toLowerCase() === lowered) return 'PathUSD';
    if (known.AlphaUSD.toLowerCase() === lowered) return 'AlphaUSD';
    if (known.BetaUSD.toLowerCase() === lowered) return 'BetaUSD';
    if (known.ThetaUSD.toLowerCase() === lowered) return 'ThetaUSD';
    return quoteToken;
  }, [quoteToken, known.PathUSD, known.AlphaUSD, known.BetaUSD, known.ThetaUSD]);

  useEffect(() => {
    if (!createdToken) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('token', createdToken);
      return next;
    });

    if (chainId && address) {
      addRecentToken(chainId, address, createdToken);
    }
  }, [createdToken, setSearchParams, chainId, address]);

  const submit = async () => {
    if (!isConnected || !address) return;
    if (!isTempo) return;
    if (!factory) return;
    if (!name.trim() || !symbol.trim() || !currency.trim()) return;
    if (!isAddress(quoteToken)) return;
    if (!saltBytes32) return;
    if (!adminAddress) return;

    writeCreate({
      address: factory,
      abi: ABIS.TokenFactory,
      functionName: 'createToken',
      args: [name.trim(), symbol.trim(), currency.trim(), quoteToken, adminAddress, saltBytes32],
    });
  };

  const canSubmit =
    Boolean(
      isConnected &&
        isTempo &&
        factory &&
        name.trim().length > 0 &&
        symbol.trim().length > 0 &&
        currency.trim().length > 0 &&
        isAddress(quoteToken) &&
        saltBytes32 &&
        adminAddress,
    ) && !isCreatePending;

  const isAdminWallet = useMemo(() => {
    if (!adminAddress || !address) return false;
    return adminAddress.toLowerCase() === address.toLowerCase();
  }, [adminAddress, address]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-6 flex items-center gap-2">
        <Coins className="h-6 w-6 text-[#66D121]" />
        <h2 className="text-xl font-bold">{t('issuance.create.title')}</h2>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
        <div className="font-semibold">{t('issuance.create.simpleMode')}</div>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-gray-700 dark:text-gray-300">
          <li>{t('issuance.create.step1')}</li>
          <li>{t('issuance.create.step2')}</li>
          <li>{t('issuance.create.step3')}</li>
        </ol>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('issuance.create.previewLabel')}</div>
        <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">
          <span className="font-semibold">{name.trim() || '—'}</span>{' '}
          <span className="text-gray-600 dark:text-gray-400">({symbol.trim() || '—'})</span>
          <span className="text-gray-600 dark:text-gray-400"> {t('issuance.create.represents')}{' '} </span>
          <span className="font-semibold">{currency.trim() || '—'}</span>
          <span className="text-gray-600 dark:text-gray-400"> {t('issuance.create.dexPair')}{' '} </span>
          <span className="font-semibold">{quoteTokenLabel}</span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium">{t('issuance.create.nameLabel')}</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('issuance.create.namePlaceholder')}
            className="mt-2"
          />
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{t('issuance.create.nameHelp')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium">{t('issuance.create.symbolLabel')}</label>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder={t('issuance.create.symbolPlaceholder')}
            maxLength={12}
            className="mt-2 uppercase"
          />
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{t('issuance.create.symbolHelp')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium">{t('issuance.create.referencePairLabel')}</label>
          {!showQuotePicker ? (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-800">
              <div>
                <div className="text-xs text-gray-600 dark:text-gray-300">{t('issuance.create.defaultLabel')}</div>
                <div className="mt-1 font-mono text-xs">{quoteTokenLabel}</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowQuotePicker(true)}>
                {t('issuance.create.change')}
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <Select
                className="font-mono"
                value={quoteToken}
                onChange={(e) => setQuoteToken(e.target.value as Address)}
              >
                <option value={known.PathUSD}>PathUSD</option>
                <option value={known.AlphaUSD}>AlphaUSD</option>
                <option value={known.BetaUSD}>BetaUSD</option>
                <option value={known.ThetaUSD}>ThetaUSD</option>
              </Select>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuoteToken(known.PathUSD);
                    setShowQuotePicker(false);
                  }}
                >
                  {t('issuance.create.useDefault')}
                </Button>
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('issuance.create.referencePairHelp')}
          </p>
        </div>

        <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t('issuance.create.advancedSummary')}
          </summary>

          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300">
              {t('issuance.create.advancedTip')}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={showCurrency}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setShowCurrency(checked);
                    if (!checked) setCurrency('USD');
                  }}
                />
                {t('issuance.create.changeUnitLabel')}
              </label>
              {showCurrency ? (
                <>
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="USD"
                    className="mt-2"
                  />
                  {currency.trim().toUpperCase() !== 'USD' ? (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                      ⚠️ {t('issuance.create.currencyWarning')}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-800">
                  <div className="text-xs text-gray-600 dark:text-gray-300">{t('issuance.create.unitLabelDefault')}</div>
                  <div className="mt-1 font-mono text-xs">USD</div>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.create.unitLabelHelp')}
              </p>
              {showCurrency ? (
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCurrency('USD');
                      setShowCurrency(false);
                    }}
                  >
                    {t('issuance.create.resetToUsd')}
                  </Button>
                </div>
              ) : null}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={useCustomAdmin}
                  onChange={(e) => setUseCustomAdmin(e.target.checked)}
                />
                {t('issuance.create.useCustomAdmin')}
              </label>
              {useCustomAdmin ? (
                <Input
                  value={admin}
                  onChange={(e) => setAdmin(e.target.value as Address)}
                  placeholder="0x..."
                  className={cn('mt-2 font-mono', adminAddress ? '' : 'border-red-400')}
                />
              ) : (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-800">
                  <div className="text-xs text-gray-600 dark:text-gray-300">{t('issuance.create.adminDefault')}</div>
                  <div className="mt-1 font-mono text-xs">{address ?? t('issuance.create.connectWalletToSetDefault')}</div>
                </div>
              )}
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.create.adminHelp')}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={useCustomSalt}
                  onChange={(e) => setUseCustomSalt(e.target.checked)}
                />
                {t('issuance.create.useCustomSalt')}
              </label>

              {useCustomSalt ? (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={saltInput}
                    onChange={(e) => setSaltInput(e.target.value)}
                    placeholder={t('issuance.create.saltPlaceholder')}
                    className={cn('font-mono', saltBytes32 ? '' : 'border-red-400')}
                  />
                  <Button type="button" variant="outline" onClick={() => setSaltInput(randomSalt())}>
                    {t('issuance.create.random')}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-800">
                  <div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">{t('issuance.create.saltAuto')}</div>
                    <div className="mt-1 font-mono text-xs">{saltBytes32 ?? '—'}</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSaltInput(randomSalt())}>
                    {t('issuance.create.regenerate')}
                  </Button>
                </div>
              )}

              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t('issuance.create.saltHelp')}
              </p>
            </div>

          </div>
        </details>

        <details className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <summary className="cursor-pointer select-none text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t('issuance.create.debugInfo')}
          </summary>
          <div className="mt-4 space-y-3 text-xs text-gray-700 dark:text-gray-300">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-gray-600 dark:text-gray-300">{t('issuance.create.factory')}</div>
              <div className="mt-1 font-mono">{factory ?? '—'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-gray-600 dark:text-gray-300">{t('issuance.create.predictedAddress')}</div>
              <div className="mt-1 font-mono">{typeof predicted === 'string' ? predicted : '—'}</div>
            </div>
            {createHash ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-gray-600 dark:text-gray-300">{t('issuance.create.transactionHash')}</div>
                    <div className="mt-1 truncate font-mono">{createHash}</div>
                  </div>
                  <CopyButton value={createHash} />
                </div>
              </div>
            ) : null}
          </div>
        </details>

        {createHash ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-800">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {createReceipt.isLoading
                ? t('issuance.create.statusCreating')
                : createReceipt.isSuccess
                  ? t('issuance.create.statusCreated')
                  : createReceipt.isError
                    ? t('issuance.create.statusFailed')
                    : t('issuance.create.statusSubmitted')}
            </div>

            {createdToken ? (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-600 dark:text-gray-300">{t('issuance.create.tokenAddress')}</div>
                    <div className="mt-1 truncate font-mono text-xs">{createdToken}</div>
                  </div>
                  <CopyButton value={createdToken} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/issuance/mint?token=' + encodeURIComponent(createdToken))}
                  >
                    {t('issuance.create.goToSupply')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/issuance/manage?token=' + encodeURIComponent(createdToken))}
                  >
                    {t('issuance.create.goToManage')}
                  </Button>
                </div>

                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="font-semibold">{t('issuance.create.nextStepsIssuerTitle')}</div>
                  <div className="mt-1">
                    {isAdminWallet
                      ? t('issuance.create.nextStepsIssuerSelf')
                      : t('issuance.create.nextStepsIssuerNeedAdmin', {
                          admin: adminAddress ?? '—',
                        })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {createError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {parseContractError(createError)}
          </div>
        ) : null}

        <Button type="button" onClick={submit} disabled={!canSubmit} className="w-full">
          {isCreatePending ? t('common.submitting') : t('issuance.create.createButton')}
        </Button>

        <p className="text-xs text-gray-600 dark:text-gray-400">
          {t('issuance.create.requiresTip')}
        </p>
      </div>
    </div>
  );
}
