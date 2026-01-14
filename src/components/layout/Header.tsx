import { useAppStore } from '@/store';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { BookOpen, Github, Menu, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

export function Header() {
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  const { locale, setLocale, t } = useI18n();

  const formatChainName = (name?: string) => {
    if (!name) return t('header.network');
    if (name === 'Tempo Moderato Testnet') return 'Tempo M. Testnet';
    return name;
  };

  const headerLinkClassName =
    'inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 ' +
    'transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-gray-900/95 dark:supports-[backdrop-filter]:bg-gray-900/60">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:py-0">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('header.toggleSidebar')}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <img src="/logo.svg" alt="Tempo" className="h-7 w-7 dark:hidden" />
          <img src="/logo-dark.svg" alt="Tempo" className="hidden h-7 w-7 dark:block" />

          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-xl font-semibold leading-none sm:text-2xl">
              {t('header.appTitle')}
            </span>

            <div className="ml-3 flex shrink-0 items-center gap-2">
              <a
                href="https://x.com/tempo"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
                title="X"
                className={headerLinkClassName + ' hover:text-[#1d9bf0]'}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.6 2H22l-7.43 8.49L23.5 22h-6.9l-5.4-7.06L4.6 22H1.2l7.95-9.08L.5 2h7.1l4.88 6.33L18.6 2Zm-1.2 18h1.88L6.6 3.9H4.58L17.4 20Z" />
                </svg>
              </a>

              <a
                href="https://github.com/tempoxyz"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                title="GitHub"
                className={headerLinkClassName}
              >
                <Github className="h-5 w-5" />
              </a>

              <a
                href="https://docs.tempo.xyz/"
                target="_blank"
                rel="noreferrer"
                aria-label="Docs"
                title="Docs"
                className={headerLinkClassName}
              >
                <BookOpen className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="Language"
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'en' | 'tr')}
            className="h-9 w-[5.75rem] rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 sm:w-auto"
          >
            <option value="en">{t('lang.english')}</option>
            <option value="tr">{t('lang.turkish')}</option>
          </select>

          <Button type="button" onClick={toggleTheme} variant="outline" size="icon" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>

          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              if (!connected) {
                return (
                  <Button type="button" onClick={openConnectModal} size="sm">
                    {t('header.connect')}
                  </Button>
                );
              }

              if (chain.unsupported) {
                return (
                  <Button type="button" onClick={openChainModal} variant="outline" tone="red" size="sm">
                    {t('header.wrongNetwork')}
                  </Button>
                );
              }

              return (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={openChainModal}
                    variant="outline"
                    size="sm"
                    className="hidden max-w-[10rem] truncate sm:inline-flex"
                    title={chain.name}
                  >
                    {formatChainName(chain.name)}
                  </Button>

                  <Button
                    type="button"
                    onClick={openAccountModal}
                    variant="outline"
                    size="sm"
                    className="max-w-[9rem] truncate sm:max-w-[12rem]"
                    title={account.displayName}
                  >
                    {account.displayName}
                  </Button>
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
