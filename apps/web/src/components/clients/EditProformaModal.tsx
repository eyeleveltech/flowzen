'use client';

/**
 * Editing a proforma — only reachable while it's still UNPAID.
 *
 * The server enforces the same rule (§16's audit trail is what a PAID or
 * CANCELLED proforma being silently rewritten would corrupt), so this isn't
 * a client-side nicety layered over an unguarded write — it's UI for a real
 * server-side gate. Both dates are editable here (e.g. to correct a proforma
 * raised under the wrong date) — `validDays` is sent as the gap between
 * Issue date and Valid until, computed fresh from whatever those two fields
 * hold, not fixed to the original raise date.
 *
 * GST is per-document, not a fixed 18% baked into the PDF: the rate is
 * editable, and "GST applicable" can be turned off entirely for an exempt
 * client or an export invoice — the tax rows then disappear from the
 * document rather than printing a 0% line.
 */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Proforma = {
  id: string;
  number: string;
  amount: string | number;
  description?: string | null;
  sacCode?: string | null;
  poNumber?: string | null;
  poDate?: string | null;
  billingName: string;
  billingContactName?: string | null;
  billingAddress?: string | null;
  gstin?: string | null;
  gstApplicable?: boolean;
  gstRatePercent?: number;
  terms?: string | null;
  raisedAt: string;
  validTill: string;
};

type Props = {
  proforma: Proforma;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Whole days between two dates, ignoring time of day. */
const daysBetween = (from: string, to: string): number =>
  Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));

export function EditProformaModal({ proforma, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(proforma.amount));
  const [description, setDescription] = useState(proforma.description ?? '');
  const [sacCode, setSacCode] = useState(proforma.sacCode ?? '');
  const [poNumber, setPoNumber] = useState(proforma.poNumber ?? '');
  const [poDate, setPoDate] = useState(proforma.poDate ? proforma.poDate.slice(0, 10) : '');
  const [billingName, setBillingName] = useState(proforma.billingName ?? '');
  const [billingContactName, setBillingContactName] = useState(proforma.billingContactName ?? '');
  const [billingAddress, setBillingAddress] = useState(proforma.billingAddress ?? '');
  const [gstin, setGstin] = useState(proforma.gstin ?? '');
  const [gstApplicable, setGstApplicable] = useState(proforma.gstApplicable ?? true);
  const [gstRatePercent, setGstRatePercent] = useState(String(proforma.gstRatePercent ?? 18));
  const [terms, setTerms] = useState(proforma.terms ?? '');
  const [raisedAt, setRaisedAt] = useState(proforma.raisedAt.slice(0, 10));
  const [validTill, setValidTill] = useState(proforma.validTill.slice(0, 10));

  const parsedAmount = Number(amount);
  const parsedGstRate = Number(gstRatePercent);
  const gstRateValid = !gstApplicable || (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 28);
  const canSave = Boolean(billingName.trim()) && Number.isFinite(parsedAmount) && parsedAmount > 0 && gstRateValid && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proformas.update(proforma.id, {
        amount: parsedAmount,
        raisedAt,
        validDays: daysBetween(raisedAt, validTill),
        billingName: billingName.trim(),
        billingContactName: billingContactName.trim() || null,
        billingAddress: billingAddress.trim() || null,
        gstin: gstin.trim() || null,
        gstApplicable,
        gstRatePercent: Number(gstRatePercent),
        description: description.trim() || null,
        sacCode: sacCode.trim() || null,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        terms: terms.trim() || undefined,
      });
      toast.success('Proforma updated');
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update proforma');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Edit ${proforma.number}`} size="lg" onClose={onCancel}>
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void handleSave();
        }}
      >
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field
            label="Description"
            value={description}
            onChange={setDescription}
            disabled={busy}
            placeholder="e.g. Social Media Management for the Month of August"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹, before GST)" value={amount} onChange={setAmount} type="number" disabled={busy} required />
            <Field label="HSN/SAC code" value={sacCode} onChange={setSacCode} disabled={busy} placeholder="e.g. 998382" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issue date" value={raisedAt} onChange={setRaisedAt} type="date" disabled={busy} />
            <Field label="Valid until" value={validTill} onChange={setValidTill} type="date" disabled={busy} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Client PO number"
              value={poNumber}
              onChange={setPoNumber}
              disabled={busy}
              placeholder="Only if the client raised one"
            />
            <Field label="PO date" value={poDate} onChange={setPoDate} type="date" disabled={busy} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Billing name" value={billingName} onChange={setBillingName} disabled={busy} required />
            <Field label="Billing contact" value={billingContactName} onChange={setBillingContactName} disabled={busy} />
          </div>

          <Field
            label="Billing address"
            value={billingAddress}
            onChange={setBillingAddress}
            disabled={busy}
            textarea
            rows={2}
          />

          <Field
            label="GSTIN"
            value={gstin}
            onChange={setGstin}
            disabled={busy}
            placeholder="e.g. 33AABCC1234F1Z5"
          />

          <FieldCheckbox
            label="GST applicable"
            checked={gstApplicable}
            onChange={setGstApplicable}
            disabled={busy}
            hint="Turn off for a GST-exempt client or an export invoice — the tax rows disappear from the document entirely, not just show as 0%."
          />

          {gstApplicable && (
            <Field
              label="GST rate (%)"
              value={gstRatePercent}
              onChange={setGstRatePercent}
              type="number"
              disabled={busy}
              hint="18% is the standard agency-services rate. Split CGST+SGST for a same-state GSTIN, IGST across states."
            />
          )}

          <Field
            label="Terms & conditions"
            value={terms}
            onChange={setTerms}
            disabled={busy}
            textarea
            rows={3}
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
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
