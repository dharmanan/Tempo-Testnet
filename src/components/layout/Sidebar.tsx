import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store';
import { useI18n } from '@/lib/i18n';
import {
  type LucideIcon,
  ArrowLeftRight,
  Droplet,
  LayoutDashboard,
  Inbox,
  Send,
  Settings,
  TrendingUp,
  Coins,
  UserRound,
} from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
}

type NavItem = {
  icon: LucideIcon;
  labelKey: string;
  descriptionKey?: string;
  path: string;
  end?: boolean;
};

const navItems: NavItem[] = [
  { icon: UserRound, labelKey: 'nav.account', path: '/account' },
  { icon: LayoutDashboard, labelKey: 'nav.dashboard', path: '/', end: true },
  { icon: Droplet, labelKey: 'nav.faucet', path: '/faucet' },
  { icon: Send, labelKey: 'nav.transfer', path: '/transfer' },
  { icon: Inbox, labelKey: 'nav.acceptPayment', path: '/payments/accept' },
  { icon: Coins, labelKey: 'nav.issuance', descriptionKey: 'nav.issuance.desc', path: '/issuance' },
  { icon: Coins, labelKey: 'nav.myTokens', path: '/tokens', end: true },
  { icon: ArrowLeftRight, labelKey: 'nav.swap', path: '/dex', end: true },
  { icon: TrendingUp, labelKey: 'nav.liquidity', path: '/dex/liquidity' },
  { icon: Settings, labelKey: 'nav.contracts', path: '/contracts' },
];

export function Sidebar({ isOpen = true }: SidebarProps) {
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const { t } = useI18n();

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] w-64 border-r border-gray-200 bg-white p-4 shadow-xl',
          'transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0 lg:shadow-none',
        )}
      >
        <nav className="flex flex-col gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              title={item.descriptionKey ? t(item.descriptionKey) : t(item.labelKey)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-[#66D121] text-white'
                    : 'text-gray-600 hover:bg-[#66D121]/10 hover:text-[#2F6E0C] dark:text-gray-300 dark:hover:bg-[#66D121]/15 dark:hover:text-[#66D121]',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <div className="flex min-w-0 flex-col">
                <div className="truncate">{t(item.labelKey)}</div>
                {item.descriptionKey ? (
                  <div className="truncate text-xs font-normal opacity-80">{t(item.descriptionKey)}</div>
                ) : null}
              </div>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
