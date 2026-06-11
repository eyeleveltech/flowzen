'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, formatCurrency, getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import {
  Plus, Search, Filter, Users, Building2, Mail, Phone, X, ChevronRight, FolderKanban, Download, Upload, FileText
} from 'lucide-react';
import { Select } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useMembers } from '@/hooks/useQueries';
import Papa from 'papaparse';

interface ClientContact {
  id: string;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface Client {
  id: string;
  name: string;
  company?: string | null;
  industry?: string | null;
  engagementType?: string | null;
  website?: string | null;
  city?: string | null;
  scope?: string | null;
  assetLinks?: string | null;
  accountManagerId?: string | null;
  contacts?: ClientContact[];
  contractValue?: number | null;
  address?: string | null;
  startDate?: string | null;
  status: string;
  createdAt: string;
  _count?: { projects: number };
}

const statusColors: Record<string, string> = {
  PROSPECT: 'bg-blue-50 text-blue-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ONHOLD: 'bg-amber-50 text-amber-700',
  CHURNED: 'bg-gray-50 text-gray-400',
};

function ClientsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [accountManagerFilter, setAccountManagerFilter] = useState('');
  const [engagementTypeFilter, setEngagementTypeFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
  const [loading, setLoading] = useState(true);
  const [orgProfile, setOrgProfile] = useState<any>(null);

  const { data: members = [] } = useMembers();

  // Form state
  const [form, setForm] = useState({
    name: '', company: '', industry: '', address: '', startDate: '',
    engagementType: '', website: '', city: '', scope: '', assetLinks: '', accountManagerId: '',
    status: 'PROSPECT',
    contacts: [{ name: '', designation: '', email: '', phone: '' }]
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Import/Export state
  const [isExporting, setIsExporting] = useState(false);
  const [creationMode, setCreationMode] = useState<'MANUAL' | 'BULK'>('MANUAL');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }
    fetchClients();
    api.get('/settings/organization').then(setOrgProfile).catch(() => {});
    const sse = getSSE();
    if (sse) {
      sse.on('client:created', fetchClients);
      sse.on('client:updated', fetchClients);
      sse.on('client:deleted', fetchClients);
      return () => {
        sse.off('client:created');
        sse.off('client:updated');
        sse.off('client:deleted');
      };
    }
  }, [search, statusFilter, cityFilter, accountManagerFilter, engagementTypeFilter, industryFilter]);

  async function fetchClients() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (cityFilter) params.set('city', cityFilter);
      if (accountManagerFilter) params.set('accountManagerId', accountManagerFilter);
      if (engagementTypeFilter) params.set('engagementType', engagementTypeFilter);
      if (industryFilter) params.set('industry', industryFilter);
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
        startDate: form.startDate || undefined,
        contacts: form.contacts.filter(c => c.name.trim() !== ''),
      });
      toast.success('Client created successfully');
      setShowCreate(false);
      setForm({ name: '', company: '', industry: '', address: '', startDate: '', engagementType: '', website: '', city: '', scope: '', assetLinks: '', accountManagerId: '', status: 'PROSPECT', contacts: [{ name: '', designation: '', email: '', phone: '' }] });
      fetchClients();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create client');
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const data = await api.get<{ clients: Client[] }>('/clients?limit=10000');
      const csvData = data.clients.map(c => ({
        Name: c.name,
        Company: c.company || '',
        Industry: c.industry || '',
        Status: c.status,
        EngagementType: c.engagementType || '',
        ContractValue: c.contractValue || '',
        City: c.city || '',
        Address: c.address || '',
        Scope: c.scope || '',
        AssetLinks: c.assetLinks || '',
        StartDate: c.startDate ? new Date(c.startDate).toISOString().split('T')[0] : '',
        AccountManagerId: c.accountManagerId || '',
        Website: c.website || '',
        ContactName: c.contacts?.[0]?.name || '',
        ContactDesignation: c.contacts?.[0]?.designation || '',
        ContactEmail: c.contacts?.[0]?.email || '',
        ContactPhone: c.contacts?.[0]?.phone || ''
      }));
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `clients_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Export downloaded');
    } catch (err: any) {
      toast.error('Failed to export clients');
    } finally {
      setIsExporting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportPreview(results.data);
      },
      error: () => {
        toast.error('Failed to parse CSV file');
      }
    });
  }

  async function handleBulkImport() {
    if (!importPreview.length) return;
    setImporting(true);
    try {
      const payload = importPreview.map((row: any) => ({
        name: row.Name || row.name,
        company: row.Company || row.company,
        industry: row.Industry || row.industry,
        status: row.Status || row.status || 'PROSPECT',
        engagementType: row.EngagementType || row.engagementType,
        contractValue: row.ContractValue || row.contractValue,
        city: row.City || row.city,
        address: row.Address || row.address,
        scope: row.Scope || row.scope,
        assetLinks: row.AssetLinks || row.assetLinks,
        startDate: row.StartDate || row.startDate,
        accountManagerId: row.AccountManagerId || row.accountManagerId,
        website: row.Website || row.website,
        contactName: row.ContactName || row.contactName,
        contactDesignation: row.ContactDesignation || row.contactDesignation,
        contactEmail: row.ContactEmail || row.contactEmail,
        contactPhone: row.ContactPhone || row.contactPhone
      })).filter(c => c.name); // only include rows with a name

      await api.post('/clients/bulk', { clients: payload });
      toast.success(`Imported ${payload.length} clients`);
      setShowCreate(false);
      setCreationMode('MANUAL');
      setImportFile(null);
      setImportPreview([]);
      fetchClients();
    } catch (err: any) {
      toast.error(err.message || 'Failed to import clients');
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const csv = Papa.unparse([{
      Name: 'Example Corp',
      Company: 'Example LLC',
      Industry: 'Technology',
      Status: 'PROSPECT',
      EngagementType: 'Retainer',
      ContractValue: '50000',
      City: 'New York',
      Address: '123 Business Rd, NY 10001',
      Scope: 'Full service marketing',
      AssetLinks: 'https://drive.google.com/xyz',
      StartDate: '2026-06-01',
      AccountManagerId: '',
      Website: 'https://example.com',
      ContactName: 'John Doe',
      ContactDesignation: 'CEO',
      ContactEmail: 'john@example.com',
      ContactPhone: '+1-555-0100'
    }]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'client_import_template.csv';
    link.click();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">Clients</h1>
          <p className="text-sm text-[#6B7280] mt-1">{total} total clients</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={() => {
              setShowCreate(true);
              setCreationMode('MANUAL');
            }}
            className="flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all"
          >
            <Plus className="h-4 w-4" /> Add Client
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
          />
        </div>
        <div className="w-full sm:w-auto min-w-[140px]">
          <Select
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            options={[
              { label: 'All Status', value: '' },
              { label: 'Prospect', value: 'PROSPECT' },
              { label: 'Active', value: 'ACTIVE' },
              { label: 'On Hold', value: 'ONHOLD' },
              { label: 'Churned', value: 'CHURNED' },
            ]}
          />
        </div>
        <div className="w-full sm:w-auto min-w-[140px]">
          <Select
            value={engagementTypeFilter}
            onChange={(val) => setEngagementTypeFilter(val)}
            options={[
              { label: 'All Engagements', value: '' },
              { label: 'Retainer', value: 'Retainer' },
              { label: 'Project', value: 'Project' },
              { label: 'Event', value: 'Event' },
              { label: 'Ad-hoc', value: 'Ad-hoc' }
            ]}
          />
        </div>
        <div className="w-full sm:w-auto min-w-[180px]">
          <Select
            value={accountManagerFilter}
            onChange={(val) => setAccountManagerFilter(val)}
            options={[
              { label: 'All Account Managers', value: '' },
              ...members.map((m: any) => ({ label: m.name, value: m.id }))
            ]}
          />
        </div>
        <div className="w-full sm:w-auto relative">
          <input
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            placeholder="Filter by city..."
            className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
          />
        </div>
        <div className="w-full sm:w-auto relative">
          <input
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            placeholder="Filter by industry..."
            className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
          />
        </div>
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
            <tr className="border-b border-[#F3F4F6]">
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Client</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Industry</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Contact</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Projects</th>
              <th className="px-6 py-3.5 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wide">Status</th>
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
                      <div className={`h-8 w-8 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                        {getInitials(getClientDisplayName(client))}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#111827]">
                          {getClientDisplayName(client)}
                        </p>
                        {client.name !== 'Internal' && client.company && <p className="text-xs text-[#9CA3AF]">{client.name}</p>}
                        {client.name === 'Internal' && <p className="text-xs font-medium text-[#9CA3AF]">(Internal)</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6B7280]">
                    {client.name === 'Internal' && orgProfile?.industry ? orgProfile.industry : client.industry || '—'}
                  </td>
                  <td className="px-6 py-4">
                    {client.name === 'Internal' ? (
                      <div>
                        <p className="text-sm text-[#374151] font-medium">Internal Contact</p>
                        {orgProfile?.phone && <p className="text-[11px] text-[#6B7280]">{orgProfile.phone}</p>}
                      </div>
                    ) : client.contacts && client.contacts.length > 0 ? (
                      <div>
                        <p className="text-sm text-[#374151] font-medium">{client.contacts[0].name}</p>
                        {client.contacts[0].designation && <p className="text-[11px] text-[#6B7280]">{client.contacts[0].designation}</p>}
                        {client.contacts.length > 1 && (
                          <span className="text-[10px] font-medium bg-[#F3F4F6] text-[#4B5563] px-1.5 py-0.5 rounded mt-1 inline-block">
                            +{client.contacts.length - 1} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-[#9CA3AF]">—</span>
                    )}
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
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-3 pb-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-[#E5E7EB] bg-white">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full skeleton" />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded skeleton" />
                  <div className="h-3 w-16 rounded skeleton" />
                </div>
              </div>
              <div className="h-3 w-32 rounded skeleton" />
            </div>
          ))
        ) : clients.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-[#E5E7EB]">
            No clients found.
          </div>
        ) : (
          clients.map((client) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => router.push(`/clients/${client.id}`)}
              className="p-4 rounded-xl border border-[#E5E7EB] bg-white hover:shadow-sm cursor-pointer transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                    {getInitials(getClientDisplayName(client))}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#111827] leading-tight">
                      {getClientDisplayName(client)}
                    </p>
                    {client.name === 'Internal' ? (
                      <p className="text-xs font-medium text-[#6B7280] mt-0.5">(Internal)</p>
                    ) : client.company ? (
                      <p className="text-xs text-[#6B7280] mt-0.5">{client.name}</p>
                    ) : (
                      <p className="text-xs text-[#6B7280] mt-0.5">{client.industry || '—'}</p>
                    )}
                  </div>
                </div>
                <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-medium ${statusColors[client.status] || 'bg-gray-50 text-gray-500'}`}>
                  {client.status.replace('_', ' ')}
                </span>
              </div>
              
              <div className="flex items-center justify-between mt-4">
                <div className="flex flex-col">
                  {client.contacts && client.contacts.length > 0 ? (
                    <>
                      <p className="text-[11px] font-medium text-[#374151]">{client.contacts[0].name}</p>
                      {client.contacts.length > 1 && (
                        <p className="text-[10px] text-[#6B7280]">+{client.contacts.length - 1} more</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-[#9CA3AF]">No contacts</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#6B7280] bg-[#F3F4F6] px-2 py-1 rounded-md">
                  <FolderKanban className="h-3 w-3" />
                  {client._count?.projects ?? 0}
                </div>
              </div>
            </motion.div>
          ))
        )}
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
              <div className="flex flex-col border-b border-[#F3F4F6]">
                <div className="flex items-center justify-between px-6 py-4">
                  <h2 className="text-lg font-semibold text-[#111827]">Add Client</h2>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                    <X className="h-4 w-4 text-[#6B7280]" />
                  </button>
                </div>
                <div className="flex gap-4 px-6">
                  <button
                    onClick={() => setCreationMode('MANUAL')}
                    className={`pb-2 text-sm font-medium border-b-2 transition-colors ${creationMode === 'MANUAL' ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#374151]'}`}
                  >
                    Manual Entry
                  </button>
                  <button
                    onClick={() => setCreationMode('BULK')}
                    className={`pb-2 text-sm font-medium border-b-2 transition-colors ${creationMode === 'BULK' ? 'border-[#111827] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#374151]'}`}
                  >
                    Bulk Import
                  </button>
                </div>
              </div>

              {creationMode === 'MANUAL' ? (
                <form onSubmit={handleCreate} className="relative p-6 space-y-4">
                  {formError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                  <Field label="Client Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
                  <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
                  <Field label="Industry" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} />
                  
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Engagement Type</label>
                    <Select
                      value={form.engagementType}
                      onChange={(v) => setForm({ ...form, engagementType: v })}
                      options={[
                        { label: 'Select type', value: '' },
                        { label: 'Retainer', value: 'Retainer' },
                        { label: 'Project', value: 'Project' },
                        { label: 'Event', value: 'Event' },
                        { label: 'Ad-hoc', value: 'Ad-hoc' }
                      ]}
                    />
                  </div>

                  <Field label="Website" value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
                  <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                  <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
                  <Field label="Start Date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
                  
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Scope</label>
                    <RichTextEditor
                      value={form.scope}
                      onChange={(val) => setForm({ ...form, scope: val })}
                      placeholder="Enter the scope of work..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Account Manager</label>
                    <Select
                      value={form.accountManagerId}
                      onChange={(v) => setForm({ ...form, accountManagerId: v })}
                      options={[
                        { label: 'Unassigned', value: '' },
                        ...members.map((m: any) => ({ label: m.name, value: m.id }))
                      ]}
                    />
                  </div>

                  <Field label="Asset Links" value={form.assetLinks} onChange={(v) => setForm({ ...form, assetLinks: v })} />

                  <div className="space-y-3 pt-2 pb-2 border-y border-[#F3F4F6]">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-[#374151]">Contacts</label>
                      {form.contacts.length < 5 && (
                        <button type="button" onClick={() => setForm({ ...form, contacts: [...form.contacts, { name: '', designation: '', email: '', phone: '' }] })} className="text-xs font-medium text-[#111827] flex items-center gap-1 hover:bg-[#F3F4F6] px-2 py-1 rounded transition-colors">
                          <Plus className="h-3 w-3" /> Add Contact
                        </button>
                      )}
                    </div>
                    {form.contacts.map((contact, i) => (
                      <div key={i} className="p-4 border border-[#E5E7EB] rounded-xl bg-[#FAFAFA] relative">
                        {form.contacts.length > 1 && (
                          <button type="button" onClick={() => setForm({ ...form, contacts: form.contacts.filter((_, idx) => idx !== i) })} className="absolute top-2 right-2 p-1.5 text-[#9CA3AF] hover:text-red-500 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-red-100 shadow-sm hover:shadow">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Name *" value={contact.name} onChange={(v) => { const c = [...form.contacts]; c[i].name = v; setForm({ ...form, contacts: c }); }} required />
                          <Field label="Designation" value={contact.designation} onChange={(v) => { const c = [...form.contacts]; c[i].designation = v; setForm({ ...form, contacts: c }); }} />
                          <Field label="Email" type="email" value={contact.email} onChange={(v) => { const c = [...form.contacts]; c[i].email = v; setForm({ ...form, contacts: c }); }} />
                          <Field label="Phone" value={contact.phone} onChange={(v) => { const c = [...form.contacts]; c[i].phone = v; setForm({ ...form, contacts: c }); }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Status</label>
                    <Select
                      value={form.status}
                      onChange={(val) => setForm({ ...form, status: val })}
                      options={[
                        { label: 'Prospect', value: 'PROSPECT' },
                        { label: 'Active', value: 'ACTIVE' },
                        { label: 'On Hold', value: 'ONHOLD' },
                        { label: 'Churned', value: 'CHURNED' },
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
              ) : (
                <div className="p-6 space-y-6">
                  <div className="flex items-center justify-between p-4 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
                    <div>
                      <h3 className="text-sm font-semibold text-[#111827]">Need a template?</h3>
                      <p className="text-xs text-[#6B7280] mt-1">Download our CSV template to see the required format.</p>
                    </div>
                    <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-gray-50 transition-all">
                      <FileText className="h-3.5 w-3.5" /> Template
                    </button>
                  </div>

                  <div>
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[#D1D5DB] hover:border-[#111827] hover:bg-gray-50 transition-colors rounded-xl cursor-pointer">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-8 h-8 mb-3 text-[#9CA3AF]" />
                        <p className="mb-2 text-sm text-[#4B5563]">
                          <span className="font-semibold">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-[#9CA3AF]">CSV files only</p>
                      </div>
                      <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                    </label>
                    {importFile && (
                      <p className="text-xs text-[#111827] mt-2 font-medium flex items-center gap-1.5">
                        <FileText className="h-3 w-3 text-[#10B981]" /> {importFile.name}
                      </p>
                    )}
                  </div>

                  {importPreview.length > 0 && (
                    <div className="p-4 rounded-xl border border-blue-100 bg-blue-50">
                      <h4 className="text-sm font-semibold text-blue-900 mb-1">Ready to Import</h4>
                      <p className="text-xs text-blue-700">Found {importPreview.filter(r => r.Name || r.name).length} valid clients in the CSV file.</p>
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => { setShowCreate(false); setImportFile(null); setImportPreview([]); }} className="flex-1 rounded-xl border border-[#E5E7EB] px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                      Cancel
                    </button>
                    <button 
                      onClick={handleBulkImport} 
                      disabled={importing || importPreview.length === 0} 
                      className="flex-1 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all"
                    >
                      {importing ? 'Importing...' : 'Import Clients'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#111827] border-t-transparent" />
      </div>
    }>
      <ClientsContent />
    </Suspense>
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
