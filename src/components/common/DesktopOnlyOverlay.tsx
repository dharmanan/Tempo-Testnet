import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

const STORAGE_KEY = 'tempo.desktopOnlyDismissed:v1';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);

    setMatches(mql.matches);

    // Safari < 14
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export function DesktopOnlyOverlay() {
  const { t } = useI18n();
  const isSmallScreen = useMediaQuery('(max-width: 767px)');

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // If the user later opens on desktop, reset state (so it shows again next time on mobile).
  useEffect(() => {
    if (!isSmallScreen) setDismissed(false);
  }, [isSmallScreen]);

  const shouldShow = useMemo(() => isSmallScreen && !dismissed, [dismissed, isSmallScreen]);
  if (!shouldShow) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-lg font-bold">{t('app.desktopOnly.title')}</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('app.desktopOnly.body')}</p>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(STORAGE_KEY, '1');
              } catch {
                // ignore
              }
              setDismissed(true);
            }}
          >
            {t('app.desktopOnly.continue')}
          </Button>

          <a
            className="text-center text-sm font-semibold text-purple-600 hover:underline dark:text-purple-300"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              // Best effort: on mobile we can hint to open on desktop.
              try {
                navigator.clipboard?.writeText(window.location.href);
              } catch {
                // ignore
              }
            }}
          >
            {t('app.desktopOnly.tip')}
          </a>
        </div>
      </div>
    </div>
  );
}
