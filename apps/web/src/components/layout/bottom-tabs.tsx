'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore, useModuleStore } from '@/stores';
import { moduleForPath, accessibleModules, ModuleKey } from '@/lib/modules';
import { NAV_ITEMS, BOTTOM_NAV_ITEMS, NavItem } from '@/config/navigation';
import {
  MoreHorizontal,
  ArrowLeftRight,
  LogOut,
  X,
} from 'lucide-react';

export function BottomTabs() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { activeModule: storeModule, setActiveModule } = useModuleStore();
  const [showMore, setShowMore] = useState(false);

  const routeModule = moduleForPath(pathname);
  useEffect(() => { if (routeModule) setActiveModule(routeModule); }, [routeModule, setActiveModule]);
  const activeModule: ModuleKey = routeModule ?? storeModule;
  const canSwitch = accessibleModules(user).length > 1;

  const inModule = (item: NavItem) => {
    if (!item.module) return true; // core (Settings, Profile)
    const mods = Array.isArray(item.module) ? item.module : [item.module];
    return mods.includes(activeModule);
  };
  const allowed = (item: NavItem) => (!item.roles || item.roles.includes(user?.role || '')) && inModule(item);

  const primaryNavItems = NAV_ITEMS.filter((item) => item.isPrimaryMobile);
  const moreNavItems = [
    ...NAV_ITEMS.filter((item) => !item.isPrimaryMobile),
    ...BOTTOM_NAV_ITEMS,
  ];

  const visiblePrimary = primaryNavItems.filter(allowed);
  const filteredMoreItems = moreNavItems.filter(allowed);

  const isMoreActive = filteredMoreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  return (
    <>
      {/* Bottom Sheet Overlay */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowMore(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white shadow-2xl"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-[#D1D5DB]" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3">
                <h3 className="text-base font-semibold text-primary">More</h3>
                <button
                  onClick={() => setShowMore(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3F4F6] text-secondary hover:bg-border transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Menu Items */}
              <nav className="px-3 pb-2">
                {canSwitch && (
                  <Link href="/modules" onClick={() => setShowMore(false)}>
                    <div className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all border border-border mb-1">
                      <ArrowLeftRight className="h-5 w-5 text-[#9CA3AF]" />
                      Switch module
                    </div>
                  </Link>
                )}
                {filteredMoreItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setShowMore(false)}
                    >
                      <div
                        className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium transition-all duration-150 ${isActive
                            ? 'bg-primary text-white'
                            : 'text-[#374151] hover:bg-[#F9FAFB]'
                          }`}
                      >
                        <item.icon
                          className={`h-5 w-5 ${isActive ? 'text-white' : 'text-[#9CA3AF]'
                            }`}
                        />
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* Sign Out */}
              <div className="border-t border-[#F3F4F6] px-3 py-2 pb-20">
                <button
                  onClick={() => {
                    logout();
                    window.location.href = '/login';
                  }}
                  className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-danger hover:bg-red-50 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                  Sign out
                </button>
              </div>

              {/* Safe area spacer for notched phones */}
              <div className="h-2" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white/95 backdrop-blur-xl safe-area-bottom">
        <nav className="flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
          {visiblePrimary.map((tab) => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-1 flex-col items-center gap-0.5 py-1 relative"
              >
                {isActive && (
                  <motion.div
                    layoutId="bottom-tab-indicator"
                    className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <tab.icon
                  className={`h-5 w-5 transition-colors duration-150 ${isActive ? 'text-primary' : 'text-[#9CA3AF]'
                    }`}
                />
                <span
                  className={`text-[10px] font-medium transition-colors duration-150 ${isActive ? 'text-primary' : 'text-[#9CA3AF]'
                    }`}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}

          {/* More tab */}
          <button
            onClick={() => setShowMore(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-1 relative"
          >
            {isMoreActive && (
              <motion.div
                layoutId="bottom-tab-indicator"
                className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <MoreHorizontal
              className={`h-5 w-5 transition-colors duration-150 ${isMoreActive ? 'text-primary' : 'text-[#9CA3AF]'
                }`}
            />
            <span
              className={`text-[10px] font-medium transition-colors duration-150 ${isMoreActive ? 'text-primary' : 'text-[#9CA3AF]'
                }`}
            >
              More
            </span>
          </button>
        </nav>

        {/* iPhone safe area padding */}
        <div className="h-safe-area-bottom" />
      </div>
    </>
  );
}
