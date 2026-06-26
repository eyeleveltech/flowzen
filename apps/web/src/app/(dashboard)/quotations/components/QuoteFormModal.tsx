'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, Save, FileDown, Search, Check, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useMembers } from '@/hooks/useQueries';
import { useAuthStore } from '@/stores';
import { TAX_TYPES, resolveTaxType, DEFAULT_TAX_TYPE } from '../lib/tax-catalog';
import toast from 'react-hot-toast';

const UNITS = ['Hours', 'Days', 'Months', 'Units', 'Lump Sum'];
const PRESET_TERMS = ['Immediate', '100% Advance', '50-50', 'Monthly', 'Milestone-based'];
const PAYMENT_TERMS = [...PRESET_TERMS, 'Custom'];
const SALES_TEAMS = ['BD', 'Digital Marketing', 'Founder'];
const PAY_METHODS = ['Bank Transfer', 'UPI', 'Cheque', 'Online'];
const DEFAULT_TERMS = '1. This quotation is valid until the expiration date stated above.\n2. 50% advance is required to commence work unless otherwise agreed.\n3. Taxes as applicable (GST).\n4. Timelines are indicative and subject to timely inputs and approvals.';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');

type Line = { description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxPct: string; taxType: string };
const emptyLine = (): Line => ({ description: '', unit: 'Units', quantity: '1', unitPrice: '', discountPct: '', taxPct: '18', taxType: DEFAULT_TAX_TYPE });

export function QuoteFormModal({ editId, duplicateOf, onClose, onSaved }: { editId: string | null; duplicateOf: any; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuthStore();
  const { data: members = [] } = useMembers();
  const [clients, setClients] = useState<any[]>([]);
  const [orgState, setOrgState] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const [documentType, setDocumentType] = useState<'QUOTATION' | 'PROFORMA_INVOICE'>('QUOTATION');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientState, setClientState] = useState('');
  const [form, setForm] = useState({
    contactPerson: '', clientEmail: '', clientPhone: '', billingAddress: '',
    documentDate: new Date().toISOString().split('T')[0],
    expirationDate: '', paymentTerms: '50-50', customerRef: '',
    salespersonId: user?.id || '', salesTeam: '', onlineSignature: false, onlinePayment: false,
    tags: '', paymentMethod: '', clientGst: '', projectStartDate: '', deliveryDate: '', projectNotes: '', scope: '',
    termsConditions: DEFAULT_TERMS,
  });
  const [lineItems, setLineItems] = useState<Line[]>([emptyLine()]);
  const [showOther, setShowOther] = useState(false);

  // Client lookup combobox
  const [clientSearch, setClientSearch] = useState('');
  const [showClientList, setShowClientList] = useState(false);
  const clientRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ clients: any[] }>('/clients?limit=200').then((d) => setClients(d.clients || [])).catch(() => {});
    api.get<any>('/settings/company').then((c) => {
      setOrgState(c?.state || '');
      if (!editId && !duplicateOf && c?.standardTerms) setForm((f) => ({ ...f, termsConditions: c.standardTerms }));
    }).catch(() => {});
  }, []);

  // Populate for edit / duplicate
  useEffect(() => {
    const src = editId ? null : duplicateOf;
    async function load() {
      const q = editId ? await api.get<any>(`/crm/quotes/${editId}`) : src;
      if (!q) return;
      setDocumentType(q.documentType);
      setClientId(q.clientId);
      setClientName(q.clientName);
      setClientState(q.clientState || '');
      setClientSearch(q.clientName || '');
      setForm({
        contactPerson: q.contactPerson || '', clientEmail: q.clientEmail || '', clientPhone: q.clientPhone || '', billingAddress: q.billingAddress || '',
        documentDate: q.documentDate ? new Date(q.documentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        expirationDate: q.expirationDate ? new Date(q.expirationDate).toISOString().split('T')[0] : '',
        paymentTerms: q.paymentTerms || '50-50', customerRef: q.customerRef || '',
        salespersonId: q.salespersonId || user?.id || '', salesTeam: q.salesTeam || '',
        onlineSignature: q.onlineSignature || false, onlinePayment: q.onlinePayment || false,
        tags: (q.tags || []).join(', '), paymentMethod: q.paymentMethod || '', clientGst: q.clientGst || '',
        projectStartDate: q.projectStartDate ? new Date(q.projectStartDate).toISOString().split('T')[0] : '',
        deliveryDate: q.deliveryDate ? new Date(q.deliveryDate).toISOString().split('T')[0] : '',
        projectNotes: q.projectNotes || '', scope: q.scope || '', termsConditions: q.termsConditions || DEFAULT_TERMS,
      });
      setLineItems((q.lineItems || []).map((li: any) => ({
        description: li.description, unit: li.unit, quantity: String(Number(li.quantity)), unitPrice: String(Number(li.unitPrice)),
        discountPct: li.discountPct ? String(Number(li.discountPct)) : '', taxPct: String(Number(li.taxPct ?? 18)), taxType: li.taxType || DEFAULT_TAX_TYPE,
      })));
    }
    load();
  }, [editId, duplicateOf]);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (clientRef.current && !clientRef.current.contains(e.target as Node)) setShowClientList(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filteredClients = clients.filter((c) => {
    const s = clientSearch.toLowerCase();
    return [c.company, c.name].filter(Boolean).some((v: string) => v.toLowerCase().includes(s));
  }).slice(0, 8);

  function selectClient(c: any) {
    setClientId(c.id);
    setClientName(c.company || c.name);
    setClientState(c.state || '');
    setClientSearch(c.company || c.name);
    setForm((f) => ({ ...f, contactPerson: c.contactPerson || c.contacts?.[0]?.name || c.name || f.contactPerson, clientEmail: c.email || '', clientPhone: c.phone || '', billingAddress: c.billingAddress || c.address || '', clientGst: c.gstNumber || '' }));
    setShowClientList(false);
  }

  // Live financials — each line's tax TYPE drives the split (mirrors the server util).
  const fin = useMemo(() => {
    let untaxed = 0, disc = 0, cgst = 0, sgst = 0, igst = 0, rcm = false;
    const amounts: number[] = [];
    for (const it of lineItems) {
      const gross = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
      const d = gross * ((parseFloat(it.discountPct) || 0) / 100);
      const amt = gross - d;
      amounts.push(amt);
      untaxed += amt; disc += d;
      const mode = resolveTaxType(it.taxType).mode;
      const taxAmt = amt * ((parseFloat(it.taxPct) || 0) / 100);
      if (mode === 'GST') { cgst += taxAmt / 2; sgst += taxAmt / 2; }
      else if (mode === 'IGST') { igst += taxAmt; }
      else if (mode === 'RC') { rcm = true; }
    }
    return { untaxed, disc, cgst, sgst, igst, totalTax: cgst + sgst + igst, grand: untaxed + cgst + sgst + igst, amounts, rcm };
  }, [lineItems]);

  function setLine(i: number, key: keyof Line, val: string) {
    setLineItems((rows) => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  function buildPayload() {
    return {
      documentType, clientId, contactPerson: form.contactPerson, clientEmail: form.clientEmail, clientPhone: form.clientPhone,
      billingAddress: form.billingAddress, documentDate: form.documentDate, expirationDate: form.expirationDate,
      paymentTerms: form.paymentTerms, salespersonId: form.salespersonId || undefined,
      salesTeam: form.salesTeam || undefined, onlineSignature: form.onlineSignature, onlinePayment: form.onlinePayment,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      paymentMethod: form.paymentMethod || undefined, clientGst: form.clientGst || undefined,
      projectStartDate: form.projectStartDate || undefined, deliveryDate: form.deliveryDate || undefined,
      projectNotes: form.projectNotes || undefined, scope: form.scope || undefined, termsConditions: form.termsConditions,
      lineItems: lineItems.map((li) => ({
        description: li.description, unit: li.unit, quantity: parseFloat(li.quantity) || 0, unitPrice: parseFloat(li.unitPrice) || 0,
        discountPct: parseFloat(li.discountPct) || 0, taxPct: parseFloat(li.taxPct) || 0, taxType: li.taxType || DEFAULT_TAX_TYPE,
      })),
    };
  }

  function validate(): string | null {
    if (!clientId) return 'Select a client.';
    if (!form.contactPerson.trim()) return 'Contact person is required.';
    if (!form.expirationDate) return 'Expiration date is required.';
    if (!lineItems.length || lineItems.some((l) => !l.description.trim() || !(parseFloat(l.unitPrice) >= 0))) return 'Each line needs a description and unit price.';
    return null;
  }

  async function save(): Promise<string | null> {
    const err = validate();
    if (err) { toast.error(err); return null; }
    setSubmitting(true);
    try {
      const payload = buildPayload();
      const res = editId
        ? await api.patch<any>(`/crm/quotes/${editId}`, payload)
        : await api.post<any>('/crm/quotes', payload);
      toast.success('Saved');
      return res.id;
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  async function onSaveDraft() {
    const id = await save();
    if (id) onSaved();
  }

  async function onGeneratePdf() {
    const id = await save();
    if (!id) return;
    const t = toast.loading('Generating PDF…');
    try {
      const res = await api.post<{ pdfUrl: string }>(`/crm/quotes/${id}/generate-pdf`, {});
      toast.dismiss(t); toast.success('PDF ready');
      window.open(`${API_BASE}${res.pdfUrl}`, '_blank');
      onSaved();
    } catch (e: any) { toast.dismiss(t); toast.error(e.message || 'PDF failed'); }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, x: '100%' }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-4xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-primary">{editId ? 'Edit Document' : 'New Document'}</h2>
            <p className="text-sm text-secondary mt-0.5">Quotation or Proforma Invoice</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 transition-colors"><X className="h-5 w-5 text-secondary" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/30">
          {/* Document type toggle */}
          <div className="inline-flex rounded-xl border border-border bg-white p-1">
            {(['QUOTATION', 'PROFORMA_INVOICE'] as const).map((t) => (
              <button key={t} onClick={() => !editId && setDocumentType(t)} disabled={!!editId}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${documentType === t ? 'bg-primary text-white' : 'text-secondary hover:text-primary'} ${editId ? 'opacity-70 cursor-not-allowed' : ''}`}>
                {t === 'QUOTATION' ? 'Quotation' : 'Proforma Invoice'}
              </button>
            ))}
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative sm:col-span-2" ref={clientRef}>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Client <span className="text-red-500">*</span></label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
                <input value={clientSearch} onChange={(e) => { setClientSearch(e.target.value); setShowClientList(true); }} onFocus={() => setShowClientList(true)}
                  placeholder="Search clients by name or company…" className={`w-full rounded-xl border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary ${clientId ? 'border-blue-200 bg-blue-50/40' : 'border-border'}`} />
                {clientId && <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-600" />}
              </div>
              {showClientList && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg max-h-56 overflow-auto p-1">
                  {clients.length === 0 ? <div className="px-3 py-2 text-sm text-secondary">No clients found — add them on the Clients page first.</div> :
                   filteredClients.length === 0 ? <div className="px-3 py-2 text-sm text-secondary">No match for “{clientSearch}”.</div> :
                    filteredClients.map((c) => (
                      <button key={c.id} onClick={() => selectClient(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 rounded-lg">
                        <span className="font-medium text-primary">{c.company || c.name}</span>
                        {c.company && c.name && c.name !== c.company && <span className="text-xs text-secondary ml-2">{c.name}</span>}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <Input label="Contact Person" required value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} />
            <Input label="Client GST Number" value={form.clientGst} onChange={(v) => setForm({ ...form, clientGst: v })} placeholder="Auto-filled from client" />
            <Input label="Document Date" type="date" required value={form.documentDate} onChange={(v) => setForm({ ...form, documentDate: v })} />
            <Input label="Expiration Date" type="date" required value={form.expirationDate} onChange={(v) => setForm({ ...form, expirationDate: v })} />
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Payment Terms <span className="text-red-500">*</span></label>
              {(() => {
                const isCustom = !PRESET_TERMS.includes(form.paymentTerms);
                return (
                  <div className="space-y-2">
                    <Select
                      ariaLabel="Payment Terms"
                      value={isCustom ? 'Custom' : form.paymentTerms}
                      onChange={(v) => setForm({ ...form, paymentTerms: v === 'Custom' ? '' : v })}
                      options={PAYMENT_TERMS.map((t) => ({ label: t, value: t }))}
                    />
                    {isCustom && (
                      <input
                        value={form.paymentTerms}
                        onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
                        placeholder="Enter custom payment terms (e.g. Net 30)"
                        className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
                      />
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Billing Address</label>
              <textarea value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} rows={2} placeholder="Auto-filled from client — edit if needed" className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary resize-none" />
            </div>
          </div>


          {/* Order lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-primary">Order Lines</h3>
              <button onClick={() => setLineItems((r) => [...r, emptyLine()])} className="flex items-center gap-1.5 text-xs font-medium text-primary border border-border rounded-lg px-2.5 py-1.5 hover:bg-gray-50"><Plus className="h-3.5 w-3.5" /> Add Row</button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border bg-white">
              <table className="w-full text-sm min-w-[920px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-secondary border-b border-border">
                  <th className="px-2 py-2 w-8">#</th><th className="px-2 py-2">Description</th><th className="px-2 py-2 w-24">Unit</th>
                  <th className="px-2 py-2 w-16">Qty</th><th className="px-2 py-2 w-24">Unit Price</th><th className="px-2 py-2 w-16">Disc %</th>
                  <th className="px-2 py-2 w-16">Tax %</th><th className="px-2 py-2 w-40">Tax Type</th><th className="px-2 py-2 w-28 text-right">Amount</th><th className="px-2 py-2 w-8"></th>
                </tr></thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 text-secondary">{i + 1}</td>
                      <td className="px-2 py-1.5"><input value={li.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Service description" className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary" /></td>
                      <td className="px-2 py-1.5">
                        <select value={li.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white">{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                      </td>
                      <td className="px-2 py-1.5"><input type="number" value={li.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary text-right" /></td>
                      <td className="px-2 py-1.5"><input type="number" value={li.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} placeholder="0" className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary text-right" /></td>
                      <td className="px-2 py-1.5"><input type="number" value={li.discountPct} onChange={(e) => setLine(i, 'discountPct', e.target.value)} placeholder="0" className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary text-right" /></td>
                      <td className="px-2 py-1.5"><input type="number" value={li.taxPct} onChange={(e) => setLine(i, 'taxPct', e.target.value)} placeholder="18" className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-primary text-right" /></td>
                      <td className="px-2 py-1.5">
                        <Select ariaLabel="Tax Type" rounded="rounded-lg" buttonClassName="px-2.5 py-1.5" value={li.taxType} onChange={(v) => setLine(i, 'taxType', v)} options={TAX_TYPES.map((t) => ({ label: t.label, value: t.value }))} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium text-primary tabular-nums">{formatCurrency(fin.amounts[i] || 0)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {lineItems.length > 1 && <button onClick={() => setLineItems((r) => r.filter((_, idx) => idx !== i))} className="p-1 text-secondary hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial summary */}
          <div className="flex justify-end">
            <div className="w-full sm:w-80 bg-white border border-border rounded-xl p-4 space-y-1.5 text-sm">
              <Row label="Sub Total" value={formatCurrency(fin.untaxed + fin.disc)} />
              {fin.disc > 0 && <Row label="Discount" value={`- ${formatCurrency(fin.disc)}`} />}
              {fin.disc > 0 && <Row label="Taxable Amount" value={formatCurrency(fin.untaxed)} />}
              {fin.totalTax > 0 && <Row label="Total Tax" value={formatCurrency(fin.totalTax)} />}
              <div className="flex justify-between pt-2 mt-1 border-t border-border"><span className="font-bold text-primary">Grand Total</span><span className="font-bold text-primary text-base">{formatCurrency(fin.grand)}</span></div>
              {fin.rcm && <p className="text-[11px] text-amber-700 pt-1">Tax payable under reverse charge (RCM).</p>}
            </div>
          </div>

          {/* Scope & Terms */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope of Work</label>
              <RichTextEditor value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} placeholder="Enter scope of work..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Terms &amp; Conditions</label>
            <textarea value={form.termsConditions} onChange={(e) => setForm({ ...form, termsConditions: e.target.value })} rows={4} className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-primary resize-none" />
            </div>
          </div>

          {/* Other Info (collapsible) */}
          <div className="border-t border-border pt-4">
            <button onClick={() => setShowOther((s) => !s)} className="text-sm font-semibold text-primary">{showOther ? '− Hide' : '+ Show'} Other Info (sales, invoicing, delivery)</button>
            {showOther && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Salesperson</label>
                  <Select ariaLabel="Salesperson" value={form.salespersonId} onChange={(v) => setForm({ ...form, salespersonId: v })} options={[{ label: 'Unassigned', value: '' }, ...members.map((m: any) => ({ label: m.name, value: m.id }))]} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Sales Team</label>
                  <Select ariaLabel="Sales Team" value={form.salesTeam} onChange={(v) => setForm({ ...form, salesTeam: v })} options={[{ label: '—', value: '' }, ...SALES_TEAMS.map((t) => ({ label: t, value: t }))]} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Payment Method</label>
                  <Select ariaLabel="Payment Method" value={form.paymentMethod} onChange={(v) => setForm({ ...form, paymentMethod: v })} options={[{ label: '—', value: '' }, ...PAY_METHODS.map((t) => ({ label: t, value: t }))]} />
                </div>
                <Input label="Project Start Date" type="date" value={form.projectStartDate} onChange={(v) => setForm({ ...form, projectStartDate: v })} />
                <Input label="Delivery / Completion Date" type="date" value={form.deliveryDate} onChange={(v) => setForm({ ...form, deliveryDate: v })} />
                <Input label="Tags (comma separated)" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
                <div className="flex items-center gap-6 pt-7">
                  <label className="flex items-center gap-2 text-sm text-[#374151]"><input type="checkbox" checked={form.onlineSignature} onChange={(e) => setForm({ ...form, onlineSignature: e.target.checked })} /> Online Signature</label>
                  <label className="flex items-center gap-2 text-sm text-[#374151]"><input type="checkbox" checked={form.onlinePayment} onChange={(e) => setForm({ ...form, onlinePayment: e.target.checked })} /> Online Payment</label>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Project Notes (internal)</label>
                  <textarea value={form.projectNotes} onChange={(e) => setForm({ ...form, projectNotes: e.target.value })} rows={2} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary resize-none" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-[#374151] bg-white border border-border rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={onSaveDraft} disabled={submitting} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-[#374151] bg-white border border-border rounded-xl hover:bg-gray-50 disabled:opacity-50"><Save className="h-4 w-4" /> Save Draft</button>
          <button onClick={onGeneratePdf} disabled={submitting} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] disabled:opacity-50"><FileDown className="h-4 w-4" /> Generate PDF</button>
        </div>
      </motion.div>
    </>
  );
}

function Input({ label, value, onChange, type = 'text', required = false, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary" />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[#374151]"><span className="text-secondary">{label}</span><span className="tabular-nums">{value}</span></div>;
}
