'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { Select } from '@/components/ui/select';

interface CompanyBilling {
  state?: string;
  gst?: string;
  pan?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  bankIfsc?: string;
  bankHolder?: string;
  bankBranch?: string;
  standardTerms?: string;
  quotationTemplate?: string;
}

// Company billing details used by the Quotation / Proforma generator.
export function BillingTab() {
  const [form, setForm] = useState({ state: '', gst: '', pan: '', email: '', bankName: '', bankAccount: '', bankIfsc: '', bankHolder: '', bankBranch: '', standardTerms: '', quotationTemplate: 'CLASSIC' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<CompanyBilling>('/settings/company').then((c) => {
      setForm((f) => ({ ...f, state: c.state || '', gst: c.gst || '', pan: c.pan || '', email: c.email || '', bankName: c.bankName || '', bankAccount: c.bankAccount || '', bankIfsc: c.bankIfsc || '', bankHolder: c.bankHolder || '', bankBranch: c.bankBranch || '', standardTerms: c.standardTerms || '', quotationTemplate: c.quotationTemplate || 'CLASSIC' }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put('/settings/company', form);
      toast.success('Billing details saved');
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(errMsg || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-secondary">Loading…</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-primary">Billing &amp; Tax Details</h2>
        <p className="text-sm text-secondary mt-1">Used on quotations and proforma invoices. Your state drives the CGST/SGST vs IGST tax split.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="billing-state" label="Registered State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="e.g. Tamil Nadu" hint="Same state as client → CGST+SGST; different → IGST" />
        <Field id="billing-email" label="Billing Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="accounts@eyelevel.in" />
        <Field id="billing-gst" label="GSTIN" value={form.gst} onChange={(v) => setForm({ ...form, gst: v })} />
        <Field id="billing-pan" label="PAN" value={form.pan} onChange={(v) => setForm({ ...form, pan: v })} />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Bank Details (printed on documents)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field id="billing-bank-holder" label="Account Holder Name" value={form.bankHolder} onChange={(v) => setForm({ ...form, bankHolder: v })} />
          <Field id="billing-bank-name" label="Bank Name" value={form.bankName} onChange={(v) => setForm({ ...form, bankName: v })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field id="billing-bank-branch" label="Branch" value={form.bankBranch} onChange={(v) => setForm({ ...form, bankBranch: v })} />
          <Field id="billing-bank-account" label="Account Number" value={form.bankAccount} onChange={(v) => setForm({ ...form, bankAccount: v })} />
          <Field id="billing-bank-ifsc" label="IFSC" value={form.bankIfsc} onChange={(v) => setForm({ ...form, bankIfsc: v })} />
        </div>
      </div>

      <div>
        <label htmlFor="billing-standard-terms" className="block text-sm font-medium text-[#374151] mb-1.5">Standard Terms &amp; Conditions</label>
        <textarea id="billing-standard-terms" value={form.standardTerms} onChange={(e) => setForm({ ...form, standardTerms: e.target.value })} rows={5} placeholder="Pre-filled on every new quotation…" className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-primary resize-none" />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Document Styling</h3>
        <div className="w-full sm:w-1/2">
          <label htmlFor="billing-quotation-template" className="block text-sm font-medium text-[#374151] mb-1.5">Quotation &amp; Proforma Template</label>
          <Select
            id="billing-quotation-template"
            ariaLabel="Quotation & Proforma Template"
            value={form.quotationTemplate}
            onChange={(v) => setForm({ ...form, quotationTemplate: v })}
            options={[
              { label: 'Classic (Brand Colors)', value: 'CLASSIC' },
              { label: 'Minimal (Clean Black & White)', value: 'MINIMAL' },
              { label: 'Modern (Rounded & Sleek)', value: 'MODERN' }
            ]}
          />
          <p className="mt-1 text-[11px] text-secondary">Choose the layout style for generated PDFs.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] disabled:opacity-50">
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, placeholder, hint }: { id?: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary" />
      {hint && <p className="mt-1 text-[11px] text-secondary">{hint}</p>}
    </div>
  );
}
