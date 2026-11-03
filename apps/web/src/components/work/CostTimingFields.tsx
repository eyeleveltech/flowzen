'use client';

/**
 * "Does this repeat?" and "Has it been paid?" — the two questions every cost
 * form left out.
 *
 * The server has taken both since costs were built, and the forecast reads
 * both: its recurring line from costs marked to repeat, its owed line from
 * costs marked not paid. No form ever sent either, so both lines were always
 * ₹0, the 1st-of-the-month copy job had nothing to copy, and the forecast told
 * everyone to "mark the monthly ones Recurring" with no box to tick.
 *
 * Shared by the entry forms and the edit form so the words stay the same.
 */

import { FieldCheckbox } from '@/components/ui/field';

/** Whose money it really was, in the books: the firm's, or a partner's loan to it. */
export const TREATMENT_OPTIONS = [
  { value: 'COMPANY_EXPENSE', label: 'Company expense' },
  { value: 'AKMAL_LOAN', label: 'Akmal loan' },
  { value: 'N_J_MACSON_LOAN', label: 'N J Macson loan' },
];
export const treatmentLabel = (v?: string | null) => TREATMENT_OPTIONS.find((o) => o.value === v)?.label ?? null;

type Props = {
  recurring: boolean;
  onRecurringChange: (v: boolean) => void;
  committedNotPaid: boolean;
  onCommittedNotPaidChange: (v: boolean) => void;
  /**
   * A monthly copy made from a repeating cost. It does not repeat itself —
   * ticking it would start a second chain and count the rent twice — so the
   * question is not asked.
   */
  isMonthlyCopy?: boolean;
  /** On the edit form: what unticking does, said up front. */
  editing?: boolean;
};

export function CostTimingFields({
  recurring,
  onRecurringChange,
  committedNotPaid,
  onCommittedNotPaidChange,
  isMonthlyCopy = false,
  editing = false,
}: Props) {
  return (
    <div className="space-y-2">
      {isMonthlyCopy ? (
        <p className="text-micro text-secondary">
          A monthly copy of a repeating cost. To stop it repeating, edit the first one and untick “Repeats every month”.
        </p>
      ) : (
        <FieldCheckbox
          label="Repeats every month"
          checked={recurring}
          onChange={onRecurringChange}
          hint={
            editing && recurring
              ? 'Untick to stop the monthly copies. The ones already made stay.'
              : 'Rent, software, internet. A draft copy appears on the 1st of each month for you to confirm, and the forecast counts it ahead.'
          }
        />
      )}
      <FieldCheckbox
        label="Not paid yet"
        checked={committedNotPaid}
        onChange={onCommittedNotPaidChange}
        hint={
          editing && committedNotPaid
            ? 'Untick once the money has gone out.'
            : 'Owed, but the money hasn’t left. The forecast counts it as owed until you edit the cost and untick this.'
        }
      />
    </div>
  );
}
