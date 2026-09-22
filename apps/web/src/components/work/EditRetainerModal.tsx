'use client';

/**
 * Correcting the retainer itself.
 *
 * Until this existed a retainer could be started and stopped but never fixed,
 * so a rate agreed at ₹50,000 and typed as ₹5,000 was permanent — and it is
 * the figure MRR, the forecast and every month card are built from.
 *
 * Two things are not here on purpose:
 *
 *   · the company — a retainer is one client's arrangement, and every figure
 *     already recorded sits against them. Stop it and start the right one.
 *   · the renewal date, which is derived from the start plus the term (§8).
 *     The preview below is the same formula the server applies; a field would
 *     have made two writers for one value.
 *
 * Ending it is not here either. "Stop retainer" does real work — closing the
 * month card that was worked, removing one that was not — that a status write
 * would skip.
 */

import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { api, ApiError, formatMoney } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { personOptions } from '@/lib/people';
import { formatDate, plural } from '@/lib/utils';

type Retainer = {
  id: string;
  monthlyValue: string | number | null;
  startDate: string;
  termMonths: number | null;
  renewalDate: string | null;
  owner?: { id: string; name: string } | null;
  ownerId?: string | null;
};

type Props = {
  retainer: Retainer;
  companyName: string;
  /** The month the page is showing, e.g. "2026-09" — what a re-rate would move. */
  openMonthLabel: string | null;
  onSaved: () => void;
  onClose: () => void;
};

export function EditRetainerModal({ retainer, companyName, openMonthLabel, onSaved, onClose }: Props) {
  const team = useTeamMembers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const original = {
    monthlyValue: retainer.monthlyValue != null ? String(Number(retainer.monthlyValue)) : '',
    startDate: retainer.startDate?.slice(0, 10) ?? '',
    termMonths: retainer.termMonths != null ? String(retainer.termMonths) : '',
    ownerId: retainer.owner?.id ?? retainer.ownerId ?? '',
  };

  const [monthlyValue, setMonthlyValue] = useState(original.monthlyValue);
  const [startDate, setStartDate] = useState(original.startDate);
  const [termMonths, setTermMonths] = useState(original.termMonths);
  const [ownerId, setOwnerId] = useState(original.ownerId);
  const [repriceOpenMonth, setRepriceOpenMonth] = useState(true);

  const rateChanged = monthlyValue !== original.monthlyValue && Number(monthlyValue) > 0;
  const changed =
    rateChanged ||
    startDate !== original.startDate ||
    termMonths !== original.termMonths ||
    ownerId !== original.ownerId;

  const valueIsSound = Number(monthlyValue) > 0;
  const canSave = changed && valueIsSound && Boolean(startDate) && !busy;

  // The server's own formula, shown rather than asked for.
  const renewalPreview = (() => {
    const term = Number(termMonths);
    if (!startDate || !term || term <= 0) return null;
    const s = new Date(startDate);
    if (Number.isNaN(s.getTime())) return null;
    return new Date(s.getFullYear(), s.getMonth() + term, s.getDate());
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.retainers.update(retainer.id, {
        ...(rateChanged ? { monthlyValue: Number(monthlyValue), repriceOpenMonth } : {}),
        ...(startDate !== original.startDate ? { startDate } : {}),
        ...(termMonths !== original.termMonths ? { termMonths: termMonths ? Number(termMonths) : null } : {}),
        ...(ownerId !== original.ownerId ? { ownerId } : {}),
      });
      // What actually moved, from the server — not what the form asked for.
      toast.success(
        res.repricedCards > 0
          ? `Retainer updated — ${plural(res.repricedCards, 'month card')} repriced`
          : 'Retainer updated',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this retainer');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit retainer"
      description={`${companyName} — the arrangement itself. Months already closed or invoiced are never rewritten.`}
    >
      <form className="flex h-full flex-col" onSubmit={submit}>
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field
            label="Monthly value (₹)"
            value={monthlyValue}
            onChange={setMonthlyValue}
            type="number"
            required
            disabled={busy}
            error={monthlyValue !== '' && !valueIsSound ? 'A retainer has to be worth something.' : undefined}
          />

          {rateChanged && (
            <FieldCheckbox
              label={openMonthLabel ? `Apply this to ${openMonthLabel} as well` : 'Apply this to the open month as well'}
              checked={repriceOpenMonth}
              onChange={setRepriceOpenMonth}
              hint={
                repriceOpenMonth
                  ? `The month you are part way through moves from ${formatMoney(Number(original.monthlyValue))} to ${formatMoney(Number(monthlyValue))}. A month already closed or invoiced is left alone either way.`
                  : 'The new rate starts from the next month. This one stays at the figure it opened with.'
              }
              disabled={busy}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" value={startDate} onChange={setStartDate} type="date" required disabled={busy} />
            <Field
              label="Term (months)"
              value={termMonths}
              onChange={setTermMonths}
              type="number"
              disabled={busy}
              hint="Leave blank for no fixed term — flagged as a contract risk."
            />
          </div>

          <p className="text-micro text-secondary">
            {renewalPreview
              ? `Renews ${formatDate(renewalPreview)} — worked out from the start date and the term, not set by hand.`
              : 'No renewal date: with no term there is nothing to count from.'}
          </p>

          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Nobody in particular"
            options={personOptions(team)}
            disabled={busy}
          />

        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
