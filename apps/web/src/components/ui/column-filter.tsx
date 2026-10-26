"use client";

/**
 * A filter on a table column, opened from its header.
 *
 * `ColumnFilter` is a checklist of the values the column holds, each with how
 * many rows carry it; ticking narrows the table at once. `ColumnTextFilter` is
 * a search box for a free-text column. Either shows its funnel in the accent
 * colour while it is narrowing anything, so a filtered table says so in the
 * header it was filtered from.
 */

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string; count: number };

/** The funnel in the header, and the panel it opens, placed under it in the page — with Clear and Done. */
function FilterShell({
  column,
  activeCount,
  onClear,
  children,
}: {
  column: string;
  /** How many values are chosen (or 1 for a search with text in it). 0 is "not filtering". */
  activeCount: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = buttonRef.current?.getBoundingClientRect();
    if (r)
      setPlace({
        top: r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 264)),
      });
    setOpen(true);
  };

  // Shut on a click elsewhere, on Escape, and when the page scrolls out from under it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t))
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          activeCount > 0 ? `Filter ${column} — filtered` : `Filter ${column}`
        }
        title={
          activeCount > 0
            ? `${column}: filtered`
            : `Filter by ${column.toLowerCase()}`
        }
        className={cn(
          "relative inline-flex h-5 w-5 items-center justify-center rounded align-middle normal-case tracking-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
          activeCount > 0
            ? "bg-primary text-white"
            : "text-muted hover:bg-subtle hover:text-primary",
        )}
      >
        <ListFilter
          className="h-3.5 w-3.5"
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open &&
        place &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`Filter ${column}`}
            style={{ top: place.top, left: place.left }}
            className="fixed z-9999 w-64 rounded-xl border border-border bg-white p-2 text-sm normal-case tracking-normal text-body shadow-modal"
          >
            {children}
            <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5">
              <button
                type="button"
                disabled={activeCount === 0}
                onClick={onClear}
                className="rounded px-2 py-1 text-xs font-medium text-secondary hover:text-primary disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className="rounded px-2 py-1 text-xs font-semibold text-primary hover:underline"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A checklist of a column's values. Nothing ticked is everything shown. */
export function ColumnFilter({
  column,
  options,
  selected,
  onChange,
}: {
  column: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;
  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );

  return (
    <FilterShell
      column={column}
      activeCount={selected.length}
      onClear={() => onChange([])}
    >
      <>
        {options.length > 7 && (
          <div className="relative mb-1.5">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary"
              aria-hidden="true"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Find a ${column.toLowerCase()}…`}
              aria-label={`Find a ${column.toLowerCase()}`}
              className="w-full rounded-lg border border-border py-1.5 pl-8 pr-2 text-sm text-primary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            />
          </div>
        )}
        {options.length === 0 ? (
          <p className="px-2 py-2 text-sm text-secondary">
            Nothing to filter by.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-subtle">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="shrink-0 text-micro tabular-nums text-secondary">
                    {o.count}
                  </span>
                </label>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-2 text-sm text-secondary">No match.</li>
            )}
          </ul>
        )}
      </>
    </FilterShell>
  );
}

/** A search on a free-text column: rows whose text contains it. */
export function ColumnTextFilter({
  column,
  value,
  onChange,
  placeholder,
}: {
  column: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <FilterShell
      column={column}
      activeCount={value.trim() ? 1 : 0}
      onClear={() => onChange("")}
    >
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary"
          aria-hidden="true"
        />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Search ${column.toLowerCase()}…`}
          aria-label={`Search ${column.toLowerCase()}`}
          className="w-full rounded-lg border border-border py-1.5 pl-8 pr-2 text-sm text-primary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
        />
      </div>
    </FilterShell>
  );
}
