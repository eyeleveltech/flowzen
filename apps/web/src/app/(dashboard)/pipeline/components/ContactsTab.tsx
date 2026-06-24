'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Mail, Phone, Link2, Sparkles, Loader2, Pencil, Trash2, X, FileText, User } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/utils';
import toast from 'react-hot-toast';
import { ContactModal, CONTACT_ROLES } from './ContactModal';
import { DossierView } from './DossierView';

const roleMeta = (role: string) => CONTACT_ROLES.find((r) => r.v === role);

export function ContactsTab({ leadId, lead }: { leadId: string; lead: any }) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; contact?: any }>({ open: false });
  const [running, setRunning] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await api.get<any[]>(`/crm/leads/${leadId}/contacts`);
    setContacts(r);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const runIntelligence = async (c: any) => {
    setRunning(c.id);
    try {
      await api.post(`/crm/leads/${leadId}/contacts/${c.id}/intelligence`, {});
      toast.success('Intelligence generated');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Intelligence failed');
    } finally {
      setRunning(null);
    }
  };

  const remove = async (c: any) => {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    try {
      await api.delete(`/crm/leads/${leadId}/contacts/${c.id}`);
      toast.success('Contact removed');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove');
    }
  };

  return (
    <div className="space-y-4">
      {/* Primary contact (read-only, from the lead) */}
      <div className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold ${getAvatarColor(lead.contactName || 'Lead')}`}>{getInitials(lead.contactName || lead.companyName || 'L')}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-primary truncate">{lead.contactName || '—'}</p>
              <span className="px-2 py-0.5 rounded-md bg-primary text-white text-[10px] font-semibold">Primary</span>
              {lead.jobTitle && <span className="text-xs text-secondary">· {lead.jobTitle}</span>}
            </div>
            <div className="flex items-center gap-x-4 gap-y-1 mt-1 text-xs text-secondary flex-wrap">
              {lead.contactEmail && <a href={`mailto:${lead.contactEmail}`} className="flex items-center gap-1 hover:text-primary"><Mail className="w-3 h-3" /> {lead.contactEmail}</a>}
              {lead.contactPhone && <a href={`tel:${lead.contactPhone}`} className="flex items-center gap-1 hover:text-primary"><Phone className="w-3 h-3" /> {lead.contactPhone}</a>}
              {lead.linkedinUrl && <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><Link2 className="w-3 h-3" /> LinkedIn</a>}
            </div>
          </div>
        </div>
      </div>

      {/* Secondary contacts */}
      <div className="bg-white rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2"><User className="w-4 h-4 text-secondary" /> Stakeholders <span className="text-secondary font-normal">({contacts.length})</span></h2>
          <button onClick={() => setModal({ open: true })} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-gray-800 transition-colors"><Plus className="w-4 h-4" /> Add Contact</button>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
        ) : contacts.length === 0 ? (
          <p className="py-8 text-center text-sm text-secondary">No secondary contacts yet. Add the other stakeholders in this deal.</p>
        ) : (
          <div className="space-y-3">
            {contacts.map((c) => {
              const rm = roleMeta(c.role);
              return (
                <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl border border-border hover:border-gray-300 transition-colors">
                  <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold ${getAvatarColor(c.name)}`}>{getInitials(c.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-primary truncate">{c.name}</p>
                      {c.designation && <span className="text-xs text-secondary">· {c.designation}</span>}
                      {rm && <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${rm.color}`} title={rm.desc}>{rm.label}</span>}
                    </div>
                    <div className="flex items-center gap-x-4 gap-y-1 mt-1 text-xs text-secondary flex-wrap">
                      {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary"><Mail className="w-3 h-3" /> {c.email}</a>}
                      {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary"><Phone className="w-3 h-3" /> {c.phone}</a>}
                      {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><Link2 className="w-3 h-3" /> LinkedIn</a>}
                    </div>
                    {c.notes && <p className="mt-1.5 text-xs text-[#4B5563]">{c.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.dossierStatus === 'complete' && (
                      <button onClick={() => setDossier(c)} className="flex items-center gap-1 text-xs font-medium text-primary border border-border rounded-lg px-2 py-1.5 hover:bg-gray-50" title="View dossier"><FileText className="w-3.5 h-3.5" /> Dossier</button>
                    )}
                    {c.linkedinUrl && c.dossierStatus !== 'complete' && (
                      <button onClick={() => runIntelligence(c)} disabled={running === c.id} className="flex items-center gap-1 text-xs font-medium text-secondary border border-border rounded-lg px-2 py-1.5 hover:text-primary disabled:opacity-50" title="Run Intelligence">
                        {running === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button onClick={() => setModal({ open: true, contact: c })} className="p-1.5 text-secondary hover:text-primary rounded-lg hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(c)} className="p-1.5 text-secondary hover:text-red-500 rounded-lg hover:bg-gray-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal.open && (
          <ContactModal leadId={leadId} contact={modal.contact} onClose={() => setModal({ open: false })} onSuccess={() => { setModal({ open: false }); load(); }} />
        )}
      </AnimatePresence>

      {/* Dossier side panel */}
      <AnimatePresence>
        {dossier && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={() => setDossier(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-2xl bg-white border-l border-border shadow-2xl overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
                <h2 className="text-lg font-semibold text-primary flex items-center gap-2"><Sparkles className="w-5 h-5 text-secondary" /> {dossier.name} — Dossier</h2>
                <button onClick={() => setDossier(null)} className="p-2 rounded-xl hover:bg-gray-100"><X className="h-4 w-4 text-secondary" /></button>
              </div>
              <div className="p-6"><DossierView d={dossier.dossierJson} /></div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
