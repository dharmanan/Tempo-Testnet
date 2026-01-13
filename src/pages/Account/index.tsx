import { ExternalLink, UserRound, Droplet, Send, Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId, useSwitchChain, useWalletClient } from 'wagmi';

import { PageContainer } from '@/components/layout/PageContainer';
import { CopyButton } from '@/components/common/CopyButton';
import { Button } from '@/components/ui/button';
import { tempoTestnet } from '@/lib/chains/tempoTestnet';
import { useI18n } from '@/lib/i18n';

type RequestFn = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

type Eip1193Provider = {
  request?: RequestFn;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  off?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

function getInjectedEthereum(): unknown {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { ethereum?: unknown }).ethereum;
}

function hasRequest(value: unknown): value is { request: RequestFn } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'request' in value &&
    typeof (value as { request?: unknown }).request === 'function'
  );
}

function hasGetProvider(value: unknown): value is { getProvider: () => Promise<unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getProvider' in value &&
    typeof (value as { getProvider?: unknown }).getProvider === 'function'
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? 'rounded-full bg-[#66D121]/15 px-2.5 py-1 text-xs font-semibold text-[#2F6E0C] dark:text-[#66D121]'
          : 'rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }
    >
      {label}
    </span>
  );
}

export default function Account() {
  const { t } = useI18n();
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const [isAddingChain, setIsAddingChain] = useState(false);
  const [addChainError, setAddChainError] = useState<string | null>(null);

  const [walletReportedChainId, setWalletReportedChainId] = useState<number | null>(null);
  const [isWalletChainIdKnown, setIsWalletChainIdKnown] = useState(false);

  const injectedEthereum = getInjectedEthereum();
  const browserWalletRequest: RequestFn | null = hasRequest(injectedEthereum) ? injectedEthereum.request : null;

  useEffect(() => {
    let cancelled = false;
    let activeProvider: Eip1193Provider | null = null;

    function parseChainId(hex: unknown): number | null {
      if (typeof hex !== 'string') return null;
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function setKnownChainId(next: number | null) {
      if (cancelled) return;
      setWalletReportedChainId(next);
      setIsWalletChainIdKnown(next !== null);
    }

    const handleChainChanged = (...args: unknown[]) => {
      const [nextChainIdHex] = args;
      setKnownChainId(parseChainId(nextChainIdHex));
    };

    async function syncWalletChainId() {
      try {
        // Prefer the *active connector's* provider when connected (WalletConnect, Coinbase, Injected, etc.)
        // so we don't accidentally read from a different installed wallet extension.
        if (isConnected && connector && hasGetProvider(connector)) {
          try {
            const provider = await connector.getProvider();
            activeProvider = typeof provider === 'object' && provider !== null ? (provider as Eip1193Provider) : null;
          } catch {
            activeProvider = null;
          }
        }

        // If not connected, fall back to injected browser wallet (MetaMask/Coinbase extension) if present.
        if (!activeProvider) {
          const injected = getInjectedEthereum();
          activeProvider = typeof injected === 'object' && injected !== null ? (injected as Eip1193Provider) : null;
        }

        const request: RequestFn | null =
          activeProvider && typeof activeProvider.request === 'function'
            ? (activeProvider.request.bind(activeProvider) as unknown as RequestFn)
            : walletClient?.request
              ? (walletClient.request as unknown as RequestFn)
              : null;

        if (!request) {
          if (!cancelled) {
            setWalletReportedChainId(null);
            setIsWalletChainIdKnown(false);
          }
          return;
        }

        const hex = await request({ method: 'eth_chainId' });
        setKnownChainId(parseChainId(hex));

        // Keep it fresh when the wallet changes networks.
        if (activeProvider && typeof activeProvider.on === 'function') {
          activeProvider.on('chainChanged', handleChainChanged);
        }
      } catch {
        if (!cancelled) {
          setWalletReportedChainId(null);
          setIsWalletChainIdKnown(false);
        }
      }
    }

    void syncWalletChainId();
    return () => {
      cancelled = true;
      if (activeProvider && typeof activeProvider.removeListener === 'function') {
        activeProvider.removeListener('chainChanged', handleChainChanged);
      } else if (activeProvider && typeof activeProvider.off === 'function') {
        activeProvider.off('chainChanged', handleChainChanged);
      }
    };
  }, [isConnected, connector, walletClient, chainId]);

  const isOnTempo = isConnected && isWalletChainIdKnown && walletReportedChainId === tempoTestnet.id;
  const isNetworkUnknown = isConnected && !isWalletChainIdKnown;
  const canAddTempoNetwork = Boolean(browserWalletRequest ?? walletClient?.request);

  async function addTempoToWallet() {
    setAddChainError(null);

    const request = browserWalletRequest ?? (walletClient?.request ? walletClient.request : null);

    if (!request) {
      setAddChainError(
        t('page.account.addNetwork.noApi'),
      );
      return;
    }

    setIsAddingChain(true);
    try {
      // MetaMask (and some other wallets) can be picky about `nativeCurrency.decimals`.
      // Tempo doesn't expose a meaningful native balance anyway, so we use a standard 18-decimal placeholder here.
      const addChainParams = {
        chainId: `0x${tempoTestnet.id.toString(16)}`,
        chainName: tempoTestnet.name,
        nativeCurrency: {
          name: 'Tempo',
          symbol: 'TEMPO',
          decimals: 18,
        },
        rpcUrls: tempoTestnet.rpcUrls.default.http,
        blockExplorerUrls: tempoTestnet.blockExplorers?.default?.url ? [tempoTestnet.blockExplorers.default.url] : [],
      };

      await request({
        method: 'wallet_addEthereumChain',
        params: [
          addChainParams,
        ],
      });

      // Some wallets auto-switch after adding; some don't.
      switchChain({ chainId: tempoTestnet.id });
    } catch (err: unknown) {
      const e = err as { message?: unknown; code?: unknown };
      const code = typeof e?.code === 'number' ? e.code : undefined;
      const message = err instanceof Error ? err.message : String(e?.message ?? err);

      if (code === 4001) {
        setAddChainError(t('page.account.addNetwork.rejected'));
        return;
      }

      // Some wallets use 4902 when a chain has not been added yet.
      // Here we are already trying to add it, so just surface the raw error.
      setAddChainError(message);
    } finally {
      setIsAddingChain(false);
    }
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">{t('page.account.title')}</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t('page.account.subtitle')}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <div className="font-semibold">{t('page.account.faq.signIn.title')}</div>
          <div className="mt-1">
            {t('page.account.faq.signIn.answer1Prefix')}{' '}
            <span className="font-semibold">{t('page.account.faq.signIn.acceptPayment')}</span>{' '}
            {t('page.account.faq.signIn.answer1Suffix')}
          </div>
          <div className="mt-2 text-gray-600 dark:text-gray-400">
            {t('page.account.faq.signIn.answer2Prefix')}{' '}
            <span className="font-semibold">{t('page.account.faq.signIn.signInSignUp')}</span>{' '}
            {t('page.account.faq.signIn.answer2Suffix')}
          </div>
          <a
            className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
            href="https://docs.tempo.xyz/guide/use-accounts/embed-passkeys"
            target="_blank"
            rel="noreferrer"
          >
            {t('page.account.faq.signIn.learnPasskey')}
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            ok={isConnected}
            label={
              isConnected ? t('page.account.status.walletConnected') : t('page.account.status.noWalletConnected')
            }
          />
          <StatusPill
            ok={isOnTempo}
            label={isOnTempo ? t('page.account.status.tempoNetwork') : isNetworkUnknown ? t('page.account.status.networkUnknown') : t('page.account.status.wrongNetwork')}
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-6 w-6 text-[#66D121]" />
            <h2 className="text-xl font-bold">{t('page.account.step1.title')}</h2>
          </div>

          {!isConnected ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                {t('page.account.step1.clickConnectPrefix')}{' '}
                <span className="font-semibold">{t('page.account.step1.connect')}</span>{' '}
                {t('page.account.step1.clickConnectSuffix')}
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {t('page.account.step1.tip')}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
                {t('page.account.step1.connectedWallet')}
                {address ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-mono break-all">{address}</span>
                    <CopyButton value={address} />
                  </div>
                ) : null}
              </div>
              <a
                className="inline-flex items-center gap-2 text-sm font-semibold text-[#2F6E0C] hover:underline dark:text-[#66D121]"
                href="https://docs.tempo.xyz/quickstart/connection-details"
                target="_blank"
                rel="noreferrer"
              >
                {t('page.account.step1.connectionDetails')}
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#66D121]/15 text-sm font-bold text-[#2F6E0C] dark:text-[#66D121]">
              2
            </span>
            <h2 className="text-xl font-bold">{t('page.account.step2.title')}</h2>
          </div>

          <div className="space-y-3">
            {!isConnected ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('page.account.step2.notConnectedHelp')}
              </div>
            ) : isNetworkUnknown ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                {t('page.account.step2.networkUnknownTitle')}
                <div className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/90">
                  {t('page.account.step2.networkUnknownHelp')}
                </div>
              </div>
            ) : isOnTempo ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
                {t('page.account.step2.onTempoPrefix')}{' '}
                <span className="font-semibold">{tempoTestnet.name}</span>.
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                {t('page.account.step2.wrongNetworkPrefix')}{' '}
                <span className="font-semibold">{tempoTestnet.name}</span>.
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {isConnected ? (
                <Button
                  type="button"
                  onClick={() => switchChain({ chainId: tempoTestnet.id })}
                  disabled={isSwitchingChain || isOnTempo}
                >
                  {isOnTempo
                    ? t('page.account.step2.switch.onTempo')
                    : isSwitchingChain
                      ? t('page.account.step2.switch.switching')
                      : t('page.account.step2.switch.switch')}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={addTempoToWallet}
                disabled={!canAddTempoNetwork || isAddingChain || isSwitchingChain}
              >
                {isAddingChain ? t('page.account.step2.addNetwork.adding') : t('page.account.step2.addNetwork.add')}
              </Button>

              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('page.account.step2.metamaskHintPrefix')}{' '}
                <span className="font-semibold">{t('page.account.step2.metamaskHintAction')}</span>{' '}
                {t('page.account.step2.metamaskHintSuffix')}
              </div>
            </div>

            {!canAddTempoNetwork ? (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {t('page.account.step2.noWalletSupportsAddNetwork')}
              </div>
            ) : null}

            {addChainError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                {addChainError}
              </div>
            ) : null}
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
            {t('page.account.step2.nativeBalanceNote')}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <Droplet className="h-6 w-6 text-[#66D121]" />
            <h2 className="text-xl font-bold">{t('page.account.step3.title')}</h2>
          </div>

          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('page.account.step3.help')}
          </p>

          <div className="mt-4">
            <Link
              to="/faucet"
              className="inline-flex items-center gap-2 rounded-lg bg-[#66D121] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5BB61D]"
            >
              {t('page.account.step3.openFaucet')}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Link
            to="/transfer"
            className="rounded-xl border border-gray-200 bg-white p-5 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
          >
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-[#66D121]" />
              <div className="font-semibold">{t('page.account.cards.sendTokens.title')}</div>
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('page.account.cards.sendTokens.desc')}</div>
          </Link>

          <Link
            to="/payments/accept"
            className="rounded-xl border border-gray-200 bg-white p-5 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
          >
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-[#66D121]" />
              <div className="font-semibold">{t('page.account.cards.acceptPayment.title')}</div>
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('page.account.cards.acceptPayment.desc')}</div>
          </Link>

          <a
            href="https://docs.tempo.xyz/guide/payments/accept-a-payment"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-gray-200 bg-white p-5 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
          >
            <div className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5 text-[#66D121]" />
              <div className="font-semibold">{t('page.account.cards.readDocs.title')}</div>
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('page.account.cards.readDocs.desc')}</div>
          </a>
        </div>

      </div>
    </PageContainer>
  );
}
