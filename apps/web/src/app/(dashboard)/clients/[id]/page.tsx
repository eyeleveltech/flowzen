'use client';

/**
 * Client Detail Page
 * 
 * Comprehensive view of a single client, adaptively rendering:
 * - Basic info (contacts, location, owner)
 * - Projects & Tasks
 * - Engagements & Retainers (commercial view)
 * - Deals & Pipeline (CRM view)
 * - Activity Timeline
 */

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import {
  Building2,
  Clock,
  Mail,
  Phone,
  RefreshCw,
  Star,
  Plus,
  ArrowLeft,
  Calendar,
  FolderKanban,
  FileText,
  DollarSign,
  User,
  MapPin,
  FileSpreadsheet,
  MessageSquare,
  Pencil,
} from 'lucide-react';
import {
  api,
  ApiError,
  atLeast,
  formatDate,
  formatMoney,
  type CompanyStatus,
  type OrgConfig,
  type Role,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge, COMPANY_TONE } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { ClientDetailSkeleton } from '@/components/ui/skeleton-loaders';
import { useModuleStore } from '@/stores';
import { NewProjectModal } from '@/components/projects/NewProjectModal';
import { NewContactModal } from '@/components/clients/NewContactModal';
import { EditClientModal } from '@/components/clients/EditClientModal';
import { ActivityFeed } from '@/components/activities/ActivityFeed';
import { LogActivityDialog } from '@/components/activities/LogActivityDialog';

type Engagement = {
  id: string;
  type: 'RETAINER' | 'PROJECT';
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  amount: string;
  billingFrequency: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  nextReviewDate: string | null;
  revisions: { id: string; amount: string; effectiveFrom: string; reason: string | null }[];
};

type ClientDetail = {
  id: string;
  name: string;
  status: CompanyStatus;
  statusMeaning: { label: string; nextAction: string };
  email: string | null;
  phone: string | null;
  state: string | null;
  gstNumber: string | null;
  monthlyValue: string;
  owner: { id: string; name: string } | null;
  contacts: { id: string; name: string; designation: string | null; email: string | null; role: string | null; isPrimary: boolean }[];
  deals: { id: string; title: string | null; value: string | null; stage: { name: string; kind: string } }[];
  engagements: Engagement[];
  projects: { id: string; name: string; status: string; dueDate: string | null }[];
  invoices: { id: string; number: string; total: string; status: string; issueDate: string; dueDate: string }[];
  activities: { id: string; type: string; message: string; body: string | null; occurredAt: string; user?: { name: string } }[];
};

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Engagement | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [logging, setLogging] = useState(false);
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PROJECTS' | 'ENGAGEMENTS' | 'DEALS' | 'INVOICES'>('OVERVIEW');

  const activeModule = useModuleStore((s) => s.activeModule);
  const hydrateModule = useModuleStore((s) => s.hydrate);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrateModule();
    setMounted(true);
  }, [hydrateModule]);

  const load = useCallback(async () => {
    try {
      const [c, cfg] = await Promise.all([
        api.companies.get(id) as Promise<unknown> as Promise<ClientDetail>,
        api.config.get(),
      ]);
      setClient(c);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this client');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !mounted) return <ClientDetailSkeleton />;

  if (error || !client) {
    return (
      <EmptyState
        title="Client Not Found"
        hint={error ?? undefined}
        action={
          <Link href="/clients">
            <Button variant="primary">Back to Clients</Button>
          </Link>
        }
      />
    );
  }

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const role = config?.me.role as Role | undefined;
  const money = (v: string | null | undefined) => formatMoney(v, currency, locale);
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);

  const live = client.engagements.filter((e) => e.status !== 'ENDED');
  const commercial = activeModule !== 'PM';

  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Top Back Navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Clients
        </Link>
      </div>

      {/* ── Client Header Card ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-white p-6 space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            {/* Avatar Badge */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xl font-bold">
              {client.name.charAt(0).toUpperCase()}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-primary">{client.name}</h1>
                <Badge tone={COMPANY_TONE[client.status].tone}>
                  {COMPANY_TONE[client.status].label}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-secondary">
                {commercial ? client.statusMeaning?.nextAction : shapeOfWork(live)}
              </p>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {commercial && atLeast(role, 'SALES') && (
              <Button size="sm" variant="ghost" className="gap-1.5 border border-border" onClick={() => setEditingClient(true)}>
                <Pencil className="h-3.5 w-3.5" /> Edit Client
              </Button>
            )}

            {commercial && (
              <Button size="sm" variant="ghost" className="gap-1.5 border border-border" onClick={() => setLogging(true)}>
                <MessageSquare className="h-3.5 w-3.5" /> Log Activity
              </Button>
            )}

            {(activeModule === 'PM' || atLeast(role, 'MANAGER')) && (
              <Button size="sm" variant="primary" className="gap-1.5" onClick={() => setCreatingProject(true)}>
                <Plus className="h-3.5 w-3.5" /> New Project
              </Button>
            )}
          </div>
        </div>

        {/* Client Metadata Info Bar */}
        <div className="grid gap-3 pt-4 border-t border-border sm:grid-cols-2 lg:grid-cols-4 text-xs text-secondary">
          {client.email && (
            <div className="flex items-center gap-2 truncate">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={`mailto:${client.email}`} className="truncate hover:text-primary font-medium">
                {client.email}
              </a>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2 truncate">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={`tel:${client.phone}`} className="truncate hover:text-primary font-medium">
                {client.phone}
              </a>
            </div>
          )}
          {client.owner && (
            <div className="flex items-center gap-2 truncate">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">Owner: <strong className="text-primary">{client.owner.name}</strong></span>
            </div>
          )}
          {client.gstNumber && (
            <div className="flex items-center gap-2 truncate">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">GST: <strong className="text-primary font-mono">{client.gstNumber}</strong></span>
            </div>
          )}
        </div>

        {/* Commercial Revenue Summary Metric Banner */}
        {commercial && atLeast(role, 'SALES') && Number(client.monthlyValue) > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-surface border border-border p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary">Monthly Retainer Value</p>
              <p className="text-xl font-bold tracking-tight text-primary mt-0.5">{money(client.monthlyValue)}<span className="text-xs font-normal text-secondary"> / month</span></p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-secondary">{live.length} Active Engagement{live.length === 1 ? '' : 's'}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Sub Navigation Tabs ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1 max-w-full overflow-x-auto">
        <button
          onClick={() => setActiveTab('OVERVIEW')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'OVERVIEW'
              ? 'bg-white border border-border text-primary'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" /> Overview
        </button>

        <button
          onClick={() => setActiveTab('PROJECTS')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'PROJECTS'
              ? 'bg-white border border-border text-primary'
              : 'text-secondary hover:text-primary'
          }`}
        >
          <FolderKanban className="h-3.5 w-3.5" /> Projects ({client.projects.length})
        </button>

        {commercial && atLeast(role, 'SALES') && (
          <button
            onClick={() => setActiveTab('ENGAGEMENTS')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              activeTab === 'ENGAGEMENTS'
                ? 'bg-white border border-border text-primary'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <DollarSign className="h-3.5 w-3.5" /> Engagements ({live.length})
          </button>
        )}

        {activeModule === 'CRM' && atLeast(role, 'SALES') && (
          <button
            onClick={() => setActiveTab('DEALS')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              activeTab === 'DEALS'
                ? 'bg-white border border-border text-primary'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <FileText className="h-3.5 w-3.5" /> Deals ({client.deals.length})
          </button>
        )}

        {commercial && atLeast(role, 'ADMIN') && client.invoices.length > 0 && (
          <button
            onClick={() => setActiveTab('INVOICES')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              activeTab === 'INVOICES'
                ? 'bg-white border border-border text-primary'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Invoices ({client.invoices.length})
          </button>
        )}
      </div>

      {/* ── TAB CONTENT ──────────────────────────────────────────────────────── */}

      {activeTab === 'OVERVIEW' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left 2-Cols: Projects & Engagements Summary */}
          <div className="space-y-6 lg:col-span-2">
            {/* Active Projects */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">Active Projects</h3>
                {(activeModule === 'PM' || atLeast(role, 'MANAGER')) && (
                  <Button size="sm" variant="ghost" onClick={() => setCreatingProject(true)} className="text-xs">
                    + New Project
                  </Button>
                )}
              </div>

              {client.projects.length === 0 ? (
                <p className="text-xs text-secondary italic">No projects created yet for this client.</p>
              ) : (
                <div className="divide-y divide-border">
                  {client.projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-3">
                      <div>
                        <Link href={`/projects/${p.id}`} className="text-sm font-semibold text-primary hover:underline block">
                          {p.name}
                        </Link>
                        <span className="text-xs text-secondary">
                          Status: <span className="font-medium capitalize text-primary">{p.status.toLowerCase()}</span>
                        </span>
                      </div>
                      <span className="text-xs text-secondary font-medium">
                        Due {date(p.dueDate)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity Feed */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-primary">Activity Timeline</h3>
                {commercial && (
                  <Button size="sm" variant="ghost" onClick={() => setLogging(true)} className="text-xs">
                    + Log Activity
                  </Button>
                )}
              </div>
              <ActivityFeed
                items={client.activities.map((a) => ({
                  key: a.id,
                  at: a.occurredAt,
                  text: a.message,
                  body: a.body,
                  userName: a.user?.name,
                }))}
              />
            </div>
          </div>

          {/* Right Col: Stakeholders & Quick Info */}
          <div className="space-y-6">
            {/* Key Contacts — Only visible in CRM module */}
            {activeModule === 'CRM' && (
              <div className="rounded-xl border border-border bg-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-primary">Key Stakeholders</h3>
                  {atLeast(role, 'MANAGER') && (
                    <Button size="sm" variant="ghost" onClick={() => setCreatingContact(true)} className="text-xs">
                      + Add
                    </Button>
                  )}
                </div>

                {client.contacts.length === 0 ? (
                  <p className="text-xs text-secondary italic">No contacts added yet.</p>
                ) : (
                  <div className="space-y-3">
                    {client.contacts.map((c) => (
                      <div key={c.id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white text-xs font-bold">
                          {c.name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-xs font-semibold text-primary">{c.name}</p>
                            {c.isPrimary && <Star className="h-3 w-3 fill-amber-400 text-amber-500 shrink-0" />}
                          </div>
                          {c.designation && <p className="truncate text-[11px] text-secondary">{c.designation}</p>}
                          {c.email && (
                            <a href={`mailto:${c.email}`} className="truncate text-[11px] text-blue-600 hover:underline block mt-0.5">
                              {c.email}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick Details */}
            <div className="rounded-xl border border-border bg-white p-5 space-y-3 text-xs">
              <h3 className="text-sm font-bold text-primary mb-2">Company Information</h3>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-secondary font-medium">State / Region</span>
                <span className="font-semibold text-primary">{client.state ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-secondary font-medium">Account Owner</span>
                <span className="font-semibold text-primary">{client.owner?.name ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-secondary font-medium">GST / Tax ID</span>
                <span className="font-mono font-semibold text-primary">{client.gstNumber ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PROJECTS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'PROJECTS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-primary">All Projects ({client.projects.length})</h2>
            {(activeModule === 'PM' || atLeast(role, 'MANAGER')) && (
              <Button size="sm" variant="primary" onClick={() => setCreatingProject(true)}>
                + New Project
              </Button>
            )}
          </div>

          {client.projects.length === 0 ? (
            <EmptyState title="No Projects Found" hint="Create a new project for this client." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {client.projects.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-border bg-white p-4 space-y-3 hover:border-primary transition-colors cursor-pointer"
                  onClick={() => (window.location.href = `/projects/${p.id}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-primary truncate">{p.name}</h3>
                    <Badge tone="neutral" className="capitalize">{p.status.toLowerCase()}</Badge>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-secondary">
                    <span>Due Date</span>
                    <span className="font-semibold text-primary">{date(p.dueDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ENGAGEMENTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'ENGAGEMENTS' && commercial && atLeast(role, 'SALES') && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-primary">Engagements & Retainers</h2>
          {live.length === 0 ? (
            <EmptyState title="No Running Engagements" hint="There are no active retainers or projects for this client." />
          ) : (
            <div className="space-y-3">
              {live.map((e) => (
                <div key={e.id} className="rounded-xl border border-border bg-white p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-bold text-primary">
                        {money(e.amount)}{' '}
                        <span className="text-xs font-normal text-secondary">
                          {e.billingFrequency === 'ONE_TIME' ? 'one-time' : e.billingFrequency.toLowerCase()}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-secondary">
                        {e.type === 'RETAINER' ? 'Retainer' : 'Project'} · Started {date(e.startDate)}
                        {e.endDate ? ` · Ends ${date(e.endDate)}` : ' · Rolling contract'}
                      </p>
                    </div>

                    <span
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                        e.status === 'ACTIVE'
                          ? 'border-green-200 bg-green-50 text-green-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {e.status === 'ACTIVE' ? 'Active' : 'Paused'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-secondary">
                    {!e.endDate && e.nextReviewDate && (
                      <span className="inline-flex items-center gap-1.5">
                        <RefreshCw className="h-3.5 w-3.5 text-secondary" />
                        Price review due: <strong className="text-primary">{date(e.nextReviewDate)}</strong>
                      </span>
                    )}
                    {e.endDate && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-secondary" />
                        Renewal due: <strong className="text-primary">{date(e.endDate)}</strong>
                      </span>
                    )}

                    {atLeast(role, 'ADMIN') && (
                      <button
                        onClick={() => setReviewing(e)}
                        className="ml-auto rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-subtle transition-colors"
                      >
                        {e.endDate ? 'Renew Contract' : 'Review Price'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DEALS TAB ────────────────────────────────────────────────────────── */}
      {activeTab === 'DEALS' && activeModule === 'CRM' && atLeast(role, 'SALES') && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-primary">Deals & Opportunities</h2>
          {client.deals.length === 0 ? (
            <EmptyState title="No Deals Found" hint="No pipeline deals recorded for this client." />
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-white p-4">
              {client.deals.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/pipeline/${d.id}`} className="text-sm font-semibold text-primary hover:underline block">
                      {d.title ?? 'Untitled deal'}
                    </Link>
                    <span className="text-xs text-secondary font-medium">
                      Stage: {d.stage.name}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-primary">{money(d.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── INVOICES TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'INVOICES' && commercial && atLeast(role, 'ADMIN') && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-primary">Invoices</h2>
          {client.invoices.length === 0 ? (
            <EmptyState title="No Invoices Found" hint="No billing invoices recorded." />
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-white p-4">
              {client.invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-bold text-primary">{i.number}</p>
                    <p className="text-xs text-secondary">Issued {date(i.issueDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">{money(i.total)}</p>
                    <span className="text-xs uppercase font-semibold text-secondary">{i.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals & Dialogs */}
      {reviewing && (
        <ReviewPriceDialog
          engagement={reviewing}
          currency={currency}
          locale={locale}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            void load();
          }}
        />
      )}

      {creatingProject && (
        <NewProjectModal
          companyId={client.id}
          engagements={client.engagements}
          onConfirm={(project) => {
            setCreatingProject(false);
            window.location.href = `/projects/${project.id}`;
          }}
          onCancel={() => setCreatingProject(false)}
        />
      )}

      {creatingContact && (
        <NewContactModal
          companyId={client.id}
          onConfirm={() => {
            setCreatingContact(false);
            void load();
          }}
          onCancel={() => setCreatingContact(false)}
        />
      )}

      {editingClient && (
        <EditClientModal
          client={client}
          onConfirm={() => {
            setEditingClient(false);
            void load();
          }}
          onCancel={() => setEditingClient(false)}
        />
      )}

      <LogActivityDialog
        open={logging}
        companyId={client.id}
        onClose={() => setLogging(false)}
        onLogged={() => {
          setLogging(false);
          void load();
        }}
      />
    </div>
  );
}

function shapeOfWork(live: Engagement[]): string {
  if (live.length === 0) return 'No active work running';
  const types = Array.from(new Set(live.map((e) => e.type)));
  if (types.length === 2) return 'Retainer & project work running';
  return types[0] === 'RETAINER' ? 'Rolling retainer work' : 'Fixed project work';
}

function ReviewPriceDialog({
  engagement,
  currency,
  locale,
  onClose,
  onDone,
}: {
  engagement: Engagement;
  currency: string;
  locale: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(engagement.amount);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.companies.reviseEngagement(engagement.id, {
        amount,
        reason: reason || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revise price');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Revise Commercial Terms">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field
            label="New Amount"
            value={amount}
            onChange={setAmount}
            placeholder={engagement.amount}
            required
          />
          <Field
            label="Reason for Change"
            value={reason}
            onChange={setReason}
            placeholder="e.g. Scope increase or annual pricing review"
            required
          />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save New Terms
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
