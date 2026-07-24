'use client';

import { useState, useEffect, useId } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, formatCurrency, getInitials, getAvatarColor, getClientDisplayName, formatRelativeDate } from '@/lib/utils';
import { ArrowLeft, Mail, Phone, MapPin, Building2, DollarSign, X, Plus, Users, Globe, Briefcase, Trash2, Calendar, FolderKanban } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import toast from 'react-hot-toast';
import { useMembers } from '@/hooks/useQueries';
import { useConfirmStore, useModuleStore } from '@/stores';
import { CreateProjectModal } from '@/components/projects/create-project-modal';
import { StatusBadge } from '@/components/ui/status-badge';

interface ClientContact {
  id: string; name: string; designation?: string | null; email?: string | null; phone?: string | null;
}

interface ClientDetail {
  id: string; name: string; company?: string | null; industry?: string | null;
  contacts?: ClientContact[];
  address?: string | null; contractValue?: number | null;
  engagementType?: string | null; website?: string | null; city?: string | null; state?: string | null; billingAddress?: string | null; gstNumber?: string | null; scope?: string | null; assetLinks?: string | null; accountManagerId?: string | null;
  accountManager?: { id: string; name: string; avatar?: string | null } | null;
  startDate?: string | null; status: string; createdAt: string;
  projects: { id: string; name: string; status: string; progress: number; endDate?: string | null; owner?: { id: string; name: string; avatar?: string | null }; _count?: { tasks: number } }[];
  notes: { id: string; content: string; type: string; createdAt: string; author: { name: string } }[];
  activities: { id: string; type: string; message: string; createdAt: string; user: { name: string } }[];
}

type Tab = 'overview' | 'projects' | 'activity' | 'notes';

const projectStatusColors: Record<string, string> = {
  PLANNING: 'bg-violet-50 text-violet-700',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  REVIEW: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  ON_HOLD: 'bg-orange-50 text-orange-700',
  CANCELLED: 'bg-red-50 text-red-700',
};

export default function ClientDetailPage() {
  const { id } = useParams();
  const confirm = useConfirmStore((s) => s.confirm);
  const { activeModule } = useModuleStore();
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [viewModalContent, setViewModalContent] = useState<{ title: string, content: string } | null>(null);

  const { data: members = [] } = useMembers();

  // Edit State
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', company: '', industry: '', address: '', contractValue: '', status: 'PROSPECT',
    engagementType: '', website: '', city: '', state: '', billingAddress: '', gstNumber: '', scope: '', assetLinks: '', accountManagerId: '', startDate: '',
    contacts: [{ id: '', name: '', designation: '', email: '', phone: '' }] as ClientContact[]
  });
  const [editError, setEditError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orgProfile, setOrgProfile] = useState<any>(null);

  useEffect(() => {
    const fetchClient = () => api.get<ClientDetail>(`/clients/${id}`).then(setClient).catch(() => router.push('/clients'));
    fetchClient();

    const sse = getSSE();
    if (sse) {
      const handleUpdate = (data: any) => {
        if (!data || !data.id || data.id === id) {
          fetchClient();
        }
      };
      sse.on('client:updated', handleUpdate);
      return () => {
        sse.off('client:updated', handleUpdate);
      };
    }
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
      message: 'This permanently deletes the client and all associated projects. This action cannot be undone.',
      confirmText: 'Delete Client',
      cancelText: 'Cancel',
      variant: 'danger',
      requireText: getClientDisplayName(client),
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
      state: client!.state || '',
      billingAddress: client!.billingAddress || '',
      gstNumber: client!.gstNumber || '',
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

  if (!client) return <div className="py-20 text-center text-sm text-muted">Loading...</div>;

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview' },
    { id: 'projects' as Tab, label: `Projects (${client.projects.length})` },
    { id: 'activity' as Tab, label: 'Activity' },
    { id: 'notes' as Tab, label: `Notes (${client.notes.length})` },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <button onClick={() => router.push('/clients')} className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Clients
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 sm:gap-4 mb-8">
        <div className="flex items-start gap-4">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold ${getAvatarColor(getClientDisplayName(client))}`}>
            {getInitials(getClientDisplayName(client))}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary">
              {getClientDisplayName(client)}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              {client.name !== 'Internal' && client.company && (client.contacts?.[0]?.name || client.name !== client.company) && (
                <span className="text-sm text-secondary font-medium">
                  {client.contacts?.[0]?.name || client.name}
                </span>
              )}
              {client.name === 'Internal' && <span className="text-sm font-medium text-secondary">(Internal)</span>}
              <StatusBadge status={client.status} />
            </div>
          </div>
        </div>
        {client.name !== 'Internal' && (
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
            {!['PROJECT_COMPLETED', 'CHURNED'].includes(client.status) && (
              <button
                onClick={() => setShowCreateProject(true)}
                className="flex-1 sm:flex-none justify-center px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium hover:bg-[#1F2937] transition-colors shadow-sm flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" /> Create Project
              </button>
            )}
            {activeModule !== 'PM' && (
              <>
                <button onClick={openEdit} className="flex-1 sm:flex-none justify-center px-4 py-2 bg-white border border-border rounded-xl text-sm font-medium text-[#374151] hover:bg-gray-50 transition-colors shadow-sm whitespace-nowrap">
                  Edit Client
                </button>
                <button onClick={handleDelete} className="flex-1 sm:flex-none justify-center px-4 py-2 bg-white border border-red-200 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors shadow-sm flex items-center gap-1.5 whitespace-nowrap">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto whitespace-nowrap custom-scrollbar pb-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-border bg-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-primary">
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
              <div className="space-y-6">
                {/* Company Details */}
                <div>
                  <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3 pb-2 border-b border-[#F3F4F6]">Company Details</h4>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                    <InfoRow icon={Building2} label="Industry" value={client.industry || '—'} />
                    <InfoRow icon={Globe} label="Website" value={client.website || '—'} />
                    <InfoRow icon={Users} label="Account Manager" value={client.accountManager?.name || '—'} />
                  </div>
                </div>

                {/* Billing / Address */}
                <div>
                  <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3 pb-2 border-b border-[#F3F4F6]">Billing & Address</h4>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2 mb-4">
                    <InfoRow icon={MapPin} label="City" value={client.city || '—'} />
                  </div>
                  {client.billingAddress && (
                    <div className="text-sm text-[#374151] bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <span className="block text-xs font-semibold text-secondary mb-1">Billing Address</span>
                      {client.billingAddress}
                    </div>
                  )}
                </div>

                {/* Engagement */}
                <div>
                  <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3 pb-2 border-b border-[#F3F4F6]">Engagement</h4>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2 mb-4">
                    <InfoRow icon={Briefcase} label="Engagement Type" value={client.engagementType || '—'} />
                    <InfoRow icon={Calendar} label="Start Date" value={client.startDate ? formatDate(client.startDate) : '—'} />
                  </div>
                  
                  {client.scope ? (
                    <div className="mt-2 bg-blue-50/50 p-4 rounded-xl border border-blue-100/50">
                      <span className="block text-xs font-semibold text-blue-900 mb-2">Scope of Work</span>
                      <div 
                        className="text-sm text-[#374151] line-clamp-3 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: client.scope }}
                      />
                      <button 
                        onClick={() => setViewModalContent({ title: 'Scope', content: client.scope || '' })}
                        className="mt-3 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
                      >
                        View full scope
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No scope defined.</p>
                  )}
                </div>
              </div>
            )}

            {client.contacts && client.contacts.length > 0 && (
              <div className="pt-4 border-t border-[#F3F4F6]">
                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">Contacts</h4>
                <div className="space-y-3">
                  {client.contacts.map((c) => (
                    <div key={c.id} className="p-3 bg-surface rounded-xl border border-border">
                      <p className="text-sm font-semibold text-primary">{c.name}</p>
                      {c.designation && <p className="text-xs text-secondary mb-2">{c.designation}</p>}
                      <div className="space-y-1 mt-2">
                        {c.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted" /><span className="text-xs text-[#374151]">{c.email}</span></div>}
                        {c.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted" /><span className="text-xs text-[#374151]">{c.phone}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-white p-6">
            <h3 className="text-sm font-semibold text-primary mb-4">Project Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-xl bg-[#F9FAFB]">
                <p className="text-2xl font-bold text-primary">{client.projects.length}</p>
                <p className="text-xs text-secondary">Total Projects</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-[#F9FAFB]">
                <p className="text-2xl font-bold text-primary">{client.projects.filter((p) => p.status === 'COMPLETED').length}</p>
                <p className="text-xs text-secondary">Completed</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'projects' && (
        <div className="space-y-3">
          {client.projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
              <FolderKanban className="h-10 w-10 text-[#D1D5DB] mx-auto mb-3" />
              <p className="text-sm font-medium text-primary">No projects yet</p>
              <p className="text-xs text-secondary mt-1">Create a project for this client to get started.</p>
            </div>
          ) : (
            client.projects.map((p) => {
              const overdue = !!(p.endDate && new Date(p.endDate) < new Date() && p.status !== 'COMPLETED');
              const ptype = (p as any).type as string | undefined;
              return (
                <div
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="group rounded-2xl border border-border bg-white p-5 hover:shadow-sm hover:border-gray-300 cursor-pointer transition-all"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-[#F3F4F6] border border-border flex items-center justify-center shrink-0">
                        <FolderKanban className="h-4 w-4 text-secondary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-primary truncate group-hover:text-black transition-colors">{p.name}</h3>
                        {ptype && <p className="text-xs text-secondary mt-0.5 capitalize">{ptype.toLowerCase().replace(/_/g, ' ')}</p>}
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium shrink-0 ${projectStatusColors[p.status] || 'bg-gray-50 text-gray-600'}`}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-secondary mb-4">
                    <span className="flex items-center gap-1.5">
                      {p.owner ? (
                        <>
                          <span className={`h-5 w-5 rounded-full text-[9px] font-semibold flex items-center justify-center ${getAvatarColor(p.owner.name)}`}>{getInitials(p.owner.name)}</span>
                          <span className="text-[#374151] font-medium">{p.owner.name}</span>
                        </>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5 text-muted" /> {p._count?.tasks ?? 0} tasks</span>
                    <span className={`flex items-center gap-1.5 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                      <Calendar className="h-3.5 w-3.5 text-muted" /> {p.endDate ? formatDate(p.endDate) : 'No due date'}{overdue ? ' · Overdue' : ''}
                    </span>
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-secondary uppercase tracking-wide">Progress</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">{p.progress}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#F3F4F6] overflow-hidden">
                      <div className={`h-full rounded-full ${p.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${p.progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-3">
          {client.activities.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2">
 <div className={`h-7 w-7 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(a.user.name)}`}>{getInitials(a.user.name)}</div>
              <div>
                <p className="text-sm text-[#374151]"><span className="font-medium">{a.user.name}</span> {a.message}</p>
                <p className="text-xs text-muted">{formatRelativeDate(a.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'notes' && (
        <div>
          <div className="flex gap-3 mb-6">
            <input value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Add a note..." className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
            <button onClick={addNote} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">Add Note</button>
          </div>
          <div className="space-y-3">
            {client.notes.map((n) => (
              <div key={n.id} className="rounded-2xl border border-border bg-white p-4">
                <p className="text-sm text-[#374151]">{n.content}</p>
                <p className="text-xs text-muted mt-2">{n.author.name} · {formatRelativeDate(n.createdAt)}</p>
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
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-primary">Edit Client</h2>
                <button onClick={() => setShowEdit(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                  <X className="h-4 w-4 text-secondary" />
                </button>
              </div>
              <form onSubmit={handleEdit} className="relative p-6 space-y-4">
                {editError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{editError}</div>}
                <Field label="Company Name *" value={editForm.company || editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v, company: v })} required />
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
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Billing Address</label>
                  <textarea value={editForm.billingAddress} onChange={(e) => setEditForm({ ...editForm, billingAddress: e.target.value })} rows={2} placeholder="Used to auto-fill quotations" className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary resize-none" />
                </div>
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
                      ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))
                    ]}
                  />
                </div>



                <div className="space-y-3 pt-2 pb-2 border-y border-[#F3F4F6]">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-[#374151]">Contacts</label>
                    {editForm.contacts.length < 5 && (
                      <button type="button" onClick={() => setEditForm({ ...editForm, contacts: [...editForm.contacts, { id: '', name: '', designation: '', email: '', phone: '' }] })} className="text-xs font-medium text-primary flex items-center gap-1 hover:bg-[#F3F4F6] px-2 py-1 rounded transition-colors">
                        <Plus className="h-3 w-3" /> Add Contact
                      </button>
                    )}
                  </div>
                  {editForm.contacts.map((contact, i) => (
                    <div key={i} className="p-4 border border-border rounded-xl bg-surface relative">
                      {editForm.contacts.length > 1 && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, contacts: editForm.contacts.filter((_, idx) => idx !== i) })} className="absolute top-2 right-2 p-1.5 text-muted hover:text-red-500 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-red-100 shadow-sm hover:shadow">
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
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">
                    {activeModule === 'PM' ? 'Lifecycle Stage' : 'Status'}
                  </label>
                  {activeModule === 'PM' ? (
                    <div className="w-full rounded-xl border border-border bg-gray-50 px-4 py-2.5 text-sm text-muted cursor-not-allowed select-none">
                      {editForm.status === 'PROSPECT' ? 'Prospect' :
                       editForm.status === 'ACTIVE' ? 'Active' :
                       editForm.status === 'ONHOLD' ? 'On Hold' :
                       editForm.status === 'PROJECT_COMPLETED' ? 'Completed' :
                       editForm.status === 'CHURNED' ? 'Churned' : editForm.status}
                      <span className="ml-2 text-xs text-amber-500 font-medium">(Managed via CRM)</span>
                    </div>
                  ) : (
                    <Select
                      value={editForm.status}
                      onChange={(val) => setEditForm({ ...editForm, status: val })}
                      options={[
                        { label: 'Prospect', value: 'PROSPECT' },
                        { label: 'Active', value: 'ACTIVE' },
                        { label: 'On Hold', value: 'ONHOLD' },
                        { label: 'Churned', value: 'CHURNED' },
                        { label: 'Project Completed', value: 'PROJECT_COMPLETED' },
                      ]}
                    />
                  )}
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowEdit(false)} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-60 bg-black/20 backdrop-blur-sm" onClick={() => setViewModalContent(null)} />
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="fixed right-0 top-0 bottom-0 z-60 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6] shrink-0">
                <h2 className="text-lg font-semibold text-primary">{viewModalContent.title}</h2>
                <button onClick={() => setViewModalContent(null)} className="p-2 rounded-xl hover:bg-[#F3F4F6]"><X className="h-4 w-4 text-secondary" /></button>
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

      <AnimatePresence>
        {showCreateProject && client && (
          <CreateProjectModal
            clientId={client.id}
            clientName={getClientDisplayName(client)}
            onClose={() => setShowCreateProject(false)}
            onSuccess={() => {
              setShowCreateProject(false);
              setTab('projects');
              api.get<ClientDetail>(`/clients/${id}`).then(setClient).catch(() => toast.error('Project created — reload to see it in the list.'));
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted" />
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="text-sm text-[#374151]">{value}</p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#374151] mb-1.5">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
      />
    </div>
  );
}
