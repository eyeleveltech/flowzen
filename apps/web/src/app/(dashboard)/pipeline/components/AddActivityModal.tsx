'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Phone, Calendar, Pencil, Mail } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

type Kind = 'call' | 'meeting' | 'note' | 'email';
const KINDS: { k: Kind; label: string; icon: any }[] = [
  { k: 'call', label: 'Call', icon: Phone },
  { k: 'meeting', label: 'Meeting', icon: Calendar },
  { k: 'note', label: 'Note', icon: Pencil },
  { k: 'email', label: 'Email', icon: Mail },
];

const inputCls = 'w-full rounded-xl border border-border bg-gray-50 px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-all';
const labelCls = 'block text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5';

export function AddActivityModal({ leadId, onClose, onSuccess }: { leadId: string; onClose: () => void; onSuccess: () => void }) {
  const [kind, setKind] = useState<Kind>('call');
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = { kind, body: form.body || undefined };
      if (kind === 'call') Object.assign(payload, { callDate: form.callDate, duration: form.duration ? Number(form.duration) : undefined, outcome: form.outcome, followUpRequired: !!form.followUpRequired, followUpDate: form.followUpRequired ? form.followUpDate : undefined });
      if (kind === 'meeting') Object.assign(payload, { meetingDate: form.meetingDate, meetingFormat: form.meetingFormat, attendees: form.attendees, nextStep: form.nextStep });
      if (kind === 'note') Object.assign(payload, { internal: form.internal !== false });
      if (kind === 'email') Object.assign(payload, { subject: form.subject, direction: form.direction, emailDate: form.emailDate });
      await api.post(`/crm/leads/${leadId}/activity`, payload);
      toast.success('Activity logged');
      onSuccess();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to log activity');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-md bg-white border-l border-border shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-primary">Add Activity</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100"><X className="h-4 w-4 text-secondary" /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Kind picker */}
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map(({ k, label, icon: Icon }) => (
              <button key={k} onClick={() => setKind(k)} className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all ${kind === k ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-border hover:border-primary'}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {kind === 'call' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Date & Time</label><input type="datetime-local" className={inputCls} value={form.callDate || ''} onChange={(e) => set('callDate', e.target.value)} /></div>
                <div><label className={labelCls}>Duration (min)</label><input type="number" className={inputCls} value={form.duration || ''} onChange={(e) => set('duration', e.target.value)} placeholder="15" /></div>
              </div>
              <div><label className={labelCls}>Outcome</label>
                <select className={inputCls} value={form.outcome || ''} onChange={(e) => set('outcome', e.target.value)}>
                  <option value="">Select…</option>{['Connected', 'No Answer', 'Voicemail', 'Busy'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Call Notes</label><textarea rows={3} className={inputCls} value={form.body || ''} onChange={(e) => set('body', e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={!!form.followUpRequired} onChange={(e) => set('followUpRequired', e.target.checked)} /> Follow-up required</label>
              {form.followUpRequired && <div><label className={labelCls}>Follow-up Date</label><input type="date" className={inputCls} value={form.followUpDate || ''} onChange={(e) => set('followUpDate', e.target.value)} /></div>}
            </>
          )}

          {kind === 'meeting' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Date & Time</label><input type="datetime-local" className={inputCls} value={form.meetingDate || ''} onChange={(e) => set('meetingDate', e.target.value)} /></div>
                <div><label className={labelCls}>Format</label>
                  <select className={inputCls} value={form.meetingFormat || ''} onChange={(e) => set('meetingFormat', e.target.value)}>
                    <option value="">Select…</option>{['In-Person', 'Video', 'Phone'].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={labelCls}>Attendees</label><input className={inputCls} value={form.attendees || ''} onChange={(e) => set('attendees', e.target.value)} placeholder="Names of attendees" /></div>
              <div><label className={labelCls}>Meeting Notes</label><textarea rows={3} className={inputCls} value={form.body || ''} onChange={(e) => set('body', e.target.value)} /></div>
              <div><label className={labelCls}>Next Step Agreed</label><input className={inputCls} value={form.nextStep || ''} onChange={(e) => set('nextStep', e.target.value)} /></div>
            </>
          )}

          {kind === 'note' && (
            <>
              <div><label className={labelCls}>Note</label><textarea rows={5} className={inputCls} value={form.body || ''} onChange={(e) => set('body', e.target.value)} /></div>
              <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.internal !== false} onChange={(e) => set('internal', e.target.checked)} /> Internal only (not visible to client)</label>
            </>
          )}

          {kind === 'email' && (
            <>
              <div><label className={labelCls}>Subject</label><input className={inputCls} value={form.subject || ''} onChange={(e) => set('subject', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Direction</label>
                  <select className={inputCls} value={form.direction || ''} onChange={(e) => set('direction', e.target.value)}>
                    <option value="">Select…</option>{['Sent', 'Received'].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div><label className={labelCls}>Date</label><input type="date" className={inputCls} value={form.emailDate || ''} onChange={(e) => set('emailDate', e.target.value)} /></div>
              </div>
              <div><label className={labelCls}>Summary</label><textarea rows={3} className={inputCls} value={form.body || ''} onChange={(e) => set('body', e.target.value)} /></div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-border bg-white flex justify-end gap-3 sticky bottom-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-border rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Log Activity'}</button>
        </div>
      </motion.div>
    </>
  );
}
