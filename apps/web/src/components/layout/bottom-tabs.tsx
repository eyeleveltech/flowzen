'use client';

/**
 * The mobile tab bar.
 *
 * Same navigation as the sidebar, same two gates — role and what the
 * organisation has — but only four fit across a phone, so the rest live behind
 * "More". Nothing to switch between any more: the module switcher that used to
 * sit at the top of that sheet is gone with the mode itself.
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuthStore } from '@/stores';
import { NAV_ITEMS, BOTTOM_NAV_ITEMS, NavItem, canSee } from '@/config/navigation';
import { MoreHorizontal, LogOut, X } from 'lucide-react';

export function BottomTabs() {
  const shouldReduceMotion = useReducedMotion();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [showMore, setShowMore] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // The same permission switches the API enforces — so a tab is offered only
  // when the screen behind it will actually open.
  const allowed = (item: NavItem) => mounted && canSee(item, user?.permissions);

  const visiblePrimary = NAV_ITEMS.filter((i) => i.isPrimaryMobile).filter(allowed).slice(0, 4);
  const filteredMoreItems = [
    ...NAV_ITEMS.filter((i) => !visiblePrimary.includes(i)),
    ...BOTTOM_NAV_ITEMS,
  ].filter(allowed);

  const isMoreActive = filteredMoreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
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
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowMore(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white shadow-modal"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-line" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3">
                <h3 className="text-base font-semibold text-primary">More</h3>
                <button
                  onClick={() => setShowMore(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle text-secondary hover:bg-border transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Menu Items */}
              <nav className="px-3 pb-2">
                {filteredMoreItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setShowMore(false)}>
                      <div
                        className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 text-base font-medium transition-colors duration-150 motion-reduce:transition-none ${
                          isActive ? 'bg-primary text-white' : 'text-body hover:bg-surface'
                        }`}
                      >
                        <item.icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-secondary'}`} />
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* Sign Out */}
              <div className="border-t border-subtle px-3 py-2 pb-20">
                <button
                  onClick={() => {
                    logout();
                    window.location.href = '/login';
                  }}
                  className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-base font-medium text-danger hover:bg-danger-tint transition-colors"
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
                    transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <tab.icon
                  className={`h-5 w-5 transition-colors duration-150 ${isActive ? 'text-primary' : 'text-secondary'}`}
                />
                <span
                  className={`text-xs font-medium transition-colors duration-150 ${isActive ? 'text-primary' : 'text-secondary'}`}
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
                transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <MoreHorizontal
              className={`h-5 w-5 transition-colors duration-150 ${isMoreActive ? 'text-primary' : 'text-secondary'}`}
            />
            <span
              className={`text-xs font-medium transition-colors duration-150 ${isMoreActive ? 'text-primary' : 'text-secondary'}`}
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
