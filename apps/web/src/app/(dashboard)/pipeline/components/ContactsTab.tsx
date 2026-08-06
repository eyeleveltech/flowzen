'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Mail, Phone, Link2, Sparkles, Loader2, Pencil, Trash2, X, FileText, User, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor } from '@/lib/utils';
import toast from 'react-hot-toast';
import { ContactModal, CONTACT_ROLES } from './ContactModal';
import { DossierView } from './DossierView';
import { Icon } from '@/components/ui/icon';

const roleMeta = (role: string) => CONTACT_ROLES.find((r) => r.v === role);

export function ContactsTab({ leadId, lead, onChanged }: { leadId: string; lead: any; onChanged?: () => void }) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; contact?: any }>({ open: false });
  const [running, setRunning] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await api.get<any[]>(`/crm/leads/${leadId}/contacts`);
    setContacts(r);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  // Lock body scroll when dossier side panel is open
  useEffect(() => {
    if (dossier) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [dossier]);

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
      // Removing the primary promotes the next contact server-side, which changes the name and
      // email shown in the lead header — so the page's own copy of the lead has to refresh too.
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove');
    }
  };

  const makePrimary = async (c: any) => {
    setPromoting(c.id);
    try {
      await api.patch(`/crm/leads/${leadId}/contacts/${c.id}`, { isPrimary: true });
      toast.success(`${c.name} is now the primary contact`);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to set primary contact');
    } finally {
      setPromoting(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* One list, one source of truth.
          This used to render a separate read-only "Primary contact" card built from the lead's
          own contactName/contactEmail/contactPhone, above a list of "secondary" contacts. Those
          lead columns no longer exist — the person IS a row in this list — so the card showed the
          same human twice, and after the columns were dropped it showed an empty one. */}
      <div className="bg-white rounded-2xl border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-primary flex items-center gap-2"><Icon as={User} size="md" className="text-secondary" /> Contacts <span className="text-secondary font-normal">({contacts.length})</span></h2>
            <p className="text-xs text-secondary mt-0.5">Everyone at {lead.companyName || 'this company'}. The primary contact is the one used on quotations and shown on the board.</p>
          </div>
          <button onClick={() => setModal({ open: true })} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-gray-800 transition-colors"><Icon as={Plus} size="md" /> Add Contact</button>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
        ) : contacts.length === 0 ? (
          <p className="py-8 text-center text-sm text-secondary">No contacts yet. Add the people you deal with at this company.</p>
        ) : (
          <div className="space-y-3">
            {contacts.map((c) => {
              const rm = roleMeta(c.role);
              return (
                <div key={c.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${c.isPrimary ? 'border-primary/30 bg-primary/3' : 'border-border hover:border-gray-300'}`}>
                  <div className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold ${getAvatarColor(c.name)}`}>{getInitials(c.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-primary truncate">{c.name}</p>
                      {c.isPrimary && <span className="inline-flex px-2 py-0.5 rounded-md bg-primary text-white text-[10px] font-semibold">Primary</span>}
                      {c.designation && <span className="text-xs text-secondary">· {c.designation}</span>}
                      {rm && <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${rm.color}`} title={rm.desc}>{rm.label}</span>}
                    </div>
                    <div className="flex items-center gap-x-4 gap-y-1 mt-1 text-xs text-secondary flex-wrap">
                      {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary"><Mail className="h-3 w-3" /> {c.email}</a>}
                      {c.phone && <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-primary"><Phone className="h-3 w-3" /> {c.phone}</a>}
                      {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary"><Link2 className="h-3 w-3" /> LinkedIn</a>}
                    </div>
                    {c.notes && <p className="mt-1.5 text-xs text-text-on-sunken">{c.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!c.isPrimary && (
                      <button onClick={() => makePrimary(c)} disabled={promoting === c.id} className="flex items-center gap-1 text-xs font-medium text-secondary border border-border rounded-lg px-2 py-1.5 hover:text-primary disabled:opacity-50" title="Make this the primary contact">
                        {promoting === c.id ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Star} size="sm" />}
                      </button>
                    )}
                    {c.dossierStatus === 'complete' && (
                      <button onClick={() => setDossier(c)} className="flex items-center gap-1 text-xs font-medium text-primary border border-border rounded-lg px-2 py-1.5 hover:bg-gray-50" title="View dossier"><Icon as={FileText} size="sm" /> Dossier</button>
                    )}
                    {c.linkedinUrl && c.dossierStatus !== 'complete' && (
                      <button onClick={() => runIntelligence(c)} disabled={running === c.id} className="flex items-center gap-1 text-xs font-medium text-secondary border border-border rounded-lg px-2 py-1.5 hover:text-primary disabled:opacity-50" title="Run Intelligence">
                        {running === c.id ? <Icon as={Loader2} size="sm" className="animate-spin" /> : <Icon as={Sparkles} size="sm" />}
                      </button>
                    )}
                    <button onClick={() => setModal({ open: true, contact: c })} className="p-1.5 text-secondary hover:text-primary rounded-lg hover:bg-gray-50"><Icon as={Pencil} size="sm" /></button>
                    <button onClick={() => remove(c)} className="p-1.5 text-secondary hover:text-red-500 rounded-lg hover:bg-gray-50"><Icon as={Trash2} size="sm" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal.open && (
          <ContactModal leadId={leadId} contact={modal.contact} onClose={() => setModal({ open: false })} onSuccess={() => { setModal({ open: false }); load(); onChanged?.(); }} />
        )}
      </AnimatePresence>

      {/* Dossier side panel */}
      <AnimatePresence>
        {dossier && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-100 bg-black/20 backdrop-blur-sm" onClick={() => setDossier(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-101 w-full max-w-2xl bg-white border-l border-border shadow-modal overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
                <h2 className="text-lg font-semibold text-primary flex items-center gap-2"><Icon as={Sparkles} size="lg" className="text-secondary" /> {dossier.name} — Dossier</h2>
                <button onClick={() => setDossier(null)} className="p-2 rounded-xl hover:bg-gray-100"><Icon as={X} size="md" className="text-secondary" /></button>
              </div>
              <div className="p-6 pb-24 md:pb-6"><DossierView d={dossier.dossierJson} /></div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
