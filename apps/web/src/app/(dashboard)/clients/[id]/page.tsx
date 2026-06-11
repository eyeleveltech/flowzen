'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, getInitials, formatRelativeDate, getAvatarColor } from '@/lib/utils';
import { ArrowLeft, Mail, Phone, MapPin, Building2, DollarSign, X, Plus, Users, Globe, Briefcase, Trash2 } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import toast from 'react-hot-toast';
import { useMembers } from '@/hooks/useQueries';
import { useConfirmStore } from '@/stores';

interface ClientContact {
  id: string; name: string; designation?: string | null; email?: string | null; phone?: string | null;
}

interface ClientDetail {
  id: string; name: string; company?: string | null; industry?: string | null;
  contacts?: ClientContact[];
  address?: string | null; contractValue?: number | null;
  engagementType?: string | null; website?: string | null; city?: string | null; scope?: string | null; assetLinks?: string | null; accountManagerId?: string | null;
  accountManager?: { id: string; name: string; avatar?: string | null } | null;
  startDate?: string | null; status: string; createdAt: string;
  projects: { id: string; name: string; status: string; progress: number; endDate?: string | null; owner?: { id: string; name: string; avatar?: string | null }; _count?: { tasks: number } }[];
  notes: { id: string; content: string; type: string; createdAt: string; author: { name: string } }[];
  activities: { id: string; type: string; message: string; createdAt: string; user: { name: string } }[];
}

type Tab = 'overview' | 'projects' | 'activity' | 'notes';

const statusColors: Record<string, string> = {
  PROSPECT: 'bg-blue-50 text-blue-700', ACTIVE: 'bg-emerald-50 text-emerald-700',
  ONHOLD: 'bg-amber-50 text-amber-700', CHURNED: 'bg-gray-50 text-gray-400',
};

export default function ClientDetailPage() {
  const { id } = useParams();
  const confirm = useConfirmStore((s) => s.confirm);
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [noteContent, setNoteContent] = useState('');
  const [viewModalContent, setViewModalContent] = useState<{ title: string, content: string } | null>(null);

  const { data: members = [] } = useMembers();

  // Edit State
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', company: '', industry: '', address: '', contractValue: '', status: 'PROSPECT',
    engagementType: '', website: '', city: '', scope: '', assetLinks: '', accountManagerId: '', startDate: '',
    contacts: [{ id: '', name: '', designation: '', email: '', phone: '' }] as ClientContact[]
  });
  const [editError, setEditError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orgProfile, setOrgProfile] = useState<any>(null);

  useEffect(() => {
    api.get<ClientDetail>(`/clients/${id}`).then(setClient).catch(() => router.push('/clients'));
  }, [id, router]);

  useEffect(() => {
    if (client && client.name === 'Internal') {
      api.get('/settings/organization').then(setOrgProfile).catch(() => {});
    }
  }, [client]);

  async function addNote() {
    if (!noteContent.trim()) return;
    try {
      await api.post(`/clients/${id}/notes`, { content: noteContent, type: 'INTERNAL' });
      toast.success('Note added');
      setNoteContent('');
      const updated = await api.get<ClientDetail>(`/clients/${id}`);
      setClient(updated);
    } catch (err: any) { toast.error(err.message || 'Failed to add note'); }
  }


  async function handleDelete() {
    const isConfirmed = await confirm({
      title: 'Delete Client',
      message: 'Are you sure you want to delete this client? All associated projects will also be removed. This action cannot be undone.',
      confirmText: 'Delete Client',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!isConfirmed) return;
    try {
      await api.delete(`/clients/${id}`);
      toast.success('Client deleted successfully');
      router.push('/clients');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete client');
    }
  }

  function openEdit() {
    setEditForm({
      name: client!.name || '',
      company: client!.company || '',
      industry: client!.industry || '',
      address: client!.address || '',
      contractValue: client!.contractValue?.toString() || '',
      startDate: client!.startDate ? new Date(client!.startDate).toISOString().split('T')[0] : '',
      status: client!.status,
      engagementType: client!.engagementType || '',
      website: client!.website || '',
      city: client!.city || '',
      scope: client!.scope || '',
      assetLinks: client!.assetLinks || '',
      accountManagerId: client!.accountManagerId || '',
      contacts: client!.contacts?.length ? [...client!.contacts] : [{ id: '', name: '', designation: '', email: '', phone: '' }]
    });
    setShowEdit(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError('');
    setSubmitting(true);
    try {
      await api.put(`/clients/${id}`, {
        ...editForm,
        contractValue: editForm.contractValue ? parseFloat(editForm.contractValue) : undefined,
        startDate: editForm.startDate || undefined,
        contacts: editForm.contacts.filter(c => c.name.trim() !== ''),
      });
      toast.success('Client updated successfully');
      setShowEdit(false);
      const updated = await api.get<ClientDetail>(`/clients/${id}`);
      setClient(updated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update client');
      setEditError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!client) return <div className="py-20 text-center text-sm text-[#9CA3AF]">Loading...</div>;

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview' },
    { id: 'projects' as Tab, label: `Projects (${client.projects.length})` },
    { id: 'activity' as Tab, label: 'Activity' },
    { id: 'notes' as Tab, label: `Notes (${client.notes.length})` },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button onClick={() => router.push('/clients')} className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111827] mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Clients
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-start gap-4">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold ${getAvatarColor(client.name === 'Internal' ? (client.company || 'O') : client.name)}`}>
            {getInitials(client.name === 'Internal' ? (client.company || 'O') : client.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#111827]">
              {client.name === 'Internal' ? client.company : client.name}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              {client.company && client.name !== 'Internal' && <span className="text-sm text-[#6B7280]">{client.company}</span>}
              {client.name === 'Internal' && <span className="text-sm font-medium text-[#6B7280]">(Internal)</span>}
              <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[client.status]}`}>{client.status}</span>
            </div>
          </div>
        </div>
        {client.name !== 'Internal' && (
          <div className="flex items-center gap-2">
            <button onClick={openEdit} className="px-4 py-2 bg-white border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#374151] hover:bg-gray-50 transition-colors shadow-sm">
              Edit Client
            </button>
            <button onClick={handleDelete} className="px-4 py-2 bg-white border border-red-200 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors shadow-sm flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#E5E7EB] mb-6">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${tab === t.id ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#111827]">
              {client.name === 'Internal' ? 'Organization Profile' : 'Company Details'}
            </h3>
            
            {client.name === 'Internal' && orgProfile ? (
              <div className="space-y-4 pt-1">
                <p className="text-sm text-[#374151] leading-relaxed">
                  {orgProfile.description || 'No organization description provided.'}
                </p>
                <InfoRow icon={Briefcase} label="Industry" value={orgProfile.industry || 'Not specified'} />
                <InfoRow icon={MapPin} label="Address" value={orgProfile.address || 'Not specified'} />
                <InfoRow icon={Phone} label="Main Phone" value={orgProfile.phone || 'Not specified'} />
              </div>
            ) : (
              <>
                {client.engagementType && <InfoRow icon={Briefcase} label="Engagement Type" value={client.engagementType} />}
                {client.website && <InfoRow icon={Globe} label="Website" value={client.website} />}
                {client.city && <InfoRow icon={MapPin} label="City" value={client.city} />}
                {client.address && <InfoRow icon={MapPin} label="Address" value={client.address} />}
                {client.industry && <InfoRow icon={Building2} label="Industry" value={client.industry} />}
                {client.accountManager && <InfoRow icon={Users} label="Account Manager" value={client.accountManager.name} />}
                {client.assetLinks && <InfoRow icon={Globe} label="Asset Links" value={client.assetLinks} />}
                {client.startDate && <InfoRow icon={DollarSign} label="Start Date" value={formatDate(client.startDate)} />}
                
                {client.scope && (
                  <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
                    <span className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Scope</span>
                    <div 
                      className="text-sm text-[#374151] line-clamp-2 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: client.scope }}
                    />
                    <button 
                      onClick={() => setViewModalContent({ title: 'Scope', content: client.scope || '' })}
                      className="mt-3 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                    >
                      View full scope
                    </button>
                  </div>
                )}
              </>
            )}

            {client.contacts && client.contacts.length > 0 && (
              <div className="pt-4 border-t border-[#F3F4F6]">
                <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Contacts</h4>
                <div className="space-y-3">
                  {client.contacts.map((c) => (
                    <div key={c.id} className="p-3 bg-[#FAFAFA] rounded-xl border border-[#E5E7EB]">
                      <p className="text-sm font-semibold text-[#111827]">{c.name}</p>
                      {c.designation && <p className="text-xs text-[#6B7280] mb-2">{c.designation}</p>}
                      <div className="space-y-1 mt-2">
                        {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-[#9CA3AF]" /><span className="text-xs text-[#374151]">{c.email}</span></div>}
                        {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-[#9CA3AF]" /><span className="text-xs text-[#374151]">{c.phone}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
            <h3 className="text-sm font-semibold text-[#111827] mb-4">Project Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-xl bg-[#F9FAFB]">
                <p className="text-2xl font-bold text-[#111827]">{client.projects.length}</p>
                <p className="text-xs text-[#6B7280]">Total Projects</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-[#F9FAFB]">
                <p className="text-2xl font-bold text-[#111827]">{client.projects.filter((p) => p.status === 'COMPLETED').length}</p>
                <p className="text-xs text-[#6B7280]">Completed</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div className="space-y-3">
          {client.projects.map((p) => (
            <div key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 hover:shadow-sm cursor-pointer transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#111827]">{p.name}</h3>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">{p._count?.tasks ?? 0} tasks · Due {formatDate(p.endDate)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-[#F3F4F6] overflow-hidden">
                      <div className="h-full rounded-full bg-[#111827]" style={{ width: `${p.progress}%` }} />
                    </div>
                    <span className="text-xs text-[#6B7280] tabular-nums">{p.progress}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-3">
          {client.activities.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2">
 <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(a.user.name)}`}>{getInitials(a.user.name)}</div>
              <div>
                <p className="text-sm text-[#374151]"><span className="font-medium">{a.user.name}</span> {a.message}</p>
                <p className="text-xs text-[#9CA3AF]">{formatRelativeDate(a.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'notes' && (
        <div>
          <div className="flex gap-3 mb-6">
            <input value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Add a note..." className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all" />
            <button onClick={addNote} className="rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">Add Note</button>
          </div>
          <div className="space-y-3">
            {client.notes.map((n) => (
              <div key={n.id} className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
                <p className="text-sm text-[#374151]">{n.content}</p>
                <p className="text-xs text-[#9CA3AF] mt-2">{n.author.name} · {formatRelativeDate(n.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {showEdit && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowEdit(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">Edit Client</h2>
                <button onClick={() => setShowEdit(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                  <X className="h-4 w-4 text-[#6B7280]" />
                </button>
              </div>
              <form onSubmit={handleEdit} className="relative p-6 space-y-4">
                {editError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{editError}</div>}
                <Field label="Client Name *" value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} required />
                <Field label="Company" value={editForm.company} onChange={(v) => setEditForm({ ...editForm, company: v })} />
                <Field label="Industry" value={editForm.industry} onChange={(v) => setEditForm({ ...editForm, industry: v })} />
                
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Engagement Type</label>
                  <Select
                    value={editForm.engagementType}
                    onChange={(v) => setEditForm({ ...editForm, engagementType: v })}
                    options={[
                      { label: 'Select type', value: '' },
                      { label: 'Retainer', value: 'Retainer' },
                      { label: 'Project', value: 'Project' },
                      { label: 'Event', value: 'Event' },
                      { label: 'Ad-hoc', value: 'Ad-hoc' }
                    ]}
                  />
                </div>

                <Field label="Website" value={editForm.website} onChange={(v) => setEditForm({ ...editForm, website: v })} />
                <Field label="City" value={editForm.city} onChange={(v) => setEditForm({ ...editForm, city: v })} />
                <Field label="Address" value={editForm.address} onChange={(v) => setEditForm({ ...editForm, address: v })} />
                <Field label="Start Date" type="date" value={editForm.startDate} onChange={(v) => setEditForm({ ...editForm, startDate: v })} />

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope</label>
                  <RichTextEditor
                    value={editForm.scope}
                    onChange={(val) => setEditForm({ ...editForm, scope: val })}
                    placeholder="Enter the scope of work..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Account Manager</label>
                  <Select
                    value={editForm.accountManagerId}
                    onChange={(v) => setEditForm({ ...editForm, accountManagerId: v })}
                    options={[
                      { label: 'Unassigned', value: '' },
                      ...members.map((m: any) => ({ label: m.name, value: m.id }))
                    ]}
                  />
                </div>

                <Field label="Asset Links" value={editForm.assetLinks} onChange={(v) => setEditForm({ ...editForm, assetLinks: v })} />


                <div className="space-y-3 pt-2 pb-2 border-y border-[#F3F4F6]">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-[#374151]">Contacts</label>
                    {editForm.contacts.length < 5 && (
                      <button type="button" onClick={() => setEditForm({ ...editForm, contacts: [...editForm.contacts, { id: '', name: '', designation: '', email: '', phone: '' }] })} className="text-xs font-medium text-[#111827] flex items-center gap-1 hover:bg-[#F3F4F6] px-2 py-1 rounded transition-colors">
                        <Plus className="h-3 w-3" /> Add Contact
                      </button>
                    )}
                  </div>
                  {editForm.contacts.map((contact, i) => (
                    <div key={i} className="p-4 border border-[#E5E7EB] rounded-xl bg-[#FAFAFA] relative">
                      {editForm.contacts.length > 1 && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, contacts: editForm.contacts.filter((_, idx) => idx !== i) })} className="absolute top-2 right-2 p-1.5 text-[#9CA3AF] hover:text-red-500 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-red-100 shadow-sm hover:shadow">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Name *" value={contact.name} onChange={(v) => { const c = [...editForm.contacts]; c[i].name = v; setEditForm({ ...editForm, contacts: c }); }} required />
                        <Field label="Designation" value={contact.designation || ''} onChange={(v) => { const c = [...editForm.contacts]; c[i].designation = v; setEditForm({ ...editForm, contacts: c }); }} />
                        <Field label="Email" type="email" value={contact.email || ''} onChange={(v) => { const c = [...editForm.contacts]; c[i].email = v; setEditForm({ ...editForm, contacts: c }); }} />
                        <Field label="Phone" value={contact.phone || ''} onChange={(v) => { const c = [...editForm.contacts]; c[i].phone = v; setEditForm({ ...editForm, contacts: c }); }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                  <Select
                    value={editForm.status}
                    onChange={(val) => setEditForm({ ...editForm, status: val })}
                    options={[
                      { label: 'Prospect', value: 'PROSPECT' },
                      { label: 'Active', value: 'ACTIVE' },
                      { label: 'On Hold', value: 'ONHOLD' },
                      { label: 'Churned', value: 'CHURNED' },
                    ]}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowEdit(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewModalContent && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm" onClick={() => setViewModalContent(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-[60] w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] shrink-0">
                <h2 className="text-lg font-semibold text-[#111827]">{viewModalContent.title}</h2>
                <button onClick={() => setViewModalContent(null)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-[#6B7280]" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <div 
                  className="prose prose-sm max-w-none text-[#374151]"
                  dangerouslySetInnerHTML={{ __html: viewModalContent.content }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-[#9CA3AF]" />
      <div>
        <p className="text-xs text-[#9CA3AF]">{label}</p>
        <p className="text-sm text-[#374151]">{value}</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm text-[#111827] outline-none focus:border-[#111827] focus:ring-1 focus:ring-[#111827] transition-all"
      />
    </div>
  );
}
