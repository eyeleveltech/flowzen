'use client';

/**
 * What a proforma or a tax invoice puts on itself.
 *
 * CR-02 §2 — "Entered once in Setup, printed on every document, never typed
 * again." The seller identity below used to live on the Organisation tab,
 * whose Save button calls an endpoint that does not exist, so the address and
 * GSTIN a tax invoice is legally required to carry could only be set with a
 * database script. They belong to the document, so they are saved with it.
 *
 * Its own tab, and its own load/save, rather than folding into the
 * Organisation form above it — that form's Save button calls an endpoint
 * that doesn't exist yet, so it can never persist a change. This one talks
 * to a real endpoint (`PATCH /config/document-settings`) so Terms &
 * Conditions and the bank details stop being something only a database
 * script can change.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/hooks/queries';
import { Check, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type DocumentSettings, type SellerGap } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Field, FieldCheckbox } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { SellerGapsNote } from '@/components/documents/SellerGapsNote';

type Form = {
  contactEmail: string;
  defaultPaymentTerms: string;
  validityDays: string;
  terms: string[];
  bankAccountHolderName: string;
  bankName: string;
  bankBranch: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  legalName: string;
  address: string;
  gstStateCode: string;
  stateName: string;
  gstNumber: string;
  pan: string;
  declarationText: string;
  signatureImage: string;
  sacCodes: string[];
  showSignatureBlock: boolean;
};

/** Roughly 300 KB of image, which is a generous scan of a signature. */
const MAX_SIGNATURE_BYTES = 300 * 1024;

const blank: Form = {
  contactEmail: '',
  defaultPaymentTerms: 'Immediate',
  validityDays: '30',
  terms: [],
  bankAccountHolderName: '',
  bankName: '',
  bankBranch: '',
  bankAccountNumber: '',
  bankIfscCode: '',
  legalName: '',
  address: '',
  gstStateCode: '',
  stateName: '',
  gstNumber: '',
  pan: '',
  declarationText: '',
  signatureImage: '',
  sacCodes: [],
  showSignatureBlock: true,
};

const toForm = (s: DocumentSettings): Form => ({
  contactEmail: s.contactEmail ?? '',
  defaultPaymentTerms: s.defaultPaymentTerms || 'Immediate',
  validityDays: String(s.defaultProformaValidityDays || 30),
  terms: s.defaultTermsAndConditions.length > 0 ? s.defaultTermsAndConditions : [''],
  bankAccountHolderName: s.bankAccountHolderName ?? '',
  bankName: s.bankName ?? '',
  bankBranch: s.bankBranch ?? '',
  bankAccountNumber: s.bankAccountNumber ?? '',
  bankIfscCode: s.bankIfscCode ?? '',
  legalName: s.legalName ?? '',
  address: s.address ?? '',
  gstStateCode: s.gstStateCode ?? '',
  stateName: s.stateName ?? '',
  gstNumber: s.gstNumber ?? '',
  pan: s.pan ?? '',
  declarationText: s.declarationText ?? '',
  signatureImage: s.signatureImage ?? '',
  sacCodes: s.sacCodes ?? [],
  showSignatureBlock: s.showSignatureBlock ?? true,
});

export function DocumentSettingsTab({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  // Not part of `form`: it is what the server makes of what has been saved,
  // not something being edited, and it is recomputed on every save.
  const [gaps, setGaps] = useState<SellerGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.config.get();
      if (cfg.documentSettings) {
        setForm(toForm(cfg.documentSettings));
        setGaps(cfg.documentSettings.gaps ?? []);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load document settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const setTerm = (index: number, value: string) =>
    setForm((f) => ({ ...f, terms: f.terms.map((t, i) => (i === index ? value : t)) }));
  const addTerm = () => setForm((f) => ({ ...f, terms: [...f.terms, ''] }));
  const removeTerm = (index: number) => setForm((f) => ({ ...f, terms: f.terms.filter((_, i) => i !== index) }));

  const setSac = (index: number, value: string) =>
    setForm((f) => ({ ...f, sacCodes: f.sacCodes.map((c, i) => (i === index ? value : c)) }));
  const addSac = () => setForm((f) => ({ ...f, sacCodes: [...f.sacCodes, ''] }));
  const removeSac = (index: number) =>
    setForm((f) => ({ ...f, sacCodes: f.sacCodes.filter((_, i) => i !== index) }));

  /**
   * The signature is held as a data URI on the organisation row, not a file
   * on disk: this deployment has no object storage, and the PDF renderer has
   * to be able to read it out of the same row it reads the address from.
   * Reading it here means the size limit is checked before it is sent rather
   * than after — a 4 MB phone photo of a signature is a real thing to upload.
   */
  const readSignature = (file: File) => {
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      setError('That file is not a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      setError('That signature image is too large — use one under about 300 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      set('signatureImage', String(reader.result));
    };
    reader.onerror = () => setError('Could not read that image.');
    reader.readAsDataURL(file);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const validityDays = Math.max(1, Math.round(Number(form.validityDays)) || 30);
      await api.config.updateDocumentSettings({
        legalName: form.legalName || null,
        pan: form.pan || null,
        declarationText: form.declarationText || null,
        signatureImage: form.signatureImage || null,
        sacCodes: form.sacCodes.map((c) => c.trim()).filter(Boolean),
        showSignatureBlock: form.showSignatureBlock,
        contactEmail: form.contactEmail || null,
        defaultPaymentTerms: form.defaultPaymentTerms,
        defaultProformaValidityDays: validityDays,
        defaultTermsAndConditions: form.terms.map((t) => t.trim()).filter(Boolean),
        bankAccountHolderName: form.bankAccountHolderName || null,
        bankName: form.bankName || null,
        bankBranch: form.bankBranch || null,
        bankAccountNumber: form.bankAccountNumber || null,
        bankIfscCode: form.bankIfscCode || null,
      });
      // Same reason as the organisation tab: this config is shared and cached.
      await queryClient.invalidateQueries({ queryKey: qk.config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      <SellerGapsNote gaps={gaps} />

      <Card padding="none">
        <CardHeader>
          <CardTitle>Who is issuing the document</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-secondary">
            Printed at the top of every proforma and tax invoice. A tax invoice is required to
            carry the GSTIN, the state and the registered name, so anything missing here is
            missing on the document.
          </p>
          <Field
            label="Registered name"
            value={form.legalName}
            onChange={(v) => set('legalName', v)}
            disabled={!canEdit}
            placeholder="The entity name on the GST registration"
            hint="Often not the trading name shown in the app header."
          />
          <Field label="PAN" value={form.pan} onChange={(v) => set('pan', v)} disabled={!canEdit} placeholder="AABCC1234F" />
          {/*
            The address, the state and the GSTIN are edited on the Organisation and
            Tax & numbering tabs, and shown here read-only. Two editors for one
            field is how the two quietly stop agreeing — and the state in
            particular is what decides CGST+SGST against IGST on every document.
          */}
          <div className="rounded-xl border border-border bg-subtle px-3.5 py-3">
            <span className="eyebrow">Also printed, set elsewhere</span>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-secondary">Address</dt>
                <dd className="whitespace-pre-line text-body">{form.address || <span className="text-secondary">Not set — Organisation tab</span>}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-secondary">State</dt>
                <dd className="text-body">
                  {form.stateName || <span className="text-secondary">Not set — Tax &amp; numbering tab</span>}
                  {form.gstStateCode ? ` (${form.gstStateCode})` : ''}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-secondary">GSTIN</dt>
                <dd className="text-body">{form.gstNumber || <span className="text-secondary">Not set — Tax &amp; numbering tab</span>}</dd>
              </div>
            </dl>
          </div>
          <Field
            label="Declaration"
            value={form.declarationText}
            onChange={(v) => set('declarationText', v)}
            disabled={!canEdit}
            textarea
            rows={2}
            hint="Printed at the foot of a tax invoice. A proforma always prints “This is not a tax invoice.” instead, which is not editable."
          />
          <div>
            <span className="eyebrow mb-1.25 block">Signature</span>
            <div className="flex items-center gap-4">
              {form.signatureImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.signatureImage}
                  alt="The signature as it will print"
                  className="h-14 w-44 rounded-lg border border-border bg-white object-contain p-1"
                />
              ) : (
                <div className="flex h-14 w-44 items-center justify-center rounded-lg border border-dashed border-border text-micro text-secondary">
                  Signed by hand
                </div>
              )}
              {canEdit && (
                <div className="flex flex-col gap-1.5">
                  <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-subtle">
                    {form.signatureImage ? 'Replace' : 'Upload a scan'}
                    <input
                      type="file"
                      aria-label="Upload a scanned signature"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) readSignature(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {form.signatureImage && (
                    <button
                      type="button"
                      onClick={() => set('signatureImage', '')}
                      className="text-micro text-secondary transition-colors hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="mt-1 text-micro text-secondary">
              Optional. Leave it empty and the document prints a blank space to sign in.
            </p>
          </div>

          <FieldCheckbox
            label="Print the signatory box"
            checked={form.showSignatureBlock}
            onChange={(v) => set('showSignatureBlock', v)}
            disabled={!canEdit}
            hint={
              form.showSignatureBlock
                ? 'Every proforma and invoice ends with “For <your registered name>” above “Authorised Signatory”. Turn it off and the bank details take the full width.'
                : 'Off — documents end at the bank details. Nothing in GST law requires the printed box; a document emailed under your own covering note is signed in practice.'
            }
          />
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>Sender details</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-secondary">Printed on every proforma you send out.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contact email"
              value={form.contactEmail}
              onChange={(v) => set('contactEmail', v)}
              type="email"
              disabled={!canEdit}
              placeholder="hello@yourcompany.com"
            />
            <Field
              label="Default payment terms"
              value={form.defaultPaymentTerms}
              onChange={(v) => set('defaultPaymentTerms', v)}
              disabled={!canEdit}
              placeholder="e.g. Immediate"
            />
          </div>
          <Field
            label="Valid for (days)"
            value={form.validityDays}
            onChange={(v) => set('validityDays', v)}
            type="number"
            disabled={!canEdit}
            hint="How long a new proforma stays valid from the day it's raised, unless changed on that one document."
          />
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>Terms &amp; conditions</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-secondary">
            The numbered list every proforma shows. Every client gets the same list.
          </p>
          {form.terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-xs text-secondary">{i + 1}.</span>
              <Field
                label=""
                className="flex-1"
                value={t}
                onChange={(v) => setTerm(i, v)}
                disabled={!canEdit}
                placeholder="e.g. Monthly retainer fee applicable"
              />
              {canEdit && form.terms.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTerm(i)}
                  className="shrink-0 p-2 text-secondary hover:text-danger transition-colors"
                  aria-label="Remove this line"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" onClick={addTerm}>
              <Plus className="w-3.5 h-3.5" />
              Add a line
            </Button>
          )}
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>HSN / SAC codes</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-secondary">
            The codes you bill under. Every line item on a document offers this list, so a code
            is picked rather than remembered — which is the difference between the same service
            carrying the same code every month and carrying four spellings of it.
          </p>
          {form.sacCodes.length === 0 && (
            <p className="text-xs text-secondary">None saved yet. Add the ones you use.</p>
          )}
          {form.sacCodes.map((code, i) => (
            <div key={i} className="flex items-center gap-2">
              <Field
                label=""
                className="flex-1"
                value={code}
                onChange={(v) => setSac(i, v)}
                disabled={!canEdit}
                placeholder="e.g. 998365"
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeSac(i)}
                  className="shrink-0 p-2 text-secondary transition-colors hover:text-danger"
                  aria-label="Remove this code"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" onClick={addSac}>
              <Plus className="h-3.5 w-3.5" />
              Add a code
            </Button>
          )}
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>Bank details</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-secondary">Where the money should actually go.</p>
          <Field
            label="Account holder name"
            value={form.bankAccountHolderName}
            onChange={(v) => set('bankAccountHolderName', v)}
            disabled={!canEdit}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" value={form.bankName} onChange={(v) => set('bankName', v)} disabled={!canEdit} />
            <Field label="Branch" value={form.bankBranch} onChange={(v) => set('bankBranch', v)} disabled={!canEdit} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Account number"
              value={form.bankAccountNumber}
              onChange={(v) => set('bankAccountNumber', v)}
              disabled={!canEdit}
            />
            <Field label="IFSC code" value={form.bankIfscCode} onChange={(v) => set('bankIfscCode', v)} disabled={!canEdit} />
          </div>
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
        </div>
      )}
    </form>
  );
}
