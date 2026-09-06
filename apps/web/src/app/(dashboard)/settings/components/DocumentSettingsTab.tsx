'use client';

/**
 * What a proforma PDF puts on itself.
 *
 * Its own tab, and its own load/save, rather than folding into the
 * Organisation form above it — that form's Save button calls an endpoint
 * that doesn't exist yet, so it can never persist a change. This one talks
 * to a real endpoint (`PATCH /config/document-settings`) so Terms &
 * Conditions and the bank details stop being something only a database
 * script can change.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type DocumentSettings } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';

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
};

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
});

export function DocumentSettingsTab({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = useState<Form>(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.config.get();
      if (cfg.documentSettings) setForm(toForm(cfg.documentSettings));
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const validityDays = Math.max(1, Math.round(Number(form.validityDays)) || 30);
      await api.config.updateDocumentSettings({
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
