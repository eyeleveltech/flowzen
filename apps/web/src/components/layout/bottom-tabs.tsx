'use client';

/**
 * The mobile tab bar.
 *
 * Same navigation as the sidebar, same two gates — role and what the
 * organisation has — but only four fit across a phone, so the rest live behind
 * "More". Nothing to switch between any more: the module switcher that used to
 * sit at the top of that sheet is gone with the mode itself.
 *
 * The person's own menu follows them here (Ease Plan 3, decisions 9–12): with
 * pins, the tabs are My Work and their first three pins; without, the usual
 * four. The More sheet has the sidebar's shape — Pinned, the rest, Hidden (n)
 * — and an "Edit menu" button, because a phone has no hover to show a pin on.
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useAuthStore } from '@/stores';
import {
  NAV_ITEMS,
  BOTTOM_NAV_ITEMS,
  HOME_HREF,
  NavItem,
  offered,
  bottomTabsFor,
  moreSheetFor,
} from '@/config/navigation';
import { ChevronDown, EyeOff, LogOut, MoreHorizontal, Pin, X } from 'lucide-react';
import { useNavMenu } from './use-nav-menu';

export function BottomTabs() {
  const shouldReduceMotion = useReducedMotion();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { togglePin, toggleHidden } = useNavMenu();
  const [showMore, setShowMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // The same permission switches the API enforces — so a tab is offered only
  // when the screen behind it will actually open.
  const allowed = (item: NavItem) => mounted && offered(item, user);

  // With pins: My Work and the first three. Without: the first four primaries, as ever.
  const visiblePrimary = mounted ? bottomTabsFor(user) : [];
  const more = mounted ? moreSheetFor(user, visiblePrimary) : { pinned: [], items: [], hidden: [] };
  const bottomItems = BOTTOM_NAV_ITEMS.filter(allowed);

  // Everything this person can open, for Edit menu — in the menu's own order.
  const editable = NAV_ITEMS.filter(allowed);
  const pinnedHrefs = new Set(user?.navPinned ?? []);
  const hiddenHrefs = new Set(user?.navHidden ?? []);

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const isMoreActive = [...more.pinned, ...more.items, ...bottomItems, ...more.hidden].some((item) => isCurrent(item.href));

  const close = () => {
    setShowMore(false);
    setEditing(false);
  };

  const row = (item: NavItem) => {
    const isActive = isCurrent(item.href);
    return (
      <Link key={item.href} href={item.href} onClick={close}>
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
  };

  const toggle = (on: boolean) =>
    `flex h-10 w-10 shrink-0 items-center justify-center rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none ${
      on ? 'bg-primary text-white' : 'bg-subtle text-secondary hover:bg-border'
    }`;

  return (
    <>
      {/* Bottom Sheet Overlay */}
      <AnimatePresence>
        {showMore && (
          <>
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={close}
            />
            <m.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90dvh] flex-col rounded-t-3xl bg-white shadow-modal"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1 w-10 rounded-full bg-line" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-5 py-3">
                <h3 className="text-base font-semibold text-primary">{editing ? 'Edit menu' : 'More'}</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    aria-pressed={editing}
                    className="rounded-full bg-subtle px-3.5 py-1.5 text-sm font-medium text-body outline-none transition-colors hover:bg-border focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {editing ? 'Done' : 'Edit menu'}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle text-secondary hover:bg-border transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editing ? (
                /* Edit menu — pin to put an item in the tabs and at the top; hide to fold it away. */
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-20">
                  <p className="px-4 pb-3 text-sm text-secondary text-pretty">
                    Your first three pins become the tabs at the bottom. Hidden items wait under Hidden at the end of More.
                  </p>
                  <ul className="space-y-1">
                    {editable.map((item) => {
                      const isPinned = pinnedHrefs.has(item.href);
                      const isHidden = !isPinned && hiddenHrefs.has(item.href);
                      return (
                        <li key={item.href} className="flex items-center gap-3 rounded-2xl px-4 py-2">
                          <item.icon className={`h-5 w-5 shrink-0 ${isHidden ? 'text-muted' : 'text-secondary'}`} />
                          <span className={`flex-1 text-base font-medium ${isHidden ? 'text-muted' : 'text-body'}`}>
                            {item.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => togglePin(item.href)}
                            aria-pressed={isPinned}
                            aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                            className={toggle(isPinned)}
                          >
                            <Pin className="h-4 w-4" aria-hidden="true" />
                          </button>
                          {item.href === HOME_HREF ? (
                            // The home page never hides; the gap keeps the column straight.
                            <span className="h-10 w-10 shrink-0" aria-hidden="true" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleHidden(item.href)}
                              aria-pressed={isHidden}
                              aria-label={isHidden ? `Show ${item.label} in my menu` : `Hide ${item.label} from my menu`}
                              className={toggle(isHidden)}
                            >
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <>
                  {/* Menu Items */}
                  <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
                    {more.pinned.length > 0 && (
                      <>
                        <p className="eyebrow px-4 pb-1 pt-1">Pinned</p>
                        {more.pinned.map(row)}
                        <div className="mx-4 my-2 border-t border-subtle" />
                      </>
                    )}
                    {more.items.map(row)}
                    {bottomItems.map(row)}

                    {more.hidden.length > 0 && (
                      <div className="mt-2 border-t border-subtle pt-2">
                        <button
                          type="button"
                          onClick={() => setHiddenOpen((v) => !v)}
                          aria-expanded={hiddenOpen}
                          aria-controls="more-hidden-items"
                          className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-base font-medium text-secondary outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <EyeOff className="h-5 w-5" aria-hidden="true" />
                          <span className="flex-1 text-left">Hidden ({more.hidden.length})</span>
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${hiddenOpen ? 'rotate-180' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                        {hiddenOpen && <div id="more-hidden-items">{more.hidden.map(row)}</div>}
                      </div>
                    )}
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
                </>
              )}

              {/* Safe area spacer for notched phones */}
              <div className="h-2" />
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/* Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white/95 backdrop-blur-xl safe-area-bottom">
        <nav className="flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
          {visiblePrimary.map((tab) => {
            const isActive = isCurrent(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-1 flex-col items-center gap-0.5 py-1 relative"
              >
                {isActive && (
                  <m.div
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
              <m.div
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
