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
 * component is just that click.
 *
 * CR-02 turned the single Description + Amount pair into a real items table.
 * The default amount still arrives from whatever is being billed (a proposal
 * version, a milestone) and becomes the first line, so the one-click path is
 * unchanged; anything more than one line is now possible rather than a second
 * proforma.
 */

import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldCheckbox, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import {
  LineItemsEditor,
  blankLineItem,
  linesSubtotal,
  linesAreValid,
  toLineItemPayload,
  type LineItemDraft,
} from '@/components/documents/LineItemsEditor';
import {
  CustomFieldsEditor,
  PlaceOfSupplyField,
  STATE_OPTIONS,
  TotalsPreview,
  toCustomFieldPayload,
  type CustomFieldDraft,
} from '@/components/documents/DocumentFields';

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
  const { data: config } = useConfig();
  const sellerStateCode = config?.documentSettings?.gstStateCode ?? null;
  const sacCodes = config?.documentSettings?.sacCodes ?? [];

  const [lines, setLines] = useState<LineItemDraft[]>([
    {
      ...blankLineItem(),
      particulars: defaultDescription ?? '',
      unitCost: defaultAmount > 0 ? String(defaultAmount) : '',
    },
  ]);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState('');
  const [billingName, setBillingName] = useState(companyName);
  const [billingContactName, setBillingContactName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [buyerStateCode, setBuyerStateCode] = useState('');
  const [placeOfSupplyCode, setPlaceOfSupplyCode] = useState('');
  const [placeTouched, setPlaceTouched] = useState(false);
  const [gstApplicable, setGstApplicable] = useState(true);
  const [gstRatePercent, setGstRatePercent] = useState('18');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(
    'Advance payment request. Payment due within validity period. GST applicable as per statutory rates.',
  );

  // The buyer block starts as whatever the client record already says, so the
  // common case is confirming it rather than retyping it. Only fields still
  // untouched are filled — a form that overwrites what someone just typed the
  // moment a request lands is worse than one that fills in nothing.
  useEffect(() => {
    let cancelled = false;
    void api.companies
      .get(companyId)
      .then((res) => {
        if (cancelled) return;
        const company = ((res as { company?: Record<string, unknown> }).company ?? res) as Record<string, unknown>;
        setBillingAddress((current) => current || ((company.billingAddress as string) ?? ''));
        setGstin((current) => current || ((company.gstin as string) ?? ''));
        setBuyerStateCode((current) => current || ((company.stateCode as string) ?? ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // §4 again: pre-filled, never locked. Once the place of supply has been set
  // by hand it stops following the buyer's state.
  useEffect(() => {
    if (!placeTouched) setPlaceOfSupplyCode(buyerStateCode);
  }, [buyerStateCode, placeTouched]);

  const subtotal = linesSubtotal(lines);
  const parsedGstRate = Number(gstRatePercent);
  const gstRateValid = !gstApplicable || (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 28);
  const canSave = Boolean(billingName.trim()) && linesAreValid(lines) && subtotal > 0 && gstRateValid && !busy;

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
        lineItems: toLineItemPayload(lines),
        billingName: billingName.trim(),
        billingContactName: billingContactName.trim() || undefined,
        billingAddress: billingAddress.trim() || undefined,
        gstin: gstin.trim() || undefined,
        billingStateCode: buyerStateCode || undefined,
        placeOfSupply: placeOfSupplyCode ? { code: placeOfSupplyCode } : undefined,
        customFields: toCustomFieldPayload(customFields),
        gstApplicable,
        gstRatePercent: parsedGstRate,
        poNumber: poNumber.trim() || undefined,
        poDate: poDate || undefined,
        notes: notes.trim() || undefined,
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
        <ScrollingModalBody className="space-y-5">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <section className="space-y-2">
            <h3 className="eyebrow">Billed to</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Billing name" value={billingName} onChange={setBillingName} disabled={busy} required />
              <Field label="Billing contact" value={billingContactName} onChange={setBillingContactName} disabled={busy} />
            </div>
            <Field label="Billing address" value={billingAddress} onChange={setBillingAddress} disabled={busy} textarea rows={2} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GSTIN" value={gstin} onChange={setGstin} disabled={busy} placeholder="e.g. 33AABCC1234F1Z5" />
              <FieldSelect
                label="Client state"
                value={buyerStateCode}
                onChange={setBuyerStateCode}
                options={STATE_OPTIONS}
                placeholder="Choose a state…"
                disabled={busy}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">Items</h3>
            <LineItemsEditor rows={lines} onChange={setLines} sacCodes={sacCodes} disabled={busy} />
          </section>

          <section className="space-y-3">
            <h3 className="eyebrow">Tax</h3>
            <PlaceOfSupplyField
              value={placeOfSupplyCode}
              onChange={(code) => {
                setPlaceTouched(true);
                setPlaceOfSupplyCode(code);
              }}
              sellerStateCode={sellerStateCode}
              disabled={busy}
            />
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
            <TotalsPreview
              kind="PROFORMA"
              subtotal={subtotal}
              gstApplicable={gstApplicable}
              gstRatePercent={parsedGstRate || 0}
              interState={Boolean(placeOfSupplyCode && sellerStateCode && placeOfSupplyCode !== sellerStateCode)}
            />
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">Reference fields</h3>
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
            <CustomFieldsEditor rows={customFields} onChange={setCustomFields} disabled={busy} />
          </section>

          <Field label="Terms &amp; conditions" value={terms} onChange={setTerms} disabled={busy} textarea rows={3} />
          <Field
            label="Notes"
            value={notes}
            onChange={setNotes}
            disabled={busy}
            textarea
            rows={2}
            hint="Printed under the terms. Leave empty and nothing is printed."
          />
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
