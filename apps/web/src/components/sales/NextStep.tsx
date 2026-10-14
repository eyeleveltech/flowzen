'use client';

/**
 * The next step on a deal or a lead (Sales next step plan).
 *
 * Every open deal and every active lead (follow-up, meeting, interested)
 * carries what happens next and by when. The server refuses a stage change, a
 * status change, a touch or an edit that would leave one without it — these
 * are the fields every one of those forms uses, and the line every list
 * shows.
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

/** Both the words and the date — what the server needs. */
export const nextStepReady = (d: NextStepDraft, today: string) =>
  Boolean(d.nextStep.trim()) && Boolean(d.nextStepDate) && d.nextStepDate >= today;

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
  hint = 'Required while it is open. Winning, losing or marking it dead needs none.',
}: {
  value: NextStepDraft;
  onChange: (next: NextStepDraft) => void;
  disabled?: boolean;
  hint?: string | null;
}) {
  const today = useStudioToday();
  const past = Boolean(value.nextStepDate) && value.nextStepDate < today;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field
          label="Next step"
          required
          value={value.nextStep}
          onChange={(v) => onChange({ ...value, nextStep: v })}
          placeholder="e.g. Call to walk them through v2"
          disabled={disabled}
        />
        <Field
          label="By"
          type="date"
          required
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
      {nextStepDate && (
        <span className={overdue ? 'font-semibold' : ''}>
          {' '}
          · {overdue ? 'was due ' : ''}
          {stepDate(nextStepDate)}
        </span>
      )}
    </p>
  );
}
