import { useI18n } from '@/lib/i18n';

export function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 py-6 dark:border-gray-800">
      <div className="text-center">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('footer.title')}</div>
        <p className="mx-auto mt-2 max-w-3xl text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          {t('footer.disclaimer')}
        </p>
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500">{t('footer.copyright', { year })}</div>
      </div>
    </footer>
  );
}
