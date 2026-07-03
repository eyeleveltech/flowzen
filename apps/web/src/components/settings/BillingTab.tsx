'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { Select } from '@/components/ui/select';

// Company billing details used by the Quotation / Proforma generator.
export function BillingTab() {
  const [form, setForm] = useState({ state: '', gst: '', pan: '', email: '', bankName: '', bankAccount: '', bankIfsc: '', standardTerms: '', quotationTemplate: 'CLASSIC' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<any>('/settings/company').then((c) => {
      setForm((f) => ({ ...f, state: c.state || '', gst: c.gst || '', pan: c.pan || '', email: c.email || '', bankName: c.bankName || '', bankAccount: c.bankAccount || '', bankIfsc: c.bankIfsc || '', standardTerms: c.standardTerms || '', quotationTemplate: c.quotationTemplate || 'CLASSIC' }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put('/settings/company', form);
      toast.success('Billing details saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
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
        <Field label="Registered State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="e.g. Tamil Nadu" hint="Same state as client → CGST+SGST; different → IGST" />
        <Field label="Billing Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="accounts@eyelevel.in" />
        <Field label="GSTIN" value={form.gst} onChange={(v) => setForm({ ...form, gst: v })} />
        <Field label="PAN" value={form.pan} onChange={(v) => setForm({ ...form, pan: v })} />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Bank Details (printed on documents)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Bank Name" value={form.bankName} onChange={(v) => setForm({ ...form, bankName: v })} />
          <Field label="Account Number" value={form.bankAccount} onChange={(v) => setForm({ ...form, bankAccount: v })} />
          <Field label="IFSC" value={form.bankIfsc} onChange={(v) => setForm({ ...form, bankIfsc: v })} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#374151] mb-1.5">Standard Terms &amp; Conditions</label>
        <textarea value={form.standardTerms} onChange={(e) => setForm({ ...form, standardTerms: e.target.value })} rows={5} placeholder="Pre-filled on every new quotation…" className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-primary resize-none" />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Document Styling</h3>
        <div className="w-full sm:w-1/2">
          <label className="block text-sm font-medium text-[#374151] mb-1.5">Quotation &amp; Proforma Template</label>
          <Select
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

function Field({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary" />
      {hint && <p className="mt-1 text-[11px] text-secondary">{hint}</p>}
    </div>
  );
}
