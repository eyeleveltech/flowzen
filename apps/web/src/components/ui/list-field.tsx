'use client';

/**
 * A list of short values, added one at a time.
 *
 * ─── Why not a textarea ─────────────────────────────────────────────────────
 *
 * Departments and public holidays were both a box you typed a list into, one
 * per line, and the string was split on save. Which meant the control could not
 * tell you anything: a trailing blank line, a stray comma, the same department
 * typed twice with different capitals, a date written 14-01-2026 — all of it
 * looked fine while being typed and was only ever discovered later, by the
 * screen that read the list. "Video & Production" and "Video / Production"
 * living side by side is exactly what that box allowed, and exactly what the
 * setting exists to let somebody clean up.
 *
 * So each value is its own chip, added deliberately and removed deliberately.
 * A duplicate is refused at the moment it is typed, by the control that knows
 * the list, and a date is a date picker rather than a spelling of one.
 *
 * ─── Why a chip is not editable ─────────────────────────────────────────────
 *
 * Renaming here does not move anybody: people carry the department they were
 * given as their own text, so editing "Video & Production" in place would
 * appear to rename the team and would in fact just remove it from the list and
 * add a different one, silently orphaning everybody in it. Remove and add says
 * what actually happens.
 */

import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ListField({
  label,
  values,
  onChange,
  hint,
  placeholder,
  addLabel = 'Add',
  type = 'text',
  disabled = false,
  empty = 'Nothing on the list yet.',
  format,
  hideLabel = false,
  className = '',
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  hint?: string;
  placeholder?: string;
  /** The button beside the input — "Add a department" reads better than "Add". */
  addLabel?: string;
  /** `date` gives a date picker, which is the honest control for a holiday. */
  type?: 'text' | 'date';
  disabled?: boolean;
  empty?: string;
  /** How a stored value is shown — a date as words, while the value stays ISO. */
  format?: (value: string) => string;
  /** For when the section heading already says it. Still read out. */
  hideLabel?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // Case-insensitive, because "design" and "Design" being two departments is
    // the failure this control exists to prevent.
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setProblem(`${value} is already on the list.`);
      return;
    }
    onChange([...values, value]);
    setDraft('');
    setProblem(null);
  };

  return (
    <div className={className}>
      {/*
        Kept for the list's accessible name even where the section heading
        already says it — "Departments" printed twice, once as the card title
        and once as a field label, is the kind of small repetition that makes a
        settings page feel like a form dump.
      */}
      <span className={`eyebrow mb-1.25 block ${hideLabel ? 'sr-only' : ''}`} id={`${id}-label`}>
        {label}
      </span>

      {values.length > 0 ? (
        /*
         * Chips, not full-width rows. These are one or two words each, and a
         * row per value turned twelve departments into a column half a screen
         * tall with the remove button an inch of white space away from what it
         * removes.
         */
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-labelledby={`${id}-label`}>
          {values.map((value) => (
            <li key={value}>
              <span
                className={`inline-flex items-center gap-1 rounded-lg border border-border bg-white py-1.5 text-sm text-body ${
                  disabled ? 'px-3' : 'pl-3 pr-1.5'
                }`}
              >
                {format ? format(value) : value}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(values.filter((v) => v !== value));
                      setProblem(null);
                    }}
                    aria-label={`Remove ${format ? format(value) : value}`}
                    className="rounded-md p-1 text-secondary outline-none transition-colors hover:bg-danger-tint hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-secondary">
          {empty}
        </p>
      )}

      {!disabled && (
        // Wraps rather than squeezing the input to nothing beside the button on
        // a phone.
        <div className="flex flex-wrap items-start gap-2">
          <input
            id={id}
            type={type}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setProblem(null);
            }}
            /*
             * Enter adds the row. Without this it would submit the settings
             * form instead — saving the page from a half-typed department.
             */
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            aria-label={addLabel}
            aria-invalid={Boolean(problem)}
            aria-describedby={problem ? `${id}-problem` : hint ? `${id}-hint` : undefined}
            className={`min-w-[10rem] flex-1 rounded-xl border bg-white px-4 py-2.5 text-sm text-body outline-none transition-colors duration-150 motion-reduce:transition-none ${
              problem
                ? 'border-danger'
                : 'border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1'
            }`}
          />
          <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {addLabel}
          </Button>
        </div>
      )}

      {problem ? (
        <p id={`${id}-problem`} aria-live="polite" className="mt-1 text-micro text-danger">
          {problem}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-micro text-secondary">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
