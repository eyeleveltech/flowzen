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
 * editable, "GST applicable" can be turned off entirely for an exempt client
 * or an export invoice, and since CR-02 the place of supply — not the buyer's
 * GSTIN — is what decides CGST+SGST against IGST.
 *
 * The register row is enough to open this, but not enough to fill it: the line
 * items are fetched on open, because that is the one part of a document the
 * list deliberately does not carry.
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
  billingStateCode?: string | null;
  placeOfSupplyCode?: string | null;
  customFields?: { label: string; value: string }[] | null;
  notes?: string | null;
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
  const [loadingLines, setLoadingLines] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: config } = useConfig();
  const sellerStateCode = config?.documentSettings?.gstStateCode ?? null;
  const sacCodes = config?.documentSettings?.sacCodes ?? [];

  // Seeded from the single description and amount the register already has, so
  // the table is populated even while the real lines are still on the wire —
  // and so a proforma raised before CR-02, which genuinely has one line, is
  // already correct without waiting.
  const [lines, setLines] = useState<LineItemDraft[]>([
    {
      ...blankLineItem(),
      particulars: proforma.description ?? '',
      unitCost: String(proforma.amount ?? ''),
      hsnSac: proforma.sacCode ?? '',
    },
  ]);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(proforma.customFields ?? []);
  const [poNumber, setPoNumber] = useState(proforma.poNumber ?? '');
  const [poDate, setPoDate] = useState(proforma.poDate ? proforma.poDate.slice(0, 10) : '');
  const [billingName, setBillingName] = useState(proforma.billingName ?? '');
  const [billingContactName, setBillingContactName] = useState(proforma.billingContactName ?? '');
  const [billingAddress, setBillingAddress] = useState(proforma.billingAddress ?? '');
  const [gstin, setGstin] = useState(proforma.gstin ?? '');
  const [buyerStateCode, setBuyerStateCode] = useState(proforma.billingStateCode ?? '');
  const [placeOfSupplyCode, setPlaceOfSupplyCode] = useState(proforma.placeOfSupplyCode ?? '');
  const [gstApplicable, setGstApplicable] = useState(proforma.gstApplicable ?? true);
  const [gstRatePercent, setGstRatePercent] = useState(String(proforma.gstRatePercent ?? 18));
  const [notes, setNotes] = useState(proforma.notes ?? '');
  const [terms, setTerms] = useState(proforma.terms ?? '');
  const [raisedAt, setRaisedAt] = useState(proforma.raisedAt.slice(0, 10));
  const [validTill, setValidTill] = useState(proforma.validTill.slice(0, 10));

  useEffect(() => {
    let cancelled = false;
    void api.proformas
      .get(proforma.id)
      .then((res) => {
        if (cancelled) return;
        const full = res.proforma as Record<string, unknown>;
        const items = (full.lineItems as Record<string, unknown>[] | undefined) ?? [];
        if (items.length > 0) {
          setLines(
            items.map((li) => ({
              particulars: String(li.particulars ?? ''),
              units: String(Number(li.units)),
              unitCost: String(Number(li.unitCost)),
              hsnSac: (li.hsnSac as string) ?? '',
            })),
          );
        }
        if (Array.isArray(full.customFields)) setCustomFields(full.customFields as CustomFieldDraft[]);
        if (full.billingStateCode) setBuyerStateCode(String(full.billingStateCode));
        if (full.placeOfSupplyCode) setPlaceOfSupplyCode(String(full.placeOfSupplyCode));
        if (full.notes) setNotes(String(full.notes));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingLines(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proforma.id]);

  const subtotal = linesSubtotal(lines);
  const parsedGstRate = Number(gstRatePercent);
  const gstRateValid = !gstApplicable || (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 28);
  const canSave = Boolean(billingName.trim()) && linesAreValid(lines) && subtotal > 0 && gstRateValid && !busy && !loadingLines;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proformas.update(proforma.id, {
        lineItems: toLineItemPayload(lines),
        raisedAt,
        validDays: daysBetween(raisedAt, validTill),
        billingName: billingName.trim(),
        billingContactName: billingContactName.trim() || null,
        billingAddress: billingAddress.trim() || null,
        gstin: gstin.trim() || null,
        billingStateCode: buyerStateCode || null,
        placeOfSupply: placeOfSupplyCode ? { code: placeOfSupplyCode } : undefined,
        customFields: toCustomFieldPayload(customFields),
        gstApplicable,
        gstRatePercent: parsedGstRate,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        notes: notes.trim() || null,
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
            <div className="flex items-center gap-2">
              <h3 className="eyebrow">Items</h3>
              {loadingLines && <span className="text-micro text-secondary">Loading the lines…</span>}
            </div>
            <LineItemsEditor rows={lines} onChange={setLines} sacCodes={sacCodes} disabled={busy || loadingLines} />
          </section>

          <section className="space-y-3">
            <h3 className="eyebrow">Tax</h3>
            <PlaceOfSupplyField
              value={placeOfSupplyCode}
              onChange={setPlaceOfSupplyCode}
              sellerStateCode={sellerStateCode}
              disabled={busy}
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
            <h3 className="eyebrow">Dates</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issue date" value={raisedAt} onChange={setRaisedAt} type="date" disabled={busy} />
              <Field label="Valid until" value={validTill} onChange={setValidTill} type="date" disabled={busy} />
            </div>
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
          <Field label="Notes" value={notes} onChange={setNotes} disabled={busy} textarea rows={2} />
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
