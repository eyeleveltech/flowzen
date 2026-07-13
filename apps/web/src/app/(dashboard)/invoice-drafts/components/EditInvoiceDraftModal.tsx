'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { TAX_TYPES, DEFAULT_TAX_TYPE } from '@/app/(dashboard)/quotations/lib/tax-catalog';
import toast from 'react-hot-toast';

const UNITS = ['Hours', 'Days', 'Months', 'Units', 'Lump Sum'];

type Line = { description: string; unit: string; quantity: string; unitPrice: string; discountPct: string; taxPct: string; taxType: string };
const emptyLine = (): Line => ({ description: '', unit: 'Units', quantity: '1', unitPrice: '', discountPct: '', taxPct: '18', taxType: DEFAULT_TAX_TYPE });

export function EditInvoiceDraftModal({ draftId, onClose, onSaved }: { draftId: string; onClose: () => void; onSaved: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orgState, setOrgState] = useState<string>('');
  const [clientState, setClientState] = useState<string>('');

  const [lineItems, setLineItems] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.get<any>('/settings/company').then((c) => {
      setOrgState(c?.state || '');
    }).catch(() => {});

    api.get<any>(`/revenue/invoice-drafts`).then((data: any[]) => {
      const draft = data.find((d: any) => d.id === draftId);
      if (draft) {
        setLineItems(draft.lineItems || [emptyLine()]);
        setNotes(draft.notes || '');
        // Hack: Fetch client to get client state to know IGST vs CGST/SGST
        api.get<any>(`/crm/clients/${draft.clientId}`).then((c) => {
          setClientState(c?.state || '');
        }).catch(() => {});
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [draftId]);

  const taxCalculationMethod = orgState && clientState && orgState.toLowerCase() !== clientState.toLowerCase() ? 'IGST' : 'CGST_SGST';

  const totals = useMemo(() => {
    let untaxedAmount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    lineItems.forEach((item) => {
      const q = parseFloat(item.quantity) || 0;
      const p = parseFloat(item.unitPrice) || 0;
      const d = parseFloat(item.discountPct) || 0;
      const t = parseFloat(item.taxPct) || 0;

      const base = q * p;
      const discounted = base - (base * d) / 100;
      untaxedAmount += discounted;

      if (t > 0) {
        const taxVal = (discounted * t) / 100;
        if (taxCalculationMethod === 'IGST') {
          igst += taxVal;
        } else {
          cgst += taxVal / 2;
          sgst += taxVal / 2;
        }
      }
    });

    const totalTax = cgst + sgst + igst;
    return {
      untaxedAmount,
      cgst,
      sgst,
      igst,
      totalTax,
      grandTotal: untaxedAmount + totalTax
    };
  }, [lineItems, taxCalculationMethod]);

  const handleSave = async () => {
    if (lineItems.some(i => !i.description.trim())) {
      toast.error('All line items must have a description');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        lineItems,
        notes,
        untaxedAmount: totals.untaxedAmount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        totalTax: totals.totalTax,
        grandTotal: totals.grandTotal,
      };

      await api.put(`/revenue/invoice-drafts/${draftId}`, payload);
      toast.success('Invoice Draft updated');
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to update invoice draft');
    } finally {
      setSubmitting(false);
    }
  };

  const updateLine = (i: number, field: keyof Line, val: string) => {
    const newLines = [...lineItems];
    newLines[i] = { ...newLines[i], [field]: val };
    setLineItems(newLines);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-primary">Edit Invoice Draft</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-secondary hover:bg-[#F3F4F6] transition-colors"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-[#F9FAFB]">
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="border-b border-border bg-[#F9FAFB] px-4 py-3"><h3 className="font-semibold text-primary">Line Items</h3></div>
            <div className="p-4 space-y-4">
              <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_1.5fr_0.5fr] gap-4 px-2 text-xs font-semibold text-secondary uppercase tracking-wider">
                <div>Description</div>
                <div>Unit</div>
                <div>Qty</div>
                <div>Price (₹)</div>
                <div>Disc %</div>
                <div>Tax</div>
                <div></div>
              </div>

              <div className="space-y-4">
                {lineItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.5fr_1fr_1.5fr_0.5fr] gap-4 items-start relative bg-white p-4 lg:p-0 rounded-xl border border-border lg:border-none shadow-sm lg:shadow-none">
                    <div className="lg:hidden absolute top-4 right-4"><button onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))} className="text-secondary hover:text-red-500"><Trash2 className="h-4 w-4" /></button></div>
                    <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Description</label><input type="text" value={item.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Item description" className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" /></div>
                    <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Unit</label><Select value={item.unit} onChange={v => updateLine(i, 'unit', v)} options={UNITS.map(u => ({ label: u, value: u }))} /></div>
                    <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                      <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Qty</label><input type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" /></div>
                    </div>
                    <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Price (₹)</label><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateLine(i, 'unitPrice', e.target.value)} className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" /></div>
                    <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Disc %</label><input type="number" min="0" max="100" step="0.01" value={item.discountPct} onChange={e => updateLine(i, 'discountPct', e.target.value)} placeholder="0" className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary" /></div>
                    <div className="space-y-1"><label className="lg:hidden text-xs font-medium text-secondary">Tax</label><Select value={item.taxType} onChange={v => updateLine(i, 'taxType', v)} options={TAX_TYPES} /></div>
                    <div className="hidden lg:flex items-center justify-center pt-1"><button onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))} className="p-2 text-secondary hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"><Trash2 className="h-4 w-4" /></button></div>
                  </div>
                ))}
              </div>

              <button onClick={() => setLineItems([...lineItems, emptyLine()])} className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 p-2 rounded-lg hover:bg-blue-50 transition-colors w-max"><Plus className="h-4 w-4" /> Add Item</button>

              <div className="mt-8 flex flex-col items-end border-t border-border pt-6">
                <div className="w-full max-w-sm space-y-3">
                  <div className="flex justify-between text-sm"><span className="text-secondary">Subtotal (Untaxed)</span><span className="font-medium text-primary">{formatCurrency(totals.untaxedAmount)}</span></div>
                  {totals.totalTax > 0 && (
                    <>
                      {taxCalculationMethod === 'IGST' ? (
                        <div className="flex justify-between text-sm"><span className="text-secondary">IGST</span><span className="font-medium text-primary">{formatCurrency(totals.igst)}</span></div>
                      ) : (
                        <>
                          <div className="flex justify-between text-sm"><span className="text-secondary">CGST</span><span className="font-medium text-primary">{formatCurrency(totals.cgst)}</span></div>
                          <div className="flex justify-between text-sm"><span className="text-secondary">SGST</span><span className="font-medium text-primary">{formatCurrency(totals.sgst)}</span></div>
                        </>
                      )}
                    </>
                  )}
                  <div className="flex justify-between border-t border-border pt-3 text-lg font-bold"><span className="text-primary">Grand Total</span><span className="text-primary">{formatCurrency(totals.grandTotal)}</span></div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
             <div className="border-b border-border bg-[#F9FAFB] px-4 py-3"><h3 className="font-semibold text-primary">Notes</h3></div>
             <div className="p-4">
                 <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Additional notes..." className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-primary resize-none" />
             </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4 bg-[#F9FAFB]">
          <button onClick={onClose} disabled={submitting} className="rounded-xl px-5 py-2.5 text-sm font-medium text-secondary hover:bg-border transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={handleSave} disabled={submitting} className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all shadow-sm disabled:opacity-50">
            {submitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Save className="h-4 w-4" />}
            Save Draft
          </button>
        </div>
      </motion.div>
    </div>
  );
}
