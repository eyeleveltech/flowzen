'use client';

/**
 * The actions on a row, behind one button.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 *
 * The team screen carried five outlined buttons on every row — Access,
 * Password link, Switch off, Kit, Assign — which at fourteen people is seventy
 * buttons on one page. They took roughly a third of the table's width, which
 * squeezed the names into two lines each, and every one of them was drawn
 * identically: "Switch off", which ends somebody's account, looked exactly
 * like "Kit", which lists what they are carrying. A row of equal-weight
 * buttons is a row with no priority in it, and the eye has to read all five
 * before it can find the one it wants.
 *
 * One button. The actions are still one click away, but they are a list you
 * read top to bottom instead of a hedge you scan left to right, and the
 * destructive one can be marked as destructive without shouting on every row.
 *
 * ─── Why a portal ───────────────────────────────────────────────────────────
 *
 * A table lives inside `overflow-x-auto`, and an overflow value on one axis
 * makes the other a scroll container too — so a menu positioned inside the row
 * is clipped at the table's edge, and the last row's menu opens into nothing.
 * Positioned from the trigger's own rect, in a portal, the same way `Select`
 * does it, with the same close-on-scroll so it cannot drift away from the
 * button it belongs to.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

export type RowAction = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** `danger` for anything that removes, disables or cannot be undone. */
  tone?: 'default' | 'danger';
  /** Left out entirely when false. Gating belongs to the caller. */
  visible?: boolean;
};

const MENU_WIDTH = 200;

export function RowMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const shown = actions.filter((a) => a.visible !== false);

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
    // Capture, so a scroll inside the table closes it too — not just the window.
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

  // Focus the first item on open, so the menu is reachable without a mouse.
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

  if (shown.length === 0) return null;

  // Flip upwards when the menu would run off the bottom, so the last rows of a
  // long table are not the ones whose actions cannot be reached.
  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;
  const height = shown.length * 34 + 12;
  const openUp = Boolean(rect && rect.bottom + height + 8 > viewportH);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`rounded-lg border p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 ${
          open ? 'border-border bg-subtle text-primary' : 'border-transparent text-secondary hover:border-border hover:bg-subtle hover:text-primary'
        }`}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') move(e, 1);
              else if (e.key === 'ArrowUp') move(e, -1);
            }}
            className="fixed z-9999 rounded-xl border border-border bg-white p-1.5 shadow-overlay"
            style={{
              width: MENU_WIDTH,
              // Right-aligned to the trigger: the menu hangs back into the
              // table rather than off the right edge of the window.
              left: rect ? Math.max(8, rect.right - MENU_WIDTH) : 0,
              ...(openUp ? { bottom: rect ? viewportH - rect.top + 6 : 0 } : { top: rect ? rect.bottom + 6 : 0 }),
            }}
          >
            {shown.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    a.onSelect();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
                    a.tone === 'danger'
                      ? 'text-danger hover:bg-danger-tint'
                      : 'text-body hover:bg-subtle hover:text-primary'
                  }`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
                  {a.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
