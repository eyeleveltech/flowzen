'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/stores';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDate, formatCurrency, getInitials, getAvatarColor } from '@/lib/utils';
import {
  Plus, Search, Filter, Users, Building2, Mail, Phone, X, ChevronRight,
} from 'lucide-react';
import { Select } from '@/components/ui/select';

interface Client {
  id: string;
  name: string;
  company?: string | null;
  industry?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  contractValue?: number | null;
  status: string;
  createdAt: string;
  _count?: { projects: number };
}

const statusColors: Record<string, string> = {
  LEAD: 'bg-blue-50 text-blue-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAUSED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  ARCHIVED: 'bg-gray-50 text-gray-400',
};

export default function ClientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
  const [loading, setLoading] = useState(true);

  // Form state
  const [form, setForm] = useState({
    name: '', company: '', industry: '', contactPerson: '',
    email: '', phone: '', address: '', contractValue: '',
    status: 'LEAD',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }
    fetchClients();
    const socket = getSocket();
    if (socket) {
      socket.on('client:created', fetchClients);
      socket.on('client:updated', fetchClients);
      socket.on('client:deleted', fetchClients);
      return () => {
        socket.off('client:created');
        socket.off('client:updated');
        socket.off('client:deleted');
      };
    }
  }, [search, statusFilter]);

  async function fetchClients() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const data = await api.get<{ clients: Client[]; total: number }>(`/clients?${params}`);
      setClients(data.clients);
      setTotal(data.total);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/clients', {
        ...form,
        contractValue: form.contractValue ? parseFloat(form.contractValue) : undefined,
      });
      setShowCreate(false);
      setForm({ name: '', company: '', industry: '', contactPerson: '', email: '', phone: '', address: '', contractValue: '', status: 'LEAD' });
      fetchClients();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Clients</h1>
          <p className="text-sm text-[#6B7280] mt-1">{total} total clients</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all"
        >
          <Plus className="h-4 w-4" /> Add Client
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          options={[
            { label: 'All Status', value: '' },
            { label: 'Lead', value: 'LEAD' },
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Paused', value: 'PAUSED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Archived', value: 'ARCHIVED' },
          ]}
          className="w-40"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#F3F4F6]">
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Client</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Industry</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Contact</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Projects</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Status</th>
              <th className="px-6 py-3.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-6 py-4"><div className="h-4 w-24 rounded skeleton" /></td>
                  ))}
                </tr>
              ))
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-[#9CA3AF]">
                  No clients found. Add your first client to get started.
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <motion.tr
                  key={client.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hover:bg-[#FAFAFA] cursor-pointer transition-colors"
                  onClick={() => router.push(`/clients/${client.id}`)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(client.name)}`}>
                        {getInitials(client.name)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#111827]">{client.name}</p>
                        {client.company && <p className="text-xs text-[#9CA3AF]">{client.company}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6B7280]">{client.industry || '—'}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-[#374151]">{client.contactPerson || '—'}</p>
                    {client.email && <p className="text-xs text-[#9CA3AF]">{client.email}</p>}
                  </td>

                  <td className="px-6 py-4 text-sm text-[#6B7280] tabular-nums">{client._count?.projects ?? 0}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[client.status] || 'bg-gray-50 text-gray-500'}`}>
                      {client.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <ChevronRight className="h-4 w-4 text-[#D1D5DB]" />
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
                <h2 className="text-lg font-semibold text-[#111827]">Add Client</h2>
                <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                  <X className="h-4 w-4 text-[#6B7280]" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="relative p-6 space-y-4">
                {formError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                <Field label="Client Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
                <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
                <Field label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
                <Field label="Contact Person" value={form.contactPerson} onChange={(v) => setForm({ ...form, contactPerson: v })} />
                <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />

                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                  <Select
                    value={form.status}
                    onChange={(val) => setForm({ ...form, status: val })}
                    options={[
                      { label: 'Lead', value: 'LEAD' },
                      { label: 'Active', value: 'ACTIVE' },
                      { label: 'Paused', value: 'PAUSED' },
                    ]}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all">
                    {submitting ? 'Creating...' : 'Create Client'}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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
