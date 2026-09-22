'use client';

/**
 * The printable tax invoice — CR-02.
 *
 * Recording an invoice and preparing its document are two steps because that
 * is the real order of events: Tally issues the number, the number is recorded
 * here against the month or project it bills, and only then is there a page to
 * send anybody. `Record an invoice` stays as short as it was; this is where the
 * rest of the document is filled in.
 *
 * It is the same document a proforma prints — same items table, same place of
 * supply, same totals — because §0 says build it once, and the two really are
 * one page with a different title on it.
 *
 * Saving sets the invoice's amount to the document total. An invoice's amount
 * is what payments are settled against, so a document that says one figure and
 * an amount that says another is not two facts, it is one fact recorded wrong.
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

type InvoiceRow = {
  id: string;
  number: string;
  amount: number | null;
  company?: { id: string; name: string } | null;
  hasDocument?: boolean;
};

type Props = {
  invoice: InvoiceRow;
  onSaved: () => void;
  onClose: () => void;
};

export function InvoiceDocumentModal({ invoice, onSaved, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: config } = useConfig();
  const sellerStateCode = config?.documentSettings?.gstStateCode ?? null;
  const sacCodes = config?.documentSettings?.sacCodes ?? [];

  const [lines, setLines] = useState<LineItemDraft[]>([blankLineItem()]);
  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>([]);
  const [billingName, setBillingName] = useState(invoice.company?.name ?? '');
  const [billingContactName, setBillingContactName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [buyerStateCode, setBuyerStateCode] = useState('');
  const [placeOfSupplyCode, setPlaceOfSupplyCode] = useState('');
  const [placeTouched, setPlaceTouched] = useState(false);
  const [gstApplicable, setGstApplicable] = useState(true);
  const [gstRatePercent, setGstRatePercent] = useState('18');
  const [poNumber, setPoNumber] = useState('');
  const [poDate, setPoDate] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');

  /**
   * An invoice with no document yet is seeded from the company record and from
   * the amount already recorded — which is the TAX-INCLUSIVE total from Tally,
   * so the opening line is worked back out of it at the standard rate. That is
   * a starting point to correct, not an assertion: whatever the lines end up
   * saying is what the document and the amount both become.
   */
  useEffect(() => {
    let cancelled = false;
    void api.invoices
      .get(invoice.id)
      .then(async (inv) => {
        if (cancelled) return;

        if (inv.subtotal !== null && inv.subtotal !== undefined) {
          const items = (inv.lineItems as Record<string, any>[] | undefined) ?? [];
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
          setBillingName(inv.billingName ?? invoice.company?.name ?? '');
          setBillingContactName(inv.billingContactName ?? '');
          setBillingAddress(inv.billingAddress ?? '');
          setGstin(inv.gstin ?? '');
          setBuyerStateCode(inv.billingStateCode ?? '');
          setPlaceOfSupplyCode(inv.placeOfSupplyCode ?? '');
          setPlaceTouched(true);
          setGstApplicable(inv.gstApplicable ?? true);
          setGstRatePercent(String(inv.gstRatePercent ?? 18));
          setPoNumber(inv.poNumber ?? '');
          setPoDate(inv.poDate ? String(inv.poDate).slice(0, 10) : '');
          setTerms(inv.terms ?? '');
          setNotes(inv.notes ?? '');
          // Saving REPLACES the document wholesale, so anything this form
          // does not load back is deleted by the next save. The custom
          // fields were the one block that was not restored — re-opening an
          // invoice to fix a typo silently dropped its PO number.
          setCustomFields(Array.isArray(inv.customFields) ? (inv.customFields as CustomFieldDraft[]) : []);
          return;
        }

        // The opening line first, and only then the company lookup. Awaiting
        // the company before seeding the line meant the form sat with an empty
        // items table for as long as the company request took — which on a
        // client with several retainers and projects is not instant.
        const recorded = Number(inv.amount ?? invoice.amount ?? 0);
        if (recorded > 0) {
          setLines([
            {
              ...blankLineItem(),
              particulars: '',
              unitCost: String(Math.round((recorded / 1.18) * 100) / 100),
            },
          ]);
        }

        const companyId = inv.company?.id ?? invoice.company?.id;
        if (companyId) {
          try {
            const companyRes = await api.companies.get(companyId);
            const company = ((companyRes as { company?: Record<string, unknown> }).company ??
              companyRes) as Record<string, unknown>;
            if (cancelled) return;
            setBillingAddress((current) => current || ((company.billingAddress as string) ?? ''));
            setGstin((current) => current || ((company.gstin as string) ?? ''));
            setBuyerStateCode((current) => current || ((company.stateCode as string) ?? ''));
          } catch {
            /* the buyer block is editable anyway; a failed prefill is not a failed form */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id, invoice.company?.id, invoice.company?.name, invoice.amount]);

  useEffect(() => {
    if (!placeTouched) setPlaceOfSupplyCode(buyerStateCode);
  }, [buyerStateCode, placeTouched]);

  const subtotal = linesSubtotal(lines);
  const parsedGstRate = Number(gstRatePercent);
  const gstRateValid = !gstApplicable || (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 28);
  const canSave =
    Boolean(billingName.trim()) && linesAreValid(lines) && subtotal > 0 && gstRateValid && !busy && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.invoices.saveDocument(invoice.id, {
        billingName: billingName.trim(),
        billingContactName: billingContactName.trim() || null,
        billingAddress: billingAddress.trim() || null,
        gstin: gstin.trim() || null,
        billingStateCode: buyerStateCode || null,
        placeOfSupply: placeOfSupplyCode ? { code: placeOfSupplyCode } : undefined,
        lineItems: toLineItemPayload(lines),
        customFields: toCustomFieldPayload(customFields),
        gstApplicable,
        gstRatePercent: parsedGstRate,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        terms: terms.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success('Document saved');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this document');
    } finally {
      setBusy(false);
    }
  };

  const recorded = invoice.amount;
  const total = Math.round(subtotal + (gstApplicable ? (subtotal * (parsedGstRate || 0)) / 100 : 0));
  const differsFromRecorded = recorded !== null && recorded > 0 && Math.abs(total - recorded) >= 1;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Document for ${invoice.number}`}
      description="What the client actually receives. Saving this sets the invoice amount to the document total."
    >
      <form className="flex h-full flex-col" onSubmit={submit}>
        <ScrollingModalBody className="space-y-5">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <section className="space-y-2">
            <h3 className="eyebrow">Billed to</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Buyer name" value={billingName} onChange={setBillingName} disabled={busy} required />
              <Field label="Contact" value={billingContactName} onChange={setBillingContactName} disabled={busy} />
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
              {loading && <span className="text-micro text-secondary">Loading…</span>}
            </div>
            <LineItemsEditor rows={lines} onChange={setLines} sacCodes={sacCodes} disabled={busy || loading} />
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
              <Field label="GST rate (%)" value={gstRatePercent} onChange={setGstRatePercent} type="number" disabled={busy} />
            )}
            <TotalsPreview
              kind="INVOICE"
              subtotal={subtotal}
              gstApplicable={gstApplicable}
              gstRatePercent={parsedGstRate || 0}
              interState={Boolean(placeOfSupplyCode && sellerStateCode && placeOfSupplyCode !== sellerStateCode)}
            />
            {differsFromRecorded && (
              <p className="text-micro text-warning-ink">
                This document totals ₹{total.toLocaleString('en-IN')}, and ₹{recorded!.toLocaleString('en-IN')} was
                recorded against {invoice.number}. Saving changes the recorded amount to match — check it against Tally
                first.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="eyebrow">Reference fields</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client PO number" value={poNumber} onChange={setPoNumber} disabled={busy} />
              <Field label="PO date" value={poDate} onChange={setPoDate} type="date" disabled={busy} />
            </div>
            <CustomFieldsEditor rows={customFields} onChange={setCustomFields} disabled={busy} />
          </section>

          <Field
            label="Terms &amp; conditions"
            value={terms}
            onChange={setTerms}
            disabled={busy}
            textarea
            rows={3}
            hint="Leave empty and the document prints the standard list from Settings."
          />
          <Field label="Notes" value={notes} onChange={setNotes} disabled={busy} textarea rows={2} />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save document
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
