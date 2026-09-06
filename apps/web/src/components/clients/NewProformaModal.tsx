'use client';

/**
 * Raising a proforma — two brief-described entry points share this form:
 *
 * §11.1 step 9, from a won proposal: "Client's accounts ask for a proforma.
 * One click from the proposal. Stage becomes Proforma issued."
 *
 * §11.3 step 5, from a project milestone: "Milestone reached → proforma
 * raised → invoice entered → payment marked." The milestone moves from
 * Pending to Proforma raised.
 *
 * Both stage flips happen server-side, keyed off `source` below — this
 * component is just that click. Amount defaults to the value being billed
 * (a proposal version, or the milestone's own amount) but stays editable —
 * a proforma doesn't always match exactly (e.g. a part payment).
 */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Source = { type: 'PROPOSAL'; proposalId: string } | { type: 'MILESTONE'; projectId: string; milestoneId: string };

type Props = {
  companyId: string;
  companyName: string;
  source: Source;
  defaultAmount: number;
  defaultDescription?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function NewProformaModal({ companyId, companyName, source, defaultAmount, defaultDescription, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState(String(defaultAmount));
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [sacCode, setSacCode] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState('');
  const [billingName, setBillingName] = useState(companyName);
  const [billingContactName, setBillingContactName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [gstApplicable, setGstApplicable] = useState(true);
  const [gstRatePercent, setGstRatePercent] = useState('18');
  const [terms, setTerms] = useState(
    'Advance payment request. Payment due within validity period. GST applicable as per statutory rates.',
  );

  const parsedAmount = Number(amount);
  const parsedGstRate = Number(gstRatePercent);
  const gstRateValid = !gstApplicable || (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 28);
  const canSave = Boolean(billingName.trim()) && Number.isFinite(parsedAmount) && parsedAmount > 0 && gstRateValid && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proformas.create({
        companyId,
        sourceType: source.type === 'PROPOSAL' ? 'PROPOSAL' : 'PROJECT',
        sourceId: source.type === 'PROPOSAL' ? source.proposalId : source.projectId,
        milestoneId: source.type === 'MILESTONE' ? source.milestoneId : undefined,
        amount: parsedAmount,
        billingName: billingName.trim(),
        billingContactName: billingContactName.trim() || undefined,
        billingAddress: billingAddress.trim() || undefined,
        gstin: gstin.trim() || undefined,
        gstApplicable,
        gstRatePercent: parsedGstRate,
        description: description.trim() || undefined,
        sacCode: sacCode.trim() || undefined,
        poNumber: poNumber.trim() || undefined,
        poDate: poDate || undefined,
        terms: terms.trim() || undefined,
      });
      toast.success('Proforma raised');
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not raise the proforma');
    } finally {
      setBusy(false);
    }
  };

  const stageHint =
    source.type === 'PROPOSAL' ? 'Stage becomes Proforma issued.' : 'This milestone moves to Proforma raised.';

  return (
    <Modal open title="Raise proforma" description={stageHint} onClose={onCancel} size="lg">
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
            placeholder="e.g. Advance for Website Build — 40% on kickoff"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (₹, before GST)" value={amount} onChange={setAmount} type="number" disabled={busy} required />
            <Field label="HSN/SAC code" value={sacCode} onChange={setSacCode} disabled={busy} placeholder="e.g. 998382" />
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

          <Field label="Billing address" value={billingAddress} onChange={setBillingAddress} disabled={busy} textarea rows={2} />

          <Field label="GSTIN" value={gstin} onChange={setGstin} disabled={busy} placeholder="e.g. 33AABCC1234F1Z5" />

          <FieldCheckbox
            label="GST applicable"
            checked={gstApplicable}
            onChange={setGstApplicable}
            disabled={busy}
            hint="Turn off for a GST-exempt client or an export invoice."
          />

          {gstApplicable && (
            <Field
              label="GST rate (%)"
              value={gstRatePercent}
              onChange={setGstRatePercent}
              type="number"
              disabled={busy}
              hint="18% is the standard agency-services rate."
            />
          )}

          <Field label="Terms & conditions" value={terms} onChange={setTerms} disabled={busy} textarea rows={3} />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Raise proforma
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
