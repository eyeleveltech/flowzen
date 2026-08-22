'use client';

/**
 * Projects.
 *
 * A project belongs to the CLIENT and only to the client. What the client is on —
 * retainer or project, and at what price — is SHOWN here, read from the company
 * rather than linked to the project (master plan §3.12).
 *
 * Health is computed by the server from dates and overdue tasks. A flag someone
 * sets by hand is green everywhere, forever (§4.8).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderKanban, Plus, List, LayoutDashboard, Calendar, Columns3, Clock, Globe, Smartphone, ShoppingBag, FileCode, Share2, Search, Zap, Package, Filter, RotateCcw, X } from 'lucide-react';
import { api, ApiError, formatMoney, formatDate, atLeast, type OrgConfig, type Company, type Role } from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { CalendarView } from '@/components/ui/calendar-view';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

type Health = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';

type Project = {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  scope: string | null;
  platform: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  health: Health;
  taskCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  company: { id: string; name: string; status: string };
  owner: { id: string; name: string } | null;
  members: { user: { id: string; name: string } }[];
  engagementContext: { type: string; billingFrequency: string; monthlyValue?: string }[];
};

const HEALTH: Record<Health, { label: string; tone: Tone }> = {
  ON_TRACK: { label: 'On track', tone: 'good' },
  AT_RISK: { label: 'At risk', tone: 'warn' },
  OFF_TRACK: { label: 'Off track', tone: 'bad' },
};

const STATUS_FILTER_OPTIONS: Option[] = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const TYPE_FILTER_OPTIONS: Option[] = [
  { value: 'ONE_TIME', label: 'One-Time Project' },
  { value: 'RETAINER', label: 'Retainer' },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<'LIST' | 'BOARD' | 'TIMELINE' | 'CALENDAR' | 'GANTT'>('LIST');

  // Custom MultiSelect Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);

  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const [list, cfg] = await Promise.all([
        api.projects.list() as Promise<unknown> as Promise<Project[]>,
        api.config.get(),
      ]);
      setProjects(Array.isArray(list) ? list : []);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const timezone = config?.organization.timezone ?? 'Asia/Kolkata';
  const role = config?.me.role as Role | undefined;

  const uniqueClients = Array.from(
    new Map(projects.map((p) => [p.company.id, p.company])).values()
  );
  const uniqueOwners = Array.from(
    new Map(
      projects.filter((p) => p.owner).map((p) => [p.owner!.id, p.owner!])
    ).values()
  );

  const clientFilterOptions: Option[] = uniqueClients.map((c) => ({ value: c.id, label: c.name }));
  const ownerFilterOptions: Option[] = uniqueOwners.map((o) => ({ value: o.id, label: o.name }));

  const filtered = projects.filter((p) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name.toLowerCase().includes(q);
      const matchCompany = p.company.name.toLowerCase().includes(q);
      if (!matchName && !matchCompany) return false;
    }
    if (statusFilter.length > 0 && !statusFilter.includes(p.status)) return false;
    if (typeFilter.length > 0 && p.type && !typeFilter.includes(p.type)) return false;
    if (platformFilter.length > 0) {
      if (!p.platform) return false;
      const projectPlatforms = p.platform.split(',');
      const hasMatch = platformFilter.some((pf) => projectPlatforms.includes(pf));
      if (!hasMatch) return false;
    }
    if (clientFilter.length > 0 && !clientFilter.includes(p.company.id)) return false;
    if (ownerFilter.length > 0 && p.owner && !ownerFilter.includes(p.owner.id)) return false;
    return true;
  });

  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  const hasActiveFilters = Boolean(
    searchQuery ||
    statusFilter.length > 0 ||
    typeFilter.length > 0 ||
    platformFilter.length > 0 ||
    clientFilter.length > 0 ||
    ownerFilter.length > 0
  );

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter([]);
    setTypeFilter([]);
    setPlatformFilter([]);
    setClientFilter([]);
    setOwnerFilter([]);
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${activeCount} active`}
        action={
          atLeast(role, 'MANAGER') && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New project
            </Button>
          )
        }
      />

      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

      {projects.length === 0 && !error ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          hint="A project belongs to a client, so start one once a deal is won."
        />
      ) : (
        <div className="space-y-4">
          {/* Project Filter Toolbar */}
          <div className="rounded-xl border border-border bg-white p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Search Box */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search project or client..."
                  className="w-full rounded-xl border border-border bg-white pl-9 pr-8 py-1.5 text-sm text-body placeholder:text-muted focus:border-primary focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-muted hover:text-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* View Switcher */}
              <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
                <button
                  onClick={() => setView('LIST')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'LIST' ? 'bg-white shadow-xs text-primary font-semibold' : 'text-secondary hover:text-primary'
                    }`}
                >
                  <List className="h-3.5 w-3.5" /> List
                </button>
                <button
                  onClick={() => setView('BOARD')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'BOARD' ? 'bg-white shadow-xs text-primary font-semibold' : 'text-secondary hover:text-primary'
                    }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" /> Board
                </button>
                <button
                  onClick={() => setView('TIMELINE')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'TIMELINE' ? 'bg-white shadow-xs text-primary font-semibold' : 'text-secondary hover:text-primary'
                    }`}
                >
                  <Columns3 className="h-3.5 w-3.5" /> Timeline
                </button>
                <button
                  onClick={() => setView('CALENDAR')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'CALENDAR' ? 'bg-white shadow-xs text-primary font-semibold' : 'text-secondary hover:text-primary'
                    }`}
                >
                  <Calendar className="h-3.5 w-3.5" /> Calendar
                </button>
                <button
                  onClick={() => setView('GANTT')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${view === 'GANTT' ? 'bg-white shadow-xs text-primary font-semibold' : 'text-secondary hover:text-primary'
                    }`}
                >
                  <Clock className="h-3.5 w-3.5" /> Gantt
                </button>
              </div>
            </div>

            {/* Custom MultiSelect Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-subtle">
              <div className="flex items-center gap-1 text-xs font-medium text-muted mr-1">
                <Filter className="h-3.5 w-3.5" /> Filters:
              </div>

              {/* Status MultiSelect Filter */}
              <div className="w-36">
                <MultiSelect
                  compact={true}
                  placeholder="All Statuses"
                  options={STATUS_FILTER_OPTIONS}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                />
              </div>

              {/* Project Type MultiSelect Filter */}
              <div className="w-38">
                <MultiSelect
                  compact={true}
                  placeholder="All Types"
                  options={TYPE_FILTER_OPTIONS}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                />
              </div>

              {/* Platform / Technology MultiSelect Filter (with SVG Lucide Icons!) */}
              <div className="w-40">
                <MultiSelect
                  compact={true}
                  placeholder="All Platforms"
                  options={PLATFORM_OPTIONS}
                  value={platformFilter}
                  onChange={setPlatformFilter}
                  triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                />
              </div>

              {/* Client MultiSelect Filter */}
              {clientFilterOptions.length > 0 && (
                <div className="w-40">
                  <MultiSelect
                    compact={true}
                    placeholder="All Clients"
                    options={clientFilterOptions}
                    value={clientFilter}
                    onChange={setClientFilter}
                    triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                  />
                </div>
              )}

              {/* Owner MultiSelect Filter */}
              {ownerFilterOptions.length > 0 && (
                <div className="w-40">
                  <MultiSelect
                    compact={true}
                    placeholder="All Owners"
                    options={ownerFilterOptions}
                    value={ownerFilter}
                    onChange={setOwnerFilter}
                    triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                  />
                </div>
              )}

              {/* Reset Filters */}
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors ml-auto"
                >
                  <RotateCcw className="h-3 w-3" /> Clear filters
                </button>
              )}
            </div>
          </div>

          {view === 'BOARD' ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="rounded-card cursor-pointer border border-border bg-white p-4 transition-colors hover:border-primary"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-primary">{p.name}</p>
                      <p className="truncate text-xs text-secondary">{p.company.name}</p>
                    </div>
                    <Badge tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Badge>
                  </div>

                  {p.engagementContext.length > 0 && (
                    <p className="mt-2 text-xs text-secondary">
                      {p.engagementContext
                        .map((e) =>
                          e.monthlyValue
                            ? `${e.type === 'RETAINER' ? 'Retainer' : 'Project'} · ${formatMoney(e.monthlyValue, currency, locale)}/mo`
                            : e.type === 'RETAINER'
                              ? 'Retainer'
                              : 'Project',
                        )
                        .join(' · ')}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-secondary">
                    <span>
                      {p.openTaskCount} open
                      {p.overdueTaskCount > 0 && (
                        <span className="ml-1 font-medium text-red-600">· {p.overdueTaskCount} overdue</span>
                      )}
                    </span>
                    <span>{p.dueDate ? formatDate(p.dueDate, timezone, locale) : 'No due date'}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : view === 'LIST' ? (
            <Table>
              <THead>
                <TR className="bg-surface hover:bg-surface">
                  <TH>PROJECT</TH>
                  <TH>COMPANY</TH>
                  <TH>PROGRESS</TH>
                  <TH>STATUS</TH>
                  <TH>OWNER</TH>
                  <TH>DUE DATE</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map(p => (
                  <TR
                    key={p.id}
                    onClick={() => router.push(`/projects/${p.id}`)}
                    className="cursor-pointer hover:bg-subtle transition-colors"
                  >
                    <TD className="font-medium text-primary">{p.name}</TD>
                    <TD className="text-secondary">{p.company.name}</TD>
                    <TD className="text-secondary">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface">
                        <div className="h-full bg-primary" style={{ width: p.taskCount > 0 ? `${Math.round(((p.taskCount - p.openTaskCount) / p.taskCount) * 100)}%` : '0%' }}></div>
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Badge>
                    </TD>
                    <TD className="text-secondary">{p.owner?.name ?? '—'}</TD>
                    <TD className="text-secondary">{p.dueDate ? formatDate(p.dueDate, timezone, locale) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : view === 'CALENDAR' ? (
            <CalendarView
              events={filtered.map((p) => ({
                id: p.id,
                title: p.name,
                subtitle: p.company.name,
                date: p.dueDate,
                status: p.status,
                onClick: () => router.push(`/projects/${p.id}`),
              }))}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border py-20 text-center text-sm text-secondary">
              This view is under construction.
            </div>
          )}
        </div>
      )}

      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void load();
        }}
      />
    </>
  );
}

const PLATFORM_OPTIONS: Option[] = [
  { value: 'WEB', label: 'Web Application', icon: <Globe className="h-4 w-4 text-sky-500" /> },
  { value: 'MOBILE_APP', label: 'Mobile App (iOS / Android)', icon: <Smartphone className="h-4 w-4 text-emerald-500" /> },
  { value: 'SHOPIFY', label: 'Shopify / E-Commerce', icon: <ShoppingBag className="h-4 w-4 text-indigo-500" /> },
  { value: 'WORDPRESS', label: 'WordPress / CMS', icon: <FileCode className="h-4 w-4 text-blue-500" /> },
  { value: 'SOCIAL_MEDIA', label: 'Social Media Marketing', icon: <Share2 className="h-4 w-4 text-pink-500" /> },
  { value: 'SEO_MARKETING', label: 'SEO & Digital Marketing', icon: <Search className="h-4 w-4 text-amber-500" /> },
  { value: 'CUSTOM_PLATFORM', label: 'Custom Platform', icon: <Zap className="h-4 w-4 text-violet-500" /> },
  { value: 'OTHER', label: 'Other', icon: <Package className="h-4 w-4 text-gray-500" /> },
];

function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['WEB']);
  const [type, setType] = useState('ONE_TIME');
  const [status, setStatus] = useState('PLANNING');
  const [companyId, setCompanyId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [scope, setScope] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setPlatforms(['WEB']);
    setType('ONE_TIME');
    setStatus('PLANNING');
    setCompanyId('');
    setOwnerId('');
    setMemberIds([]);
    setStartDate('');
    setDueDate('');
    setScope('');
    setError(null);

    void Promise.all([
      api.companies.list().then(setCompanies).catch(() => { }),
      api.users.list().then((list) =>
        setTeam(list.filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: u.name })))
      ).catch(() => { }),
    ]);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.projects.create({
        name,
        description: description || null,
        platform: platforms.length > 0 ? platforms.join(',') : null,
        type,
        status: status as any,
        companyId,
        ownerId: ownerId || null,
        memberIds,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        scope: scope || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project');
    } finally {
      setSaving(false);
    }
  };

  const NONE = { value: '', label: '— Choose Project Owner —' };

  return (
    <Modal open={open} onClose={onClose} title="New project" size="lg">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* 1. Project Name */}
          <Field label="Project Name *" value={name} onChange={setName} placeholder="e.g. Website Redesign & Brand Strategy" required />

          {/* 5. Client */}
          <FieldSelect
            label="Client / Company *"
            required
            value={companyId}
            onChange={setCompanyId}
            placeholder="Choose a client…"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />

          {/* MultiSelect Platforms with Icons */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-secondary">Platforms / Technologies</label>
            <MultiSelect
              compact={false}
              placeholder="Select platforms (Web, Mobile, Social Media...)"
              options={PLATFORM_OPTIONS}
              value={platforms}
              onChange={setPlatforms}
            />
          </div>

          {/* Project Type & Status */}
          <div className="grid grid-cols-2 gap-3">
            <FieldSelect
              label="Project Type"
              value={type}
              onChange={setType}
              options={[
                { value: 'ONE_TIME', label: 'One-Time Project' },
                { value: 'RETAINER', label: 'Retainer' },
              ]}
            />
          </div>

          {/* Status & Project Owner */}
          <div className="grid grid-cols-2 gap-3">
            <FieldSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'PLANNING', label: 'Planning' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ON_HOLD', label: 'On Hold' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
            <FieldSelect
              label="Project Owner"
              value={ownerId}
              onChange={setOwnerId}
              options={[NONE, ...team]}
            />
          </div>

          {/* 7. Team Members (MultiSelect Dropdown) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary">Team Members</label>
            <MultiSelect
              compact={false}
              placeholder="Click to add team members…"
              options={team}
              value={memberIds}
              onChange={setMemberIds}
            />
          </div>

          {/* 8 & 9. Start Date & End Date */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date" type="date" value={startDate} onChange={setStartDate} />
            <Field label="End Date (Due Date)" type="date" value={dueDate} onChange={setDueDate} />
          </div>

          {/* 2. Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the project objectives…"
              rows={2}
              className="w-full rounded-xl border border-border bg-white p-3 text-sm text-body placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {/* 10. Scope (Rich Text Editor) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary mb-1 block">Scope of Work (Rich Text)</label>
            <RichTextEditor
              value={scope}
              onChange={setScope}
              placeholder="Detailed scope, deliverables, and milestones…"
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!companyId || !name}>
            Create Project
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
