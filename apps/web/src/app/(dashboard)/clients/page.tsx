'use client';

import { useState, useEffect, useId, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuthStore, useModuleStore } from '@/stores';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, formatCurrency, getInitials, getAvatarColor, getClientDisplayName } from '@/lib/utils';
import {
  Plus, Search, Filter, Users, Building2, Mail, Phone, X, ChevronRight, FolderKanban, Download, Upload, FileText, List, LayoutGrid, Columns, Check, Settings
} from 'lucide-react';
import { ClientTimelineView } from '@/components/clients/client-timeline-view';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useMembers } from '@/hooks/useQueries';
import { ViewSettingsPanel } from '@/components/ui/view-settings-panel';
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

// A standardized industry list so values don't drift ("Other" vs "Sports/Events").
const PAGE_SIZE = 20;

const INDUSTRY_OPTIONS = [
  'Sports', 'Events', 'Healthcare', 'Real Estate', 'Education', 'Technology',
  'Retail', 'Hospitality', 'Finance', 'Manufacturing', 'Media & Entertainment',
  'Food & Beverage', 'Automotive', 'Non-Profit', 'Professional Services', 'Other',
];

const statusColors: Record<string, string> = {
  PROSPECT: 'bg-blue-50 text-blue-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  ONHOLD: 'bg-amber-50 text-amber-700',
  CHURNED: 'bg-gray-50 text-gray-400',
  PROJECT_COMPLETED: 'bg-slate-100 text-slate-500',
};

function ClientsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { activeModule } = useModuleStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); // grows when "Load more" is clicked
  const [search, setSearch] = useState('');
  const urlStatus = searchParams.get('status');
  const [statusFilter, setStatusFilter] = useState<string[]>(urlStatus ? [urlStatus] : []);

  const [currentView, setCurrentView] = useState<'table' | 'timeline'>('table');
  const ALL_COLUMNS = [
    { id: 'client', label: 'Client' },
    { id: 'industry', label: 'Industry' },
    { id: 'contact', label: 'Contact' },
    { id: 'projects', label: 'Projects' },
    { id: 'status', label: activeModule === 'PM' ? 'Lifecycle Stage' : 'Status' }
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [viewName, setViewName] = useState('All Companies');

  const LOCAL_STORAGE_KEY = 'flowzen_view_clients';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.name) setViewName(parsed.name);
          if (parsed.visibleColumns) setVisibleColumns(parsed.visibleColumns);
          if (parsed.viewType) setCurrentView(parsed.viewType);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (urlStatus) setStatusFilter([urlStatus]);
  }, [urlStatus]);
  const [accountManagerFilter, setAccountManagerFilter] = useState<string[]>([]);
  const [engagementTypeFilter, setEngagementTypeFilter] = useState<string[]>([]);
  const [industryFilter, setIndustryFilter] = useState<string[]>([]);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Restore the filters saved last time (so they survive opening a client and
  // coming back). Runs once on mount; a status passed via the URL wins.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('flowzen:clients:filters');
      if (raw) {
        const f = JSON.parse(raw);
        if (f.search) setSearch(f.search);
        if (!urlStatus && f.statusFilter?.length) setStatusFilter(f.statusFilter);
        if (f.accountManagerFilter?.length) setAccountManagerFilter(f.accountManagerFilter);
        if (f.engagementTypeFilter?.length) setEngagementTypeFilter(f.engagementTypeFilter);
        if (f.industryFilter?.length) setIndustryFilter(f.industryFilter);
        if (f.currentView && f.currentView !== 'gantt') setCurrentView(f.currentView);
        if (f.visibleColumns) setVisibleColumns(f.visibleColumns);
      }
    } catch { /* ignore */ }
    setFiltersHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the filters whenever they change (after the initial restore).
  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      sessionStorage.setItem('flowzen:clients:filters', JSON.stringify({ search, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter, currentView, visibleColumns }));
    } catch { /* ignore */ }
  }, [filtersHydrated, search, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter, currentView, visibleColumns]);

  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
  const [loading, setLoading] = useState(true);
  const [orgProfile, setOrgProfile] = useState<any>(null);

  const { data: members = [] } = useMembers();

  // Form state
  const [form, setForm] = useState({
    name: '', company: '', industry: '', address: '', startDate: '',
    engagementType: '', website: '', city: '', state: '', billingAddress: '', gstNumber: '', scope: '', assetLinks: '', accountManagerId: '',
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
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }
    if (!filtersHydrated) return; // wait until saved filters are restored
    fetchClients();
    api.get('/settings/organization').then(setOrgProfile).catch(() => {});
    const sse = getSSE();
    if (sse) {
      sse.on('client:created', fetchClients);
      sse.on('client:updated', fetchClients);
      sse.on('client:deleted', fetchClients);
      return () => {
        sse.off('client:created', fetchClients);
        sse.off('client:updated', fetchClients);
        sse.off('client:deleted', fetchClients);
      };
    }
  }, [filtersHydrated, search, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter, page]);

  // Any filter change resets back to the first page.
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter]);

  async function fetchClients() {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (accountManagerFilter.length) params.set('accountManagerId', accountManagerFilter.join(','));
      if (engagementTypeFilter.length) params.set('engagementType', engagementTypeFilter.join(','));
      if (industryFilter.length) params.set('industry', industryFilter.join(','));
      // Fetch a growing window (page 1 .. current page) so "Load more" stays consistent with SSE refetches.
      params.set('limit', String(page * PAGE_SIZE));
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
    // Require at least one contact phone number before hitting the server.
    if (!form.contacts.some((c) => c.phone && c.phone.trim())) {
      setFormError('A contact phone number is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/clients', {
        ...form,
        startDate: form.startDate || undefined,
        contacts: form.contacts.filter(c => c.name.trim() !== ''),
      });
      toast.success('Client created successfully');
      setShowCreate(false);
      setForm({ name: '', company: '', industry: '', address: '', startDate: '', engagementType: '', website: '', city: '', state: '', billingAddress: '', gstNumber: '', scope: '', assetLinks: '', accountManagerId: '', status: 'PROSPECT', contacts: [{ name: '', designation: '', email: '', phone: '' }] });
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

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function processFile(file: File) {
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2">
            Clients
            <span className="text-xs font-normal text-secondary bg-[#F3F4F6] px-2 py-0.5 rounded-lg border border-border">
              {viewName}
            </span>
          </h1>
          <p className="text-sm text-secondary mt-1">{total} total clients</p>
        </div>
      </div>

      {/* Redesigned Clean Clients Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-4 w-full mb-6">
        {/* Row 1: Search + Active Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 w-full">
          {/* Search Box */}
          <div className="relative w-full sm:w-64 md:w-80 shrink-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full h-9 rounded-xl border border-border bg-white pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-[#9CA3AF]"
            />
          </div>

          {/* Filter Pills */}
          <div className="shrink-0">
            <MultiSelect
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Status"
              showSelectAll={true}
              triggerClassName={statusFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={[
                { label: 'Prospect', value: 'PROSPECT' },
                { label: 'Active', value: 'ACTIVE' },
                { label: 'On Hold', value: 'ONHOLD' },
                { label: 'Churned', value: 'CHURNED' },
                { label: 'Completed', value: 'PROJECT_COMPLETED' },
              ]}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              value={engagementTypeFilter}
              onChange={setEngagementTypeFilter}
              placeholder="Engagements"
              showSelectAll={true}
              triggerClassName={engagementTypeFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={[
                { label: 'Retainer', value: 'Retainer' },
                { label: 'Project', value: 'Project' },
                { label: 'Event', value: 'Event' },
                { label: 'Ad-hoc', value: 'Ad-hoc' }
              ]}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              value={accountManagerFilter}
              onChange={setAccountManagerFilter}
              placeholder="Account Manager"
              showSelectAll={true}
              triggerClassName={accountManagerFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
            />
          </div>

          <div className="shrink-0">
            <MultiSelect
              value={industryFilter}
              onChange={setIndustryFilter}
              placeholder="Industries"
              showSelectAll={true}
              triggerClassName={industryFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-dashed border-gray-300 text-secondary px-3 text-xs"}
              options={INDUSTRY_OPTIONS.map((i) => ({ label: i, value: i }))}
            />
          </div>

          {/* Action buttons on the right corner */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setShowViewSettings(true)}
              className="p-2 rounded-xl border border-border bg-white hover:bg-gray-50 transition-colors text-secondary hover:text-primary h-9 w-9 flex items-center justify-center shrink-0"
              title="Configure View Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            {activeModule !== 'PM' && (
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] transition-all disabled:opacity-50 h-9 shrink-0 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            )}

            {activeModule !== 'PM' && (
              <button
                onClick={() => {
                  setShowCreate(true);
                  setCreationMode('MANUAL');
                }}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-white hover:bg-[#1F2937] transition-all h-9 shrink-0 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" /> Add Client
              </button>
            )}
          </div>
        </div>

        {/* Separator line */}
        <div className="h-px bg-border/60 w-full" />

        {/* Row 2: Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          {/* Left Side: Count summary */}
          <div className="text-xs font-medium text-secondary">
            Showing {clients.length} of {total} clients
          </div>

          {/* Right Side: View Toggles & Clear Filters */}
          <div className="flex items-center justify-end gap-2.5 ml-auto sm:ml-0">
            {(!!search || statusFilter.length > 0 || industryFilter.length > 0 || engagementTypeFilter.length > 0 || accountManagerFilter.length > 0) && (
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter([]);
                  setIndustryFilter([]);
                  setEngagementTypeFilter([]);
                  setAccountManagerFilter([]);
                  router.replace('/clients', { scroll: false });
                }}
                className="flex items-center gap-1.5 h-9 rounded-xl bg-red-50 px-3 text-xs font-semibold text-red-600 hover:bg-red-100 transition-colors border border-red-100 whitespace-nowrap"
              >
                <X className="h-3.5 w-3.5" /> Clear Filters
              </button>
            )}

            {/* Segmented View Switcher */}
            <div className="flex bg-[#F3F4F6] p-1 rounded-xl gap-0.5 border border-border/50 shrink-0 h-9 items-center overflow-x-auto no-scrollbar max-w-full">
              <button 
                type="button"
                onClick={() => {
                  setCurrentView('table');
                  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ name: viewName, visibleColumns, viewType: 'table' }));
                }} 
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${currentView === 'table' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="Table View"
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span>Table</span>
              </button>
              <button 
                type="button"
                onClick={() => {
                  setCurrentView('timeline');
                  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ name: viewName, visibleColumns, viewType: 'timeline' }));
                }} 
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${currentView === 'timeline' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="Timeline View"
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span>Timeline</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Table View */}
      {currentView === 'table' && (
      <div className="hidden md:block rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
            <tr className="border-b border-[#F3F4F6]">
              {visibleColumns.includes('client') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Client</th>}
              {visibleColumns.includes('industry') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Industry</th>}
              {visibleColumns.includes('contact') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Contact</th>}
              {visibleColumns.includes('projects') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Projects</th>}
              {visibleColumns.includes('status') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">{activeModule === 'PM' ? 'Lifecycle Stage' : 'Status'}</th>}
              <th className="px-6 py-3.5 w-10 text-center relative select-none">
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowColumnDropdown(!showColumnDropdown); }}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-[#9CA3AF] hover:bg-gray-100 hover:text-primary transition-all text-sm font-bold border border-transparent hover:border-gray-200"
                  title="Toggle visible columns"
                >
                  +
                </button>
                <AnimatePresence>
                  {showColumnDropdown && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowColumnDropdown(false)} />
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-white border border-border rounded-xl shadow-lg z-50 overflow-hidden py-1"
                      >
                        <div className="px-3 py-2 border-b border-[#F3F4F6] text-[10px] font-semibold text-secondary uppercase tracking-wider text-left">
                          Visible Columns
                        </div>
                        {ALL_COLUMNS.map(col => (
                          <button
                            key={col.id}
                            onClick={() => {
                              setVisibleColumns(prev => 
                                prev.includes(col.id) 
                                  ? prev.filter(c => c !== col.id)
                                  : [...prev, col.id]
                              )
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[#F9FAFB] transition-colors"
                          >
                            <span className="text-[#374151]">{col.label}</span>
                            {visibleColumns.includes(col.id) && <Check className="w-4 h-4 text-primary" />}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </th>
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
                  className="hover:bg-surface cursor-pointer transition-colors"
                  onClick={() => router.push(`/clients/${client.id}`)}
                >
                  {visibleColumns.includes('client') && (
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                          {getInitials(getClientDisplayName(client))}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-primary">
                            {getClientDisplayName(client)}
                          </p>
                          {client.name !== 'Internal' && client.company && (client.contacts?.[0]?.name || client.name !== client.company) && (
                            <p className="text-xs text-[#9CA3AF]">{client.contacts?.[0]?.name || client.name}</p>
                          )}
                          {client.name === 'Internal' && <p className="text-xs font-medium text-[#9CA3AF]">(Internal)</p>}
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleColumns.includes('industry') && (
                    <td className="px-6 py-4 text-sm text-secondary">
                      {client.name === 'Internal' && orgProfile?.industry ? orgProfile.industry : client.industry || '—'}
                    </td>
                  )}
                  {visibleColumns.includes('contact') && (
                    <td className="px-6 py-4">
                      {client.name === 'Internal' ? (
                        <div>
                          <p className="text-sm text-[#374151] font-medium">Internal Contact</p>
                          {orgProfile?.phone && <p className="text-[11px] text-secondary">{orgProfile.phone}</p>}
                        </div>
                      ) : client.contacts && client.contacts.length > 0 ? (
                        <div>
                          <p className="text-sm text-[#374151] font-medium">{client.contacts[0].name}</p>
                          {client.contacts[0].designation && <p className="text-[11px] text-secondary">{client.contacts[0].designation}</p>}
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
                  )}

                  {visibleColumns.includes('projects') && (
                    <td className="px-6 py-4 text-sm text-secondary tabular-nums">{client._count?.projects ?? 0}</td>
                  )}
                  {visibleColumns.includes('status') && (
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${statusColors[client.status] || 'bg-gray-50 text-gray-500'}`}>
                        {client.status.replace('_', ' ')}
                      </span>
                    </td>
                  )}
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
      )}

      {currentView === 'timeline' && <ClientTimelineView clients={clients} loading={loading} />}

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-3 pb-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-white">
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
          <div className="p-8 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-border">
            No clients found.
          </div>
        ) : (
          clients.map((client) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => router.push(`/clients/${client.id}`)}
              className="p-4 rounded-xl border border-border bg-white hover:shadow-sm cursor-pointer transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                    {getInitials(getClientDisplayName(client))}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary leading-tight">
                      {getClientDisplayName(client)}
                    </p>
                    {client.name === 'Internal' ? (
                      <p className="text-xs font-medium text-secondary mt-0.5">(Internal)</p>
                    ) : client.company && client.name !== client.company ? (
                      <p className="text-xs text-secondary mt-0.5">{client.name}</p>
                    ) : (
                      <p className="text-xs text-secondary mt-0.5">{client.industry || '—'}</p>
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
                        <p className="text-[10px] text-secondary">+{client.contacts.length - 1} more</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[11px] text-[#9CA3AF]">No contacts</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-secondary bg-[#F3F4F6] px-2 py-1 rounded-md">
                  <FolderKanban className="h-3 w-3" />
                  {client._count?.projects ?? 0}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Load more */}
      {!loading && clients.length < total && (
        <div className="flex flex-col items-center gap-2 mt-6">
          <p className="text-xs text-secondary">Showing {clients.length} of {total}</p>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all"
          >
            Load more
          </button>
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl shadow-black/10 overflow-y-auto"
            >
              <div className="flex flex-col border-b border-[#F3F4F6]">
                <div className="flex items-center justify-between px-6 py-4">
                  <h2 className="text-lg font-semibold text-primary">Add Client</h2>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
                    <X className="h-4 w-4 text-secondary" />
                  </button>
                </div>
                <div className="flex gap-4 px-6">
                  <button
                    onClick={() => setCreationMode('MANUAL')}
                    className={`pb-2 text-sm font-medium border-b-2 transition-colors ${creationMode === 'MANUAL' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
                  >
                    Manual Entry
                  </button>
                  <button
                    onClick={() => setCreationMode('BULK')}
                    className={`pb-2 text-sm font-medium border-b-2 transition-colors ${creationMode === 'BULK' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-[#374151]'}`}
                  >
                    Bulk Import
                  </button>
                </div>
              </div>

              {creationMode === 'MANUAL' ? (
                <form onSubmit={handleCreate} className="relative p-6 space-y-4">
                  {formError && <div className="absolute top-0 left-6 right-6 -mt-2 z-10 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm border border-red-100">{formError}</div>}
                  <Field label="Company Name *" value={form.company} onChange={(v) => setForm({ ...form, name: v, company: v })} required />
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Industry</label>
                    <Select
                      value={form.industry}
                      onChange={(v) => setForm({ ...form, industry: v })}
                      options={[
                        { label: 'Select industry', value: '' },
                        ...INDUSTRY_OPTIONS.map((i) => ({ label: i, value: i })),
                      ]}
                    />
                  </div>

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
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Billing Address</label>
                    <textarea value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} rows={2} placeholder="Used to auto-fill quotations" className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm outline-none focus:border-primary resize-none" />
                  </div>
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
                        ...members.map((m: any) => ({ label: m.name, value: m.id, sublabel: (m as any).designation, avatar: getInitials(m.name) }))
                      ]}
                    />
                  </div>


                  <div className="space-y-3 pt-2 pb-2 border-y border-[#F3F4F6]">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-[#374151]">Contacts</label>
                      {form.contacts.length < 5 && (
                        <button type="button" onClick={() => setForm({ ...form, contacts: [...form.contacts, { name: '', designation: '', email: '', phone: '' }] })} className="text-xs font-medium text-primary flex items-center gap-1 hover:bg-[#F3F4F6] px-2 py-1 rounded transition-colors">
                          <Plus className="h-3 w-3" /> Add Contact
                        </button>
                      )}
                    </div>
                    {form.contacts.map((contact, i) => (
                      <div key={i} className="p-4 border border-border rounded-xl bg-surface relative">
                        {form.contacts.length > 1 && (
                          <button type="button" onClick={() => setForm({ ...form, contacts: form.contacts.filter((_, idx) => idx !== i) })} className="absolute top-2 right-2 p-1.5 text-[#9CA3AF] hover:text-red-500 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-red-100 shadow-sm hover:shadow">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Name *" value={contact.name} onChange={(v) => { const c = [...form.contacts]; c[i].name = v; setForm({ ...form, contacts: c }); }} required />
                          <Field label="Designation" value={contact.designation} onChange={(v) => { const c = [...form.contacts]; c[i].designation = v; setForm({ ...form, contacts: c }); }} />
                          <Field label="Email" type="email" value={contact.email} onChange={(v) => { const c = [...form.contacts]; c[i].email = v; setForm({ ...form, contacts: c }); }} />
                          <Field label={i === 0 ? "Phone *" : "Phone"} value={contact.phone} onChange={(v) => { const c = [...form.contacts]; c[i].phone = v; setForm({ ...form, contacts: c }); }} required={i === 0} />
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
                        { label: 'Project Completed', value: 'PROJECT_COMPLETED' },
                      ]}
                    />
                  </div>
                  <div className="pt-4 flex flex-row gap-2 sm:gap-3">
                    <button type="button" onClick={() => setShowCreate(false)} className="flex-1 w-full sm:flex-1 rounded-xl border border-border px-2 sm:px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                      Cancel
                    </button>
                    <button type="submit" disabled={submitting} className="flex-1 w-full sm:flex-1 rounded-xl bg-primary px-2 sm:px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all flex items-center justify-center">
                      {submitting ? 'Creating...' : <><span className="hidden sm:inline">Create Client</span><span className="inline sm:hidden">Create</span></>}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-6 space-y-6">
                  <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-[#F9FAFB]">
                    <div>
                      <h3 className="text-sm font-semibold text-primary">Need a template?</h3>
                      <p className="text-xs text-secondary mt-1">Download our CSV template to see the required format.</p>
                    </div>
                    <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-[#374151] hover:bg-gray-50 transition-all">
                      <FileText className="h-3.5 w-3.5" /> Template
                    </button>
                  </div>

                  <div>
                    <label 
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed transition-colors rounded-xl cursor-pointer ${isDragging ? 'border-primary bg-gray-50' : 'border-[#D1D5DB] hover:border-primary hover:bg-gray-50'}`}
                    >
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
                      <p className="text-xs text-primary mt-2 font-medium flex items-center gap-1.5">
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

                  <div className="pt-4 flex flex-row gap-2 sm:gap-3">
                    <button type="button" onClick={() => { setShowCreate(false); setImportFile(null); setImportPreview([]); }} className="flex-1 w-full sm:flex-1 rounded-xl border border-border px-2 sm:px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-all">
                      Cancel
                    </button>
                    <button 
                      onClick={handleBulkImport} 
                      disabled={importing || importPreview.length === 0} 
                      className="flex-1 w-full sm:flex-1 rounded-xl bg-primary px-2 sm:px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] disabled:opacity-50 transition-all flex items-center justify-center"
                    >
                      {importing ? 'Importing...' : <><span className="hidden sm:inline">Import Clients</span><span className="inline sm:hidden">Import</span></>}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <ViewSettingsPanel
        isOpen={showViewSettings}
        onClose={() => setShowViewSettings(false)}
        viewName={viewName}
        onViewNameChange={setViewName}
        viewType={currentView === 'table' ? 'list' : 'board'}
        onViewTypeChange={(type) => setCurrentView(type === 'list' ? 'table' : 'timeline')}
        columns={ALL_COLUMNS}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        onSave={() => {
          if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
              name: viewName,
              visibleColumns,
              viewType: currentView
            }));
          }
          toast.success('View Settings saved successfully!');
          setShowViewSettings(false);
        }}
        onReset={() => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          }
          setViewName('All Companies');
          setCurrentView('table');
          setVisibleColumns(ALL_COLUMNS.map(c => c.id));
          toast.success('View Settings reset to defaults');
        }}
        onClone={() => {
          const clonedName = viewName + ' (Copy)';
          setViewName(clonedName);
          if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
              name: clonedName,
              visibleColumns,
              viewType: currentView
            }));
          }
          toast.success('Cloned successfully to a new view copy!');
          setShowViewSettings(false);
        }}
      />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <ClientsContent />
    </Suspense>
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
