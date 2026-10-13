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
import { GstAmountFields } from '@/components/work/GstAmountFields';
import { BILLING_OPTIONS, monthLabel } from '@/lib/retainerBilling';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import type { RetainerBilling } from '@/lib/api-v2';
import { formatDate, plural } from '@/lib/utils';

type Retainer = {
  id: string;
  monthlyValue: string | number | null;
  /** The GST on the fee, if one was recorded. Null is "not said". */
  gstPercent?: number | null;
  billing?: RetainerBilling;
  startDate: string;
  termMonths: number | null;
  renewalDate: string | null;
  owner?: { id: string; name: string } | null;
  ownerId?: string | null;
};

type StaleProforma = { id: string; number: string; amount: number; month: string; monthCardId: string };

type Props = {
  retainer: Retainer;
  companyName: string;
  /** The client — so a proforma at the old fee can be raised again here. */
  companyId?: string;
  /** The month the page is showing, e.g. "2026-09" — what a re-rate would move. */
  openMonthLabel: string | null;
  onSaved: () => void;
  onClose: () => void;
};

export function EditRetainerModal({ retainer, companyName, companyId, openMonthLabel, onSaved, onClose }: Props) {
  const team = useTeamMembers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Proformas still out at the old fee, after a new one was saved (Money Plan
   * 2, decision 13). Said, never left silent: each can be cancelled and
   * raised again at the new fee.
   */
  const [stale, setStale] = useState<StaleProforma[] | null>(null);
  const [reraising, setReraising] = useState<StaleProforma | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const cancelAndReraise = async (pf: StaleProforma) => {
    setCancellingId(pf.id);
    setError(null);
    try {
      await api.proformas.updateStatus(pf.id, 'CANCELLED');
      toast.success(`Proforma ${pf.number} cancelled`);
      if (companyId) setReraising(pf);
      else setStale((list) => (list ?? []).filter((x) => x.id !== pf.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel that proforma');
    } finally {
      setCancellingId(null);
    }
  };

  const original = {
    monthlyValue: retainer.monthlyValue != null ? String(Number(retainer.monthlyValue)) : '',
    startDate: retainer.startDate?.slice(0, 10) ?? '',
    termMonths: retainer.termMonths != null ? String(retainer.termMonths) : '',
    ownerId: retainer.owner?.id ?? retainer.ownerId ?? '',
    gstPercent: retainer.gstPercent != null ? String(retainer.gstPercent) : '',
    billing: (retainer.billing ?? 'IN_ADVANCE') as RetainerBilling,
  };

  const [monthlyValue, setMonthlyValue] = useState(original.monthlyValue);
  const [startDate, setStartDate] = useState(original.startDate);
  const [termMonths, setTermMonths] = useState(original.termMonths);
  const [ownerId, setOwnerId] = useState(original.ownerId);
  const [repriceOpenMonth, setRepriceOpenMonth] = useState(true);
  const [gstPercent, setGstPercent] = useState(original.gstPercent);
  const [billing, setBilling] = useState<RetainerBilling>(original.billing);
  // Its own flag: changing the rate is a real change, and it must not be
  // mistaken for a change to the fee — that one asks about repricing the
  // month, and a new rate on the same fee has nothing to reprice.
  const gstChanged = gstPercent !== original.gstPercent;

  const rateChanged = monthlyValue !== original.monthlyValue && Number(monthlyValue) > 0;
  const changed =
    rateChanged ||
    startDate !== original.startDate ||
    termMonths !== original.termMonths ||
    ownerId !== original.ownerId ||
    gstChanged ||
    billing !== original.billing;

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
        ...(gstChanged ? { gstPercent: gstPercent ? Number(gstPercent) : null } : {}),
        ...(startDate !== original.startDate ? { startDate } : {}),
        ...(termMonths !== original.termMonths ? { termMonths: termMonths ? Number(termMonths) : null } : {}),
        ...(ownerId !== original.ownerId ? { ownerId } : {}),
        ...(billing !== original.billing ? { billing } : {}),
      });
      // What actually moved, from the server — not what the form asked for.
      toast.success(
        res.repricedCards > 0
          ? `Retainer updated — ${plural(res.repricedCards, 'month card')} repriced`
          : 'Retainer updated',
      );
      if (res.staleProformas && res.staleProformas.length > 0) {
        setStale(res.staleProformas);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this retainer');
    } finally {
      setBusy(false);
    }
  };

  if (stale) {
    const newFee = Number(monthlyValue);
    return (
      <>
        <Modal
          open={!reraising}
          onClose={onSaved}
          title="A proforma is still at the old fee"
          description={`${companyName} — the fee is now ${formatMoney(newFee)} a month, before GST.`}
        >
          <ScrollingModalBody className="space-y-3">
            {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
            {stale.length === 0 ? (
              <p className="text-sm text-secondary">Done — nothing is left at the old fee.</p>
            ) : (
              stale.map((pf) => (
                <div key={pf.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-tint px-3 py-2.5">
                  <p className="text-sm text-warning-ink">
                    Proforma <span className="font-mono">{pf.number}</span> for {pf.month ? monthLabel(pf.month) : 'the open month'} asks for{' '}
                    {formatMoney(pf.amount)} before GST. The client will be billed the old fee unless it is raised again.
                  </p>
                  <Button size="sm" variant="secondary" loading={cancellingId === pf.id} onClick={() => void cancelAndReraise(pf)}>
                    Cancel and re-raise
                  </Button>
                </div>
              ))
            )}
          </ScrollingModalBody>
          <ModalFooter>
            <Button type="button" variant="primary" onClick={onSaved}>
              {stale.length === 0 ? 'Done' : 'Leave it as it is'}
            </Button>
          </ModalFooter>
        </Modal>
        {reraising && companyId && (
          <NewProformaModal
            companyId={companyId}
            companyName={companyName}
            source={{ type: 'MONTH_CARD', monthCardId: reraising.monthCardId, monthLabel: monthLabel(reraising.month) }}
            defaultAmount={newFee}
            defaultGstPercent={gstPercent ? Number(gstPercent) : null}
            onCancel={() => {
              // Cancelled already; it can be raised from Billing later.
              setStale((list) => (list ?? []).filter((x) => x.id !== reraising.id));
              setReraising(null);
            }}
            onConfirm={() => {
              setStale((list) => (list ?? []).filter((x) => x.id !== reraising.id));
              setReraising(null);
            }}
          />
        )}
      </>
    );
  }

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

          <GstAmountFields
            mode="revenue"
            label="Monthly value (₹)"
            amount={monthlyValue}
            onAmountChange={setMonthlyValue}
            gstPercent={gstPercent}
            onGstChange={setGstPercent}
            required
            disabled={busy}
            hint={
              monthlyValue !== '' && !valueIsSound
                ? 'A retainer has to be worth something.'
                : 'Before GST — what each month earns.'
            }
          />
          <FieldSelect
            label="Bills"
            disabled={busy}
            value={billing}
            onChange={(v) => setBilling(v as RetainerBilling)}
            options={BILLING_OPTIONS}
            hint="In advance: the proforma goes out on the 1st, before the work. After: once the month is over."
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
