import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { useAppStore } from '@/store';
import { DesktopOnlyOverlay } from '@/components/common/DesktopOnlyOverlay';

export function MainLayout({ children }: { children: ReactNode }) {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  return (
    <div className="min-h-screen">
      <DesktopOnlyOverlay />
      <Header />
      <div className="mx-auto flex w-full max-w-6xl px-4">
        <Sidebar isOpen={sidebarOpen} />
        <div className="min-h-[calc(100vh-4rem)] flex flex-1 flex-col lg:ml-64">
          <main className="flex-1 p-4 sm:p-6">{children}</main>
          <Footer />
        </div>
      </div>
    </div>
  );
}
