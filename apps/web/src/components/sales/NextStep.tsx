'use client';

/**
 * The next step on a deal or a lead (Sales next step plan).
 *
 * What happens next on an open deal or an active lead (follow-up, meeting,
 * interested), and by when. Optional everywhere since 2026-10-16 — nothing
 * refuses a save without one — but a deal or lead without one shows a
 * "No next step" badge, and a date given can't be in the past. These are the
 * fields every form uses, and the line every list shows.
 *
 * "Missing" means nothing written (QA19 fixes plan, F04). A step written
 * without a date is a step: it shows its words and "date not set", and no
 * form asks for the date before it will save.
 */

import { Field } from '@/components/ui/field';
import { useConfig } from '@/hooks/queries';
import { todayIn } from '@/lib/money';

export type NextStepDraft = { nextStep: string; nextStepDate: string };

/** A draft from what the row already has. */
export const nextStepDraft = (nextStep?: string | null, date?: string | null): NextStepDraft => ({
  nextStep: nextStep ?? '',
  nextStepDate: date ? date.slice(0, 10) : '',
});

/** The server's rule, for screens that only have the fields: missing is nothing written. */
export const isNextStepMissing = (nextStep?: string | null) => !nextStep?.trim();

/**
 * For "Set next step", whose whole job is setting one: the words, and a date
 * only if one is given — which can't be past. It asked for both, which is why
 * a step saved without a date elsewhere could not be edited without adding one.
 */
export const nextStepReady = (d: NextStepDraft, today: string) =>
  Boolean(d.nextStep.trim()) && (!d.nextStepDate || d.nextStepDate >= today);

/** What every other form checks: it may be left empty, but a date given can't be past. */
export const nextStepOk = (d: NextStepDraft, today: string) => !d.nextStepDate || d.nextStepDate >= today;

/** As the API takes it. */
export const nextStepBody = (d: NextStepDraft) => ({
  nextStep: d.nextStep.trim() || null,
  nextStepDate: d.nextStepDate || null,
});

/** Today where the studio is: "2026-10-14". */
export function useStudioToday(): string {
  const { data: config } = useConfig();
  return todayIn(config?.organization.timezone ?? 'Asia/Kolkata');
}

/** A next step's date, short: "17 Oct". */
export const stepDate = (d: string | null | undefined): string =>
  d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : '';

export function NextStepFields({
  value,
  onChange,
  disabled,
  required = false,
  hint = 'Optional. What happens next, and by when.',
}: {
  value: NextStepDraft;
  onChange: (next: NextStepDraft) => void;
  disabled?: boolean;
  /** Only "Set next step" asks for the words — everywhere else they can be left for later. The date never is. */
  required?: boolean;
  hint?: string | null;
}) {
  const today = useStudioToday();
  const past = Boolean(value.nextStepDate) && value.nextStepDate < today;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field
          label="Next step"
          required={required}
          value={value.nextStep}
          onChange={(v) => onChange({ ...value, nextStep: v })}
          placeholder="e.g. Call to walk them through v2"
          disabled={disabled}
        />
        <Field
          label="By"
          type="date"
          min={today}
          value={value.nextStepDate}
          onChange={(v) => onChange({ ...value, nextStepDate: v })}
          disabled={disabled}
          error={past ? "Can't be in the past" : undefined}
        />
      </div>
      {hint && <p className="mt-1 text-micro text-secondary">{hint}</p>}
    </div>
  );
}

/**
 * The line a card or a row shows: the next step and its date — red once the
 * date has passed — or a "No next step" badge where one is owed.
 */
export function NextStepLine({
  nextStep,
  nextStepDate,
  missing,
  overdue,
  onClick,
  className = '',
}: {
  nextStep?: string | null;
  nextStepDate?: string | null;
  missing?: boolean;
  overdue?: boolean;
  /** Opens the form to set it. */
  onClick?: () => void;
  className?: string;
}) {
  if (missing) {
    const badge = (
      <span className="inline-flex items-center rounded border border-warning/40 bg-warning-tint px-1.5 py-0.5 text-micro font-semibold text-warning-ink">
        No next step
      </span>
    );
    // On its own line, so it never runs into whatever follows it.
    return onClick ? (
      <div className={className}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="text-left"
          title="Set the next step"
        >
          {badge}
        </button>
      </div>
    ) : (
      <div className={className}>{badge}</div>
    );
  }
  if (!nextStep && !nextStepDate) return null;
  return (
    <p className={`text-micro leading-snug ${overdue ? 'text-danger' : 'text-secondary'} ${className}`}>
      <span className={overdue ? 'font-semibold' : 'font-medium text-body'}>Next:</span> {nextStep}
      {nextStepDate ? (
        <span className={overdue ? 'font-semibold' : ''}>
          {' '}
          · {overdue ? 'was due ' : ''}
          {stepDate(nextStepDate)}
        </span>
      ) : (
        // Written, with no date: a step, not a missing one.
        <span className="text-muted"> · date not set</span>
      )}
    </p>
  );
}
