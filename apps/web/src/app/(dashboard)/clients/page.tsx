'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAuthStore, useModuleStore } from '@/stores';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatDate, formatCurrency, getInitials, getAvatarColor, getClientDisplayName, toDateInput } from '@/lib/utils';
import {
  Plus, Search, Filter, Users, Building2, Mail, Phone, X, ChevronRight, FolderKanban, Download, Upload, FileText, List, LayoutGrid, Columns, Check, Settings, Briefcase, SlidersHorizontal
} from 'lucide-react';
import { ClientTimelineView } from '@/components/clients/client-timeline-view';
import { MultiSelect } from '@/components/ui/multi-select';
import { Drawer } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { ActiveFilterChip } from '@/components/ui/active-filter-chip';
import { useMembers } from '@/hooks/useQueries';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { ViewSettingsPanel } from '@/components/ui/view-settings-panel';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { StatusBadge } from '@/components/ui/status-badge';
import { Icon } from '@/components/ui/icon';

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
  archivedAt?: string | null;
  _count?: { projects: number };
}

// A standardized industry list so values don't drift ("Other" vs "Sports/Events").
const PAGE_SIZE = 20;

const INDUSTRY_OPTIONS = [
  'Sports', 'Events', 'Healthcare', 'Real Estate', 'Education', 'Technology',
  'Retail', 'Hospitality', 'Finance', 'Manufacturing', 'Media & Entertainment',
  'Food & Beverage', 'Automotive', 'Non-Profit', 'Professional Services', 'Other',
];

import { usePageTitle } from '@/hooks/usePageTitle';

function ClientsContent() {
  usePageTitle('Clients');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { activeModule } = useModuleStore();
  // Client master data is CRM-owned: only SUPER_ADMIN / ADMIN may create clients. PM roles get
  // a read-only list (still usable to pick a client for a project).
  const canManageClients = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
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
    { id: 'status', label: 'Lifecycle Stage' }
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(ALL_COLUMNS.map(c => c.id));
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [viewName, setViewName] = useState('All clients');

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
  const [showArchived, setShowArchived] = useState(false);
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [orgProfile, setOrgProfile] = useState<any>(null);

  const { data: members = [] } = useMembers();

  // Import/Export state — clients are pipeline-driven (a won deal) or bulk-imported (onboarding
  // pre-existing customers). There is no manual "add one client" form; see clients.ts POST /.
  const [isExporting, setIsExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; rejectedCount: number; rejected: any[] } | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    if (user && user.role === 'TEAM_MEMBER') {
      router.push('/dashboard');
      return;
    }
    if (!filtersHydrated) return; // wait until saved filters are restored
    fetchClients();
    api.get('/settings/organization').then(setOrgProfile).catch(() => { });
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
  }, [filtersHydrated, debouncedSearch, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter, showArchived, page]);

  // Any filter change resets back to the first page.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, accountManagerFilter, engagementTypeFilter, industryFilter, showArchived]);

  async function fetchClients() {
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter.length) params.set('status', statusFilter.join(','));
      if (accountManagerFilter.length) params.set('accountManagerId', accountManagerFilter.join(','));
      if (engagementTypeFilter.length) params.set('engagementType', engagementTypeFilter.join(','));
      if (industryFilter.length) params.set('industry', industryFilter.join(','));
      if (showArchived) params.set('includeArchived', 'true');
      // Fetch a growing window (page 1 .. current page) so "Load more" stays consistent with SSE refetches.
      params.set('limit', String(page * PAGE_SIZE));
      const data = await api.get<{ clients: Client[]; total: number }>(`/clients?${params}`);
      setClients(data.clients);
      setTotal(data.total);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const data = await api.get<{ clients: Client[] }>('/clients?limit=10000');
      const csvData = data.clients.map(c => ({
        ContactName: c.contacts?.[0]?.name || '',
        Company: c.company || '',
        Industry: c.industry || '',
        Status: c.status,
        EngagementType: c.engagementType || '',
        ContractValue: c.contractValue || '',
        City: c.city || '',
        Address: c.address || '',
        Scope: c.scope || '',
        AssetLinks: c.assetLinks || '',
        StartDate: toDateInput(c.startDate),
        AccountManagerId: c.accountManagerId || '',
        Website: c.website || '',
        ContactDesignation: c.contacts?.[0]?.designation || '',
        ContactEmail: c.contacts?.[0]?.email || '',
        ContactPhone: c.contacts?.[0]?.phone || ''
      }));
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `clients_export_${toDateInput(new Date())}.csv`);
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
    setImportResult(null);
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          // cellDates + raw:false: without them a real Excel date cell arrives as a serial
          // number (45778), which Date() reads as milliseconds and stores as 1970 — silently,
          // since a number is a "valid" date to the server. Formatted strings round-trip instead.
          const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          setImportPreview(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) as any[]);
        } catch { toast.error('Failed to parse Excel file'); }
      };
      reader.onerror = () => toast.error('Failed to read file');
      reader.readAsArrayBuffer(file);
    } else {
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
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  // The account name resolves Company before ContactName, matching how a won deal names the
  // account (clientConversion.service.ts: `lead.companyName || lead.contactName`). Importing
  // and winning the same customer must produce the same account name, or the dedup in
  // findMatchingClient can't recognise them as one company.
  // `||`, not `??`: a template column that is present but blank arrives as '' (Papa fills every
  // header, XLSX with defval:''), which is not nullish — `??` would stop at the empty Name and
  // reject every row of an otherwise valid file.
  function resolveClientName(row: any) {
    const first = [row.Name, row.name, row.Company, row.company, row.ContactName, row.contactName]
      .map((v) => (v ?? '').toString().trim())
      .find(Boolean);
    return first || '';
  }

  async function handleBulkImport() {
    if (!importPreview.length) return;
    if (importPreview.length > 500) { toast.error('Max 500 clients at a time.'); return; }
    setImporting(true);
    try {
      // Send every row; the server validates each and returns the rejected ones with reasons.
      const payload = importPreview.map((row: any) => ({
        name: resolveClientName(row),
        company: row.Company ?? row.company ?? '',
        industry: row.Industry ?? row.industry ?? '',
        status: row.Status ?? row.status ?? 'PROSPECT',
        engagementType: row.EngagementType ?? row.engagementType ?? '',
        contractValue: row.ContractValue ?? row.contractValue ?? '',
        email: row.Email ?? row.email ?? '',
        phone: row.Phone ?? row.phone ?? '',
        website: row.Website ?? row.website ?? '',
        address: row.Address ?? row.address ?? '',
        city: row.City ?? row.city ?? '',
        state: row.State ?? row.state ?? '',
        zip: row.Zip ?? row.zip ?? '',
        country: row.Country ?? row.country ?? '',
        gstNumber: row.GstNumber ?? row.gstNumber ?? row.GSTNumber ?? '',
        billingAddress: row.BillingAddress ?? row.billingAddress ?? '',
        scope: row.Scope ?? row.scope ?? '',
        assetLinks: row.AssetLinks ?? row.assetLinks ?? '',
        startDate: row.StartDate ?? row.startDate ?? '',
        accountManagerEmail: row.AccountManagerEmail ?? row.accountManagerEmail ?? '',
        contactName: row.ContactName ?? row.contactName ?? '',
        contactDesignation: row.ContactDesignation ?? row.contactDesignation ?? '',
        contactEmail: row.ContactEmail ?? row.contactEmail ?? '',
        contactPhone: row.ContactPhone ?? row.contactPhone ?? ''
      }));

      const res = await api.post<{ imported: number; rejectedCount: number; rejected: any[] }>('/clients/bulk', { clients: payload });
      setImportResult(res);
      if (res.imported > 0) toast.success(`Imported ${res.imported} client${res.imported === 1 ? '' : 's'}`);
      else toast.error('No clients imported — see the rejection report.');
      fetchClients();
    } catch (err: any) {
      toast.error(err.message || 'Failed to import clients');
    } finally {
      setImporting(false);
    }
  }

  function downloadRejectionReport() {
    if (!importResult?.rejected?.length) return;
    const csv = Papa.unparse(importResult.rejected);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rejected_clients_${Date.now()}.csv`;
    link.click();
  }

  function downloadTemplate() {
    const csv = Papa.unparse([{
      Name: 'Example Retail Pvt Ltd',
      Company: 'Example Retail Pvt Ltd',
      Industry: 'Retail',
      Status: 'ACTIVE',
      EngagementType: 'Retainer',
      ContractValue: '50000',
      Email: 'accounts@example.in',
      Phone: '+91-98400-00000',
      Website: 'https://example.in',
      Address: '12 MG Road',
      City: 'Chennai',
      State: 'Tamil Nadu',
      Zip: '600001',
      Country: 'India',
      GstNumber: '33AABCE1234F1Z5',
      BillingAddress: '12 MG Road, Chennai, Tamil Nadu 600001',
      Scope: 'Full service marketing',
      AssetLinks: 'https://drive.google.com/xyz',
      StartDate: '2026-06-01',
      AccountManagerEmail: '',
      ContactName: 'Priya Raman',
      ContactDesignation: 'Marketing Head',
      ContactEmail: 'priya@example.in',
      ContactPhone: '+91-98400-00001'
    }]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'client_import_template.csv';
    link.click();
  }

  const activeCount = (statusFilter.length > 0 ? 1 : 0) +
    (engagementTypeFilter.length > 0 ? 1 : 0) +
    (accountManagerFilter.length > 0 ? 1 : 0) +
    (industryFilter.length > 0 ? 1 : 0) +
    (showArchived ? 1 : 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2">
            Clients
            <span className="text-xs font-normal text-body-soft bg-subtle px-2 py-0.5 rounded-lg border border-border">
              {viewName}
            </span>
          </h1>
          <p className="text-sm text-secondary mt-1">{total} total clients</p>
        </div>
      </div>

      {/* Redesigned Clean Clients Toolbar */}
      <div className="bg-white border border-border rounded-2xl p-4 shadow-sm flex flex-col gap-4 w-full mb-6">
        {/* Row 1: Search + Active Filter Pills */}
        {isMobile ? (
          <div className="flex flex-col gap-2.5 w-full">
            <div className="flex items-center gap-2 w-full">
              <div className="relative w-full shrink">
                <Icon as={Search} size="md" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients..."
                  className="w-full h-9 rounded-xl border border-border bg-white pl-10 pr-4 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none placeholder:text-secondary"
                />
              </div>
              <button
                type="button"
                onClick={() => setFilterSheetOpen(true)}
                className="flex items-center gap-1.5 h-9 rounded-xl border border-border bg-white hover:bg-gray-50 px-3 text-xs font-semibold text-secondary shrink-0 transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Filters</span>
                {activeCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {activeCount}
                  </span>
                )}
              </button>
              {/* Action buttons on mobile right corner */}
              <div className="flex items-center gap-1.5 shrink-0">
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
                    className="flex items-center justify-center rounded-xl border border-border bg-white h-9 w-9 text-xs font-semibold text-body hover:bg-surface transition-colors disabled:opacity-50 shrink-0"
                    title="Export CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
                {activeModule !== 'PM' && (
                  <Link
                    href="/pipeline"
                    className="flex items-center justify-center rounded-xl bg-primary h-9 w-9 text-white hover:bg-primary-hover transition-colors shrink-0"
                    title="New Lead"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </div>

            {/* Active Chips Row */}
            {activeCount > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {statusFilter.length > 0 && <ActiveFilterChip label={`Lifecycle: ${statusFilter.length}`} onRemove={() => setStatusFilter([])} />}
                {engagementTypeFilter.length > 0 && <ActiveFilterChip label={`Engagements: ${engagementTypeFilter.length}`} onRemove={() => setEngagementTypeFilter([])} />}
                {accountManagerFilter.length > 0 && <ActiveFilterChip label={`Manager: ${accountManagerFilter.length}`} onRemove={() => setAccountManagerFilter([])} />}
                {industryFilter.length > 0 && <ActiveFilterChip label={`Industry: ${industryFilter.length}`} onRemove={() => setIndustryFilter([])} />}
                {showArchived && <ActiveFilterChip label="Show Archived" onRemove={() => setShowArchived(false)} />}
              </div>
            )}

            {/* Mobile Filter Drawer */}
            <Drawer isOpen={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filter Clients">
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Lifecycle Stage</label>
                  <MultiSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    placeholder="Lifecycle Stage"
                    showSelectAll={true}
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={[
                      { label: 'Prospect', value: 'PROSPECT' },
                      { label: 'Active', value: 'ACTIVE' },
                      { label: 'On Hold', value: 'ONHOLD' },
                      { label: 'Churned', value: 'CHURNED' },
                      { label: 'Completed', value: 'PROJECT_COMPLETED' },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Engagements</label>
                  <MultiSelect
                    value={engagementTypeFilter}
                    onChange={setEngagementTypeFilter}
                    placeholder="Engagements"
                    showSelectAll={true}
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={[
                      { label: 'Retainer', value: 'Retainer' },
                      { label: 'Project', value: 'Project' },
                      { label: 'Event', value: 'Event' },
                      { label: 'Ad-hoc', value: 'Ad-hoc' }
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Account Manager</label>
                  <MultiSelect
                    value={accountManagerFilter}
                    onChange={setAccountManagerFilter}
                    placeholder="Account Manager"
                    showSelectAll={true}
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1.5 block">Industries</label>
                  <MultiSelect
                    value={industryFilter}
                    onChange={setIndustryFilter}
                    placeholder="Industries"
                    showSelectAll={true}
                    triggerClassName="w-full h-9 rounded-xl border border-border bg-white px-3 text-xs"
                    options={INDUSTRY_OPTIONS.map((i) => ({ label: i, value: i }))}
                  />
                </div>
                {canManageClients && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs font-semibold text-secondary">Show Archived Clients</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showArchived}
                      onClick={() => setShowArchived(v => !v)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${showArchived ? 'bg-primary border-primary' : 'bg-gray-200 border-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showArchived ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                )}
              </div>
            </Drawer>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 w-full">
            {/* Search Box */}
            <div className="relative w-full sm:w-64 md:w-80 shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full h-9 rounded-xl border border-border bg-white pl-10 pr-4 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none placeholder:text-secondary"
              />
            </div>

            {/* Filter Pills */}
            <div className="shrink-0">
              <MultiSelect
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Lifecycle Stage"
                showSelectAll={true}
                triggerClassName={statusFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-colors duration-150 motion-reduce:transition-none"}
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
                triggerClassName={engagementTypeFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-colors duration-150 motion-reduce:transition-none"}
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
                triggerClassName={accountManagerFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-colors duration-150 motion-reduce:transition-none"}
                options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
              />
            </div>

            <div className="shrink-0">
              <MultiSelect
                value={industryFilter}
                onChange={setIndustryFilter}
                placeholder="Industries"
                showSelectAll={true}
                triggerClassName={industryFilter.length > 0 ? "border-primary bg-primary/[0.02] text-primary h-9 rounded-xl px-3 text-xs font-semibold" : "h-9 rounded-xl border border-border bg-white hover:bg-gray-50 hover:border-gray-300 text-secondary px-3 text-xs transition-colors duration-150 motion-reduce:transition-none"}
                options={INDUSTRY_OPTIONS.map((i) => ({ label: i, value: i }))}
              />
            </div>

            {canManageClients && (
              <button
                type="button"
                onClick={() => setShowArchived(v => !v)}
                className={showArchived ? "h-9 rounded-xl border border-primary bg-primary/2 px-3 text-xs font-semibold text-primary transition-colors duration-150 motion-reduce:transition-none shrink-0 whitespace-nowrap" : "h-9 rounded-xl border border-border bg-white px-3 text-xs text-secondary hover:bg-gray-50 hover:border-gray-300 transition-colors duration-150 motion-reduce:transition-none shrink-0 whitespace-nowrap"}
                title="Archived clients are hidden by default; show them here to restore one"
              >
                {showArchived ? 'Hide Archived' : 'Show Archived'}
              </button>
            )}

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
                  className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-body hover:bg-surface transition-colors duration-150 motion-reduce:transition-none disabled:opacity-50 h-9 shrink-0 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
              )}

              {activeModule !== 'PM' && (
                <Link
                  href="/pipeline"
                  className="flex items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150 motion-reduce:transition-none h-9 shrink-0 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" /> New Lead
                </Link>
              )}
            </div>
          </div>
        )}

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
            <div className="flex bg-subtle p-1 rounded-xl gap-0.5 border border-border/50 shrink-0 h-9 items-center overflow-x-auto no-scrollbar max-w-full">
              <button
                type="button"
                onClick={() => {
                  setCurrentView('table');
                  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ name: viewName, visibleColumns, viewType: 'table' }));
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none whitespace-nowrap shrink-0 ${currentView === 'table' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="Table View"
              >
                <Icon as={List} size="sm" className="shrink-0" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentView('timeline');
                  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ name: viewName, visibleColumns, viewType: 'timeline' }));
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none whitespace-nowrap shrink-0 ${currentView === 'timeline' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                title="Timeline View"
              >
                <Icon as={LayoutGrid} size="sm" className="shrink-0" />
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
            <table className="w-full min-w-200">
              <thead>
                <tr className="border-b border-subtle">
                  {visibleColumns.includes('client') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Client</th>}
                  {visibleColumns.includes('industry') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Industry</th>}
                  {visibleColumns.includes('contact') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Contact</th>}
                  {visibleColumns.includes('projects') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Projects</th>}
                  {visibleColumns.includes('status') && <th className="px-6 py-3.5 text-left text-xs font-medium text-secondary uppercase tracking-wide">Lifecycle Stage</th>}
                  <th className="px-6 py-3.5 w-10 text-center relative select-none">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowColumnDropdown(!showColumnDropdown); }}
                      className="inline-flex items-center justify-center h-6 w-6 rounded-md text-secondary hover:bg-gray-100 hover:text-primary transition-colors duration-150 motion-reduce:transition-none text-sm font-bold border border-transparent hover:border-gray-200"
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
                            <div className="px-3 py-2 border-b border-subtle text-[10px] font-semibold text-secondary uppercase tracking-wider text-left">
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
                                className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-surface transition-colors"
                              >
                                <span className="text-body">{col.label}</span>
                                {visibleColumns.includes(col.id) && <Icon as={Check} size="md" className="text-primary" />}
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
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
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <Briefcase className="h-12 w-12 text-secondary/40 mx-auto mb-3" />
                      <h3 className="text-sm font-semibold text-primary mb-1">No clients yet</h3>
                      <p className="text-sm text-secondary mb-6 max-w-sm mx-auto">
                        Add your first client to start tracking projects, contracts, and revenue.
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        {canManageClients && (
                        <button
                          onClick={() => setShowCreate(true)}
                          className="bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-black transition-colors"
                        >
                          + Import Clients
                        </button>
                        )}
                        <Link
                          href="/pipeline?create=true"
                          className="border border-border text-primary text-xs font-semibold px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                          + Add Lead Instead
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : (
                  clients.map((client) => (
                    <motion.tr
                      key={client.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="hover:bg-surface transition-colors relative"
                    >
                      {visibleColumns.includes('client') && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${getAvatarColor(getClientDisplayName(client))}`}>
                              {getInitials(getClientDisplayName(client))}
                            </div>
                            <div>
                              <Link
                                href={`/clients/${client.id}`}
                                className="text-sm font-medium text-primary hover:underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                              >
                                {getClientDisplayName(client)}
                              </Link>
                              {client.name !== 'Internal' && client.company && (client.contacts?.[0]?.name || client.name !== client.company) && (
                                <p className="text-xs text-secondary">{client.contacts?.[0]?.name || client.name}</p>
                              )}
                              {client.name === 'Internal' && <p className="text-xs font-medium text-secondary">(Internal)</p>}
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
                              <p className="text-sm text-body font-medium">Internal Contact</p>
                              {orgProfile?.phone && <p className="text-[11px] text-secondary">{orgProfile.phone}</p>}
                            </div>
                          ) : client.contacts && client.contacts.length > 0 ? (
                            <div>
                              <p className="text-sm text-body font-medium">{client.contacts[0].name}</p>
                              {client.contacts[0].designation && <p className="text-[11px] text-secondary">{client.contacts[0].designation}</p>}
                              {client.contacts.length > 1 && (
                                <span className="text-[10px] font-medium bg-subtle text-body-soft px-1.5 py-0.5 rounded mt-1 inline-block">
                                  +{client.contacts.length - 1} more
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-secondary">—</span>
                          )}
                        </td>
                      )}

                      {visibleColumns.includes('projects') && (
                        <td className="px-6 py-4 text-sm text-secondary tabular-nums">{client._count?.projects ?? 0}</td>
                      )}
                      {visibleColumns.includes('status') && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={client.status} />
                            {client.archivedAt && (
                              <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Archived</span>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <ChevronRight className="h-4 w-4 text-line" aria-hidden="true" />
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
          <div className="p-8 text-center bg-white rounded-xl border border-border">
            <Briefcase className="h-10 w-10 text-secondary/40 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-primary mb-1">No clients yet</h3>
            <p className="text-xs text-secondary mb-4">
              Add your first client to start tracking projects and revenue.
            </p>
            <div className="flex flex-col gap-2">
              {canManageClients && (
              <button
                onClick={() => setShowCreate(true)}
                className="bg-primary text-white text-xs font-semibold px-4 py-2 rounded-xl hover:bg-black transition-colors"
              >
                + Import Clients
              </button>
              )}
              <Link
                href="/pipeline?create=true"
                className="border border-border text-primary text-xs font-semibold px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors"
              >
                + Add Lead Instead
              </Link>
            </div>
          </div>
        ) : (
          clients.map((client) => (
            <Link
              key={client.id}
              href={`/clients/${client.id}`}
              className="block p-4 rounded-xl border border-border bg-white hover:shadow-sm transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={client.status} size="xs" />
                  {client.archivedAt && (
                    <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Archived</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="flex flex-col">
                  {client.contacts && client.contacts.length > 0 ? (
                    <>
                      <p className="text-[11px] font-medium text-body">{client.contacts[0].name}</p>
                      {client.contacts.length > 1 && (
                        <p className="text-[10px] text-secondary">+{client.contacts.length - 1} more</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-secondary">No contacts</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-body-soft bg-subtle px-2 py-1 rounded-md">
                  <FolderKanban className="h-3 w-3" />
                  {client._count?.projects ?? 0}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Load more */}
      {!loading && clients.length < total && (
        <div className="flex flex-col items-center gap-2 mt-6">
          <p className="text-xs text-secondary">Showing {clients.length} of {total}</p>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-medium text-body hover:bg-surface transition-colors duration-150 motion-reduce:transition-none"
          >
            Load more
          </button>
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && canManageClients && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-modal shadow-black/10 overflow-y-auto"
            >
              <div className="flex flex-col border-b border-subtle">
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-primary">Import Clients</h2>
                    <p className="text-xs text-secondary mt-0.5">Bulk-onboard existing clients from a CSV file. New deals still go through the pipeline.</p>
                  </div>
                  <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-subtle transition-colors shrink-0">
                    <X className="h-4 w-4 text-secondary" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">Need a template?</h3>
                    <p className="text-xs text-secondary mt-1">CSV or Excel (.xlsx). <span className="font-medium text-body">Name required</span> on every row.</p>
                  </div>
                  <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-body hover:bg-gray-50 transition-colors duration-150 motion-reduce:transition-none">
                    <FileText className="h-3.5 w-3.5" /> Template
                  </button>
                </div>

                <div>
                  <label
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed transition-colors rounded-xl cursor-pointer ${isDragging ? 'border-primary bg-gray-50' : 'border-line hover:border-primary hover:bg-gray-50'}`}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="h-8 w-8 mb-3 text-secondary" />
                      <p className="mb-2 text-sm text-body-soft">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-secondary">CSV or Excel (.xlsx, .xls)</p>
                    </div>
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
                  </label>
                  {importFile && (
                    <p className="text-xs text-primary mt-2 font-medium flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-[#10B981]" /> {importFile.name}
                    </p>
                  )}
                </div>

                {importPreview.length > 0 && !importResult && (() => {
                  const named = importPreview.filter(r => resolveClientName(r).length >= 2).length;
                  return (
                    <div className="p-4 rounded-xl border border-border bg-subtle">
                      <h4 className="text-sm font-semibold text-primary mb-1">Ready to Import</h4>
                      <p className="text-xs text-body">
                        Found {importPreview.length} row{importPreview.length === 1 ? '' : 's'}
                        {named < importPreview.length && <> — {importPreview.length - named} missing a name will be rejected</>}.
                      </p>
                    </div>
                  );
                })()}

                {importResult && (
                  <div className={`p-4 rounded-xl border ${importResult.rejectedCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
                    <h4 className={`text-sm font-semibold mb-1 ${importResult.rejectedCount > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>
                      Imported {importResult.imported} of {importResult.imported + importResult.rejectedCount}
                    </h4>
                    {importResult.rejectedCount > 0 ? (
                      <>
                        <p className="text-xs text-amber-800">
                          {importResult.rejectedCount} row{importResult.rejectedCount === 1 ? '' : 's'} rejected. Download the report, fix the rows, and re-upload just those — the imported ones are already saved.
                        </p>
                        <button onClick={downloadRejectionReport} className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 transition-colors duration-150 motion-reduce:transition-none">
                          <Download className="h-3.5 w-3.5" /> Rejection report
                        </button>
                      </>
                    ) : (
                      <p className="text-xs text-green-800">Every row imported cleanly.</p>
                    )}
                  </div>
                )}

                <div className="pt-4 flex flex-row gap-2 sm:gap-3">
                  <button type="button" onClick={() => { setShowCreate(false); setImportFile(null); setImportPreview([]); setImportResult(null); }} className="flex-1 w-full sm:flex-1 rounded-xl border border-border px-2 sm:px-4 py-2.5 text-sm font-medium text-body hover:bg-surface transition-colors duration-150 motion-reduce:transition-none">
                    {importResult ? 'Done' : 'Cancel'}
                  </button>
                  {/* Hidden once a result is in — re-clicking would import the same file twice. */}
                  {!importResult && (
                    <button
                      onClick={handleBulkImport}
                      disabled={importing || importPreview.length === 0}
                      className="flex-1 w-full sm:flex-1 rounded-xl bg-primary px-2 sm:px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors duration-150 motion-reduce:transition-none flex items-center justify-center"
                    >
                      {importing ? 'Importing...' : <><span className="hidden sm:inline">Import Clients</span><span className="inline sm:hidden">Import</span></>}
                    </button>
                  )}
                </div>
              </div>
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
          setViewName('All clients');
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
