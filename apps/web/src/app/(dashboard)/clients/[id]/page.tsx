'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, getInitials, formatRelativeDate, getAvatarColor } from '@/lib/utils';
import { ArrowLeft, Mail, Phone, MapPin, Building2, DollarSign } from 'lucide-react';

interface ClientDetail {
  id: string; name: string; company?: string | null; industry?: string | null; contactPerson?: string | null;
  email?: string | null; phone?: string | null; address?: string | null; contractValue?: number | null;
  startDate?: string | null; status: string; createdAt: string;
  projects: { id: string; name: string; status: string; progress: number; endDate?: string | null; owner?: { id: string; name: string; avatar?: string | null }; _count?: { tasks: number } }[];
  notes: { id: string; content: string; type: string; createdAt: string; author: { name: string } }[];
  activities: { id: string; type: string; message: string; createdAt: string; user: { name: string } }[];
}

type Tab = 'overview' | 'projects' | 'activity' | 'notes';

const statusColors: Record<string, string> = {
  LEAD: 'bg-blue-50 text-blue-700', ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-700', COMPLETED: 'bg-gray-100 text-gray-600',
};

export default function ClientDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [noteContent, setNoteContent] = useState('');

  useEffect(() => {
    api.get<ClientDetail>(`/clients/${id}`).then(setClient).catch(() => router.push('/clients'));
  }, [id, router]);

  async function addNote() {
    if (!noteContent.trim()) return;
    await api.post(`/clients/${id}/notes`, { content: noteContent, type: 'INTERNAL' });
    setNoteContent('');
    const updated = await api.get<ClientDetail>(`/clients/${id}`);
    setClient(updated);
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
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-white text-xl font-bold shadow-inner ${getAvatarColor(client.name)}`}>
            {getInitials(client.name)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#111827]">{client.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              {client.company && <span className="text-sm text-[#6B7280]">{client.company}</span>}
              <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[client.status]}`}>{client.status}</span>
            </div>
          </div>
        </div>
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
            <h3 className="text-sm font-semibold text-[#111827]">Contact Information</h3>
            {client.contactPerson && <InfoRow icon={Building2} label="Contact" value={client.contactPerson} />}
            {client.email && <InfoRow icon={Mail} label="Email" value={client.email} />}
            {client.phone && <InfoRow icon={Phone} label="Phone" value={client.phone} />}
            {client.address && <InfoRow icon={MapPin} label="Address" value={client.address} />}
            {client.industry && <InfoRow icon={Building2} label="Industry" value={client.industry} />}
            {client.startDate && <InfoRow icon={DollarSign} label="Start Date" value={formatDate(client.startDate)} />}
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
              <div className={`h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(a.user.name)}`}>{getInitials(a.user.name)}</div>
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
