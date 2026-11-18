'use client';

/**
 * The small "…" on a sidebar item: Pin to top / Unpin, and Hide from my menu /
 * Show in my menu (Ease Plan 3, decisions 9–10).
 *
 * It appears on hover AND on keyboard focus — a hover-only control is one a
 * keyboard can never reach — and always on a touch screen, which has no
 * hover. Tab lands on it straight after its item's link.
 *
 * The menu itself is `RowMenu`'s pattern (components/ui/row-menu.tsx): a
 * portal positioned from the trigger's rect, because the rail is
 * `overflow-hidden` and a menu inside it would be cut off; Escape and an
 * outside click close it; arrow keys move between its items. Its trigger is
 * drawn for the dark rail, which RowMenu's is not.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, MoreHorizontal, Pin, PinOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const MENU_WIDTH = 200;

/**
 * After a pin or a hide the item is drawn somewhere else — a new button, the
 * old one gone — so focus follows it there, or lands on "Hidden (n)" when the
 * item folded away into it. Without this a keyboard is dropped at the top of
 * the page.
 */
const refocus = (href: string) =>
  requestAnimationFrame(() => {
    const moved = document.querySelector<HTMLElement>(`[data-nav-menu-for="${CSS.escape(href)}"]`);
    (moved ?? document.querySelector<HTMLElement>('[data-nav-hidden-toggle]'))?.focus();
  });

export function NavItemMenu({
  href,
  label,
  pinned,
  hidden,
  canHide,
  onTogglePin,
  onToggleHidden,
  alwaysVisible,
  className,
}: {
  href: string;
  /** The item's own name, for the button's and menu's labels. */
  label: string;
  pinned: boolean;
  hidden: boolean;
  /** False for My Work — the home page never hides. */
  canHide: boolean;
  onTogglePin: () => void;
  onToggleHidden: () => void;
  /** Shown without hover — the phone drawer. */
  alwaysVisible?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const actions: { label: string; icon: LucideIcon; onSelect: () => void }[] = [
    pinned
      ? { label: 'Unpin', icon: PinOff, onSelect: onTogglePin }
      : { label: 'Pin to top', icon: Pin, onSelect: onTogglePin },
    ...(canHide
      ? [
          hidden
            ? { label: 'Show in my menu', icon: Eye, onSelect: onToggleHidden }
            : { label: 'Hide from my menu', icon: EyeOff, onSelect: onToggleHidden },
        ]
      : []),
  ];

  useEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    // Capture, so scrolling the rail closes it too — it cannot drift from its button.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // The first choice takes focus on open, so the menu works without a mouse.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const move = (e: React.KeyboardEvent, delta: number) => {
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + delta + items.length) % items.length]?.focus();
  };

  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;
  const openUp = Boolean(rect && rect.bottom + actions.length * 34 + 20 > viewportH);
  const name = `Pin or hide ${label}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-nav-menu-for={href}
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg text-white/60 outline-none transition-[opacity,color,background-color] duration-150 hover:bg-white/10 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/40 motion-reduce:transition-none',
          open && 'bg-white/10 text-white',
          open || alwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100 pointer-coarse:opacity-100',
          className,
        )}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={name}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') move(e, 1);
              else if (e.key === 'ArrowUp') move(e, -1);
            }}
            className="fixed z-9999 rounded-xl border border-border bg-white p-1.5 shadow-overlay"
            style={{
              width: MENU_WIDTH,
              // Hung from the button's right edge, back over the rail.
              left: rect ? Math.max(8, rect.right - MENU_WIDTH) : 0,
              ...(openUp ? { bottom: rect ? viewportH - rect.top + 6 : 0 } : { top: rect ? rect.bottom + 6 : 0 }),
            }}
          >
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                  refocus(href);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-body outline-none transition-colors hover:bg-subtle hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              >
                <a.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
