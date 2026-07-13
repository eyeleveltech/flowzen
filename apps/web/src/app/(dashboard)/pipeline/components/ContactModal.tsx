'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

export const CONTACT_ROLES = [
  { v: 'DECISION_MAKER', label: 'Decision Maker', desc: 'Final sign-off authority — the person who says yes or no', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { v: 'INFLUENCER', label: 'Influencer', desc: 'Shapes the decision but does not sign off', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { v: 'GATEKEEPER', label: 'Gatekeeper', desc: 'Controls access to the Decision Maker', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { v: 'CHAMPION', label: 'Champion', desc: 'Internal advocate on our side — wants us to win', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { v: 'CC_ONLY', label: 'CC Only', desc: 'Kept in the loop but not in the conversation', color: 'bg-gray-100 text-gray-600 border-gray-200' },
] as const;

const inputCls = 'w-full rounded-xl border border-border bg-gray-50 px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-all';
const labelCls = 'block text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5';

export function ContactModal({ leadId, contact, onClose, onSuccess }: { leadId: string; contact?: any; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!contact;
  const [form, setForm] = useState<Record<string, any>>({
    name: contact?.name || '', designation: contact?.designation || '', email: contact?.email || '',
    phone: contact?.phone || '', linkedinUrl: contact?.linkedinUrl || '', role: contact?.role || 'DECISION_MAKER', notes: contact?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Lock body scroll when ContactModal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/crm/leads/${leadId}/contacts/${contact.id}`, form);
      else await api.post(`/crm/leads/${leadId}/contacts`, form);
      toast.success(isEdit ? 'Contact updated' : 'Contact added');
      onSuccess();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-md bg-white border-l border-border shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">{isEdit ? 'Edit Contact' : 'Add Contact'}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X className="h-4 w-4 text-secondary" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" /></div>
          <div><label className={labelCls}>Designation / Title</label><input className={inputCls} value={form.designation} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. CMO" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Email</label><input className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Phone</label><input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          </div>

          <div>
            <label className={labelCls}>Role in Deal *</label>
            <select className={inputCls} value={form.role} onChange={(e) => set('role', e.target.value)}>
              {CONTACT_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-secondary">{CONTACT_ROLES.find((r) => r.v === form.role)?.desc}</p>
          </div>
          <div><label className={labelCls}>Notes</label><textarea rows={3} className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Context about this person's involvement" /></div>
        </div>

        <div className="p-5 pb-safe border-t border-border bg-white flex justify-end gap-3 sticky bottom-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-border rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : isEdit ? 'Save' : 'Add Contact'}</button>
        </div>
      </motion.div>
    </>
  );
}
