'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { plural } from '@/lib/utils';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Building2, 
  ArrowLeft, 
  User as UserIcon, 
  FileText, 
  Receipt, 
  History, 
  Plus, 
  ExternalLink, 
  Mail, 
  Phone, 
  ShieldCheck, 
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Sparkles,
  Download,
  Pencil,
  Trophy,
  XCircle,
  MessageSquareQuote,
  ReceiptText,
  FolderPlus,
  FolderOpen,
  Briefcase,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, ApiError, formatMoney, formatDate } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuthStore } from '@/stores';
import { useConfirmStore } from '@/stores/confirm';
import { EditCompanyModal } from '@/components/clients/EditCompanyModal';
import { EditProformaModal } from '@/components/clients/EditProformaModal';
import { NewProposalModal } from '@/components/clients/NewProposalModal';
import { AddVersionModal } from '@/components/clients/AddVersionModal';
import { LoseProposalModal } from '@/components/clients/LoseProposalModal';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import { NewProjectModal } from '@/components/clients/NewProjectModal';
import { NewRetainerModal } from '@/components/clients/NewRetainerModal';

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const { id } = resolvedParams;
  const { user } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') || 'OVERVIEW').toUpperCase();

  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'WORK' | 'PROPOSALS' | 'MONEY' | 'AUDIT'>(
    ['OVERVIEW', 'WORK', 'PROPOSALS', 'MONEY', 'AUDIT'].includes(initialTab) ? (initialTab as any) : 'OVERVIEW',
  );

  const [isEditCompanyOpen, setIsEditCompanyOpen] = useState(false);
  const [editingProforma, setEditingProforma] = useState<any>(null);
  const [isNewProposalOpen, setIsNewProposalOpen] = useState(false);
  const [addingVersionFor, setAddingVersionFor] = useState<any>(null);
  const [losingProposal, setLosingProposal] = useState<any>(null);
  const [raisingProformaFor, setRaisingProformaFor] = useState<any>(null);
  const [creatingProjectFor, setCreatingProjectFor] = useState<{
    companyId: string;
    companyName: string;
    quotedValue: number;
    sourceProposalId: string;
  } | null>(null);
  const [creatingRetainerFor, setCreatingRetainerFor] = useState<{
    companyId: string;
    companyName: string;
    monthlyValue: number;
    sourceProposalId: string;
  } | null>(null);
  const { confirm } = useConfirmStore();

  // Add person modal
  const [isAddPersonOpen, setIsAddPersonOpen] = useState(false);
  const [personName, setPersonName] = useState('');
  const [personRole, setPersonRole] = useState<'APPROVER' | 'PAYER' | 'CONTACT'>('CONTACT');
  const [personEmail, setPersonEmail] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.companies.get(id);
      if (res && (res as any).company) {
        setCompany((res as any).company);
      } else {
        setCompany(res);
      }
    } catch (err) {
      console.error('Failed to load company detail:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  /** Typed something, and it is not an address. Blank stays blank — email is optional. */
  const emailLooksWrong = personEmail.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personEmail.trim());

  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personName.trim()) return;
    setAddingPerson(true);
    try {
      await api.companies.addContact(id, {
        name: personName.trim(),
        role: personRole,
        email: personEmail.trim() || undefined,
        phone: personPhone.trim() || undefined,
      });
      setIsAddPersonOpen(false);
      setPersonName('');
      setPersonEmail('');
      setPersonPhone('');
      await fetchDetail();
    } catch (err) {
      // The API rejects a malformed email with a readable reason ("Invalid
      // email"). This sent it to console.error and left the modal sitting open
      // with nothing on screen, so the only signal that anything went wrong was
      // that the contact never appeared.
      toast.error(err instanceof ApiError ? err.message : 'Could not add this contact');
    } finally {
      setAddingPerson(false);
    }
  };

  const handleMarkWon = async (proposalId: string, versionId: string, versionN: number, value: number) => {
    const ok = await confirm({
      title: 'Mark this proposal won?',
      message: `Won on v${versionN} (${formatMoney(value)}). ${company.name} moves to Client and this proposal locks — no more versions.`,
      confirmText: 'Mark won',
      variant: 'info',
    });
    if (!ok) return;
    try {
      await api.proposals.win(proposalId, versionId);
      toast.success('Proposal won');
      await fetchDetail();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not mark this proposal won');
    }
  };

  const handleVerbalYes = async (proposalId: string) => {
    const ok = await confirm({
      title: 'Flag verbal yes?',
      message: 'The client has agreed verbally, before anything is signed. This is a manual flag only — winning still needs the actual win step.',
      confirmText: 'Flag it',
      variant: 'info',
    });
    if (!ok) return;
    try {
      await api.proposals.updateStage(proposalId, 'VERBAL_YES');
      toast.success('Flagged verbal yes');
      await fetchDetail();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not flag verbal yes');
    }
  };

  if (loading) {
    return (
      <div className="page-shell space-y-6">
        <div className="h-8 w-48 bg-subtle rounded-xl animate-pulse" />
        <div className="h-64 bg-subtle rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="page-shell py-20 text-center">
        <Building2 className="w-12 h-12 text-muted mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-primary">Company Not Found</h2>
        <p className="text-sm text-secondary mt-1">This client record does not exist or has been removed.</p>
        <Link href="/companies" className="mt-4 inline-block text-sm text-primary font-medium underline">
          Back to Directory
        </Link>
      </div>
    );
  }

  /**
   * The work this client has, split the way the brief splits money: a retainer
   * is recurring, a project is one-off, and the two are never mixed together.
   *
   * `ACTIVE` rather than `retainers[0]`, which took whichever was created most
   * recently regardless of whether it had lapsed.
   */
  const activeRetainer = company.retainers?.find((r: any) => r.status === 'ACTIVE') ?? null;
  const pastRetainers = (company.retainers ?? []).filter((r: any) => r.status !== 'ACTIVE');
  const liveProjects = (company.projects ?? []).filter((pr: any) => pr.status === 'LIVE');
  const pastProjects = (company.projects ?? []).filter((pr: any) => pr.status !== 'LIVE');

  return (
    <div className="page-shell space-y-6">
      {/* ── Top Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Link
            href="/companies"
            className="p-2 rounded-xl border border-border hover:bg-subtle text-secondary hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-primary/20"
            aria-label="Back to Company Directory"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-primary text-pretty">
                {company.name}
              </h1>
              <span className={`eyebrow px-2 py-0.5 rounded-full border ${
                company.status === 'CLIENT'
                  ? 'bg-success-tint text-success border-success/30'
                  : company.status === 'PROSPECT'
                  ? 'bg-info-tint text-info border-info/30'
                  : 'bg-subtle text-secondary border-border'
              }`}>
                {company.status}
              </span>
            </div>
            <p className="text-xs text-secondary mt-0.5">
              {company.vertical?.replace(/_/g, ' ')} · {company.city}
              {company.website && (
                <> · <a href={company.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">{company.website.replace(/^https?:\/\//, '')}</a></>
              )}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setIsEditCompanyOpen(true)}>
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </Button>
      </div>

      {/*
        The last hand-drawn tab row in the product. It was a seventh copy of
        the same eight lines, and the only one that set its own padding and
        weight — so this screen's tabs sat a shade taller and bolder than the
        identical control on every other screen.

        The counts move out of the label strings and into `count`, so they are
        rendered the same way here as everywhere else rather than being spelled
        into the text by hand.
      */}
      <Tabs
        tabs={[
          { key: 'OVERVIEW', label: 'Overview & People', icon: Building2 },
          // The work itself had no tab. A company's projects appeared in
          // exactly one place — the engagement card, which shows the retainer
          // OR, only when there is no retainer, the FIRST project — so a
          // client with a retainer and two projects showed neither.
          {
            key: 'WORK',
            label: 'Work',
            icon: Briefcase,
            count: (company.retainers?.length || 0) + (company.projects?.length || 0),
          },
          { key: 'PROPOSALS', label: 'Proposals', icon: FileText, count: company.proposals?.length || 0 },
          {
            key: 'MONEY',
            label: 'Invoices & Proformas',
            icon: Receipt,
            count: (company.invoices?.length || 0) + (company.proformas?.length || 0),
          },
          { key: 'AUDIT', label: 'Audit Trail', icon: History },
        ] as TabDef<typeof activeTab>[]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* ── Tab 1: Overview & People ── */}
      {activeTab === 'OVERVIEW' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: People & Contacts */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-5">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Key Decision Makers & Contacts</h3>
                  <p className="text-xs text-secondary">Approvers and financial payers for this client.</p>
                </div>
                <Button
                  onClick={() => setIsAddPersonOpen(true)}
                  className="bg-primary text-white hover:bg-primary/90 rounded-xl px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Person</span>
                </Button>
              </div>

              {!company.people || company.people.length === 0 ? (
                <p className="text-xs text-muted py-4 text-center">No contact persons listed yet.</p>
              ) : (
                <div className="space-y-3">
                  {company.people.map((p: any) => (
                    <div
                      key={p.id}
                      className="p-3.5 bg-subtle/40 border border-border rounded-xl flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-primary">{p.name}</span>
                          <span className={`eyebrow px-2 py-0.5 rounded border ${
                            p.role === 'APPROVER'
                              ? 'bg-warning-tint text-warning-ink border-warning/30'
                              : p.role === 'PAYER'
                              ? 'bg-success-tint text-success border-success/30'
                              : 'bg-subtle text-secondary border-border'
                          }`}>
                            {p.role}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-secondary">
                          {p.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-muted" />
                              <a href={`mailto:${p.email}`} className="hover:underline">{p.email}</a>
                            </span>
                          )}
                          {p.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3 text-muted" />
                              <a href={`tel:${p.phone}`} className="hover:underline">{p.phone}</a>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Active Commercial Work */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-primary pb-3 mb-4 border-b border-border">
                Active Commercial Commitments
              </h3>

              {/*
                Retainer AND projects, not one or the other.

                This was an if/else, so a client with a retainer and two
                projects — which is most of them — showed no projects at all,
                and a client with three showed the first. `formatMoney` rather
                than `Number(x).toLocaleString`, because the API masks a figure
                to NULL for somebody without money.figures and `Number(null)`
                is 0: Business Development was being shown "₹0/mo" for a live
                retainer.
              */}
              {activeRetainer && (
                <div className="p-4 bg-success-tint/40 border border-success/30 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="eyebrow text-success">
                        Active Retainer
                      </span>
                      <h4 className="text-base font-semibold text-primary mt-0.5">
                        {activeRetainer.monthlyValue === null
                          ? 'Hidden'
                          : `${formatMoney(activeRetainer.monthlyValue)}/mo`}
                      </h4>
                      <p className="text-xs text-secondary mt-1">
                        Started {formatDate(activeRetainer.startDate)}
                        {activeRetainer.termMonths ? ` · ${activeRetainer.termMonths}-month term` : ' · Continuous'}
                      </p>
                    </div>
                    {activeRetainer.renewalDate && (
                      <div className="text-right">
                        <span className="text-micro text-secondary">Renews</span>
                        <div className="text-xs font-semibold text-primary">
                          {formatDate(activeRetainer.renewalDate)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {liveProjects.length > 0 && (
                <div className={activeRetainer ? 'mt-3 space-y-2' : 'space-y-2'}>
                  {liveProjects.map((pr: any) => (
                    <Link
                      key={pr.id}
                      href={`/projects/${pr.id}`}
                      className="block rounded-xl border border-info/30 bg-info-tint/40 p-4 transition-colors hover:bg-info-tint/70 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="eyebrow text-info">
                        Live Project
                      </span>
                      <h4 className="text-base font-semibold text-primary mt-0.5">{pr.name}</h4>
                      <p className="text-xs text-secondary mt-1">
                        Quoted: {pr.quotedValue === null ? 'Hidden' : formatMoney(pr.quotedValue)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {pastProjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('WORK')}
                  className="mt-3 rounded-sm text-xs font-medium text-secondary underline underline-offset-2 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {plural(pastProjects.length, 'finished project')} — see all work
                </button>
              )}

              {!activeRetainer && liveProjects.length === 0 && pastProjects.length === 0 && (
                <p className="text-xs text-muted py-3">No active retainer or project linked.</p>
              )}
            </Card>
          </div>

          {/* Right Col: Details Card */}
          <div className="space-y-6">
            <Card className="p-5 space-y-4">
              <h3 className="text-sm font-semibold text-primary pb-2 border-b border-border">
                Company Details
              </h3>
              <div>
                <span className="eyebrow text-muted block">Account Owner</span>
                <span className="text-sm font-medium text-primary">{company.owner?.name || 'Unassigned'}</span>
              </div>
              <div>
                <span className="eyebrow text-muted block">GSTIN</span>
                <span className="text-sm font-mono text-primary">{company.gstin || 'Not registered'}</span>
              </div>
              <div>
                <span className="eyebrow text-muted block">Billing Address</span>
                <span className="text-xs text-body leading-relaxed">{company.billingAddress || 'No billing address specified.'}</span>
              </div>
              <div>
                <span className="eyebrow text-muted block">Source</span>
                <span className="text-xs text-secondary">{company.source}</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── Tab 2: Proposals Version Tree ── */}
      {/*
        Everything this client has paid us to do, in one place.

        Before this there was nowhere: the engagement card showed the retainer
        or a single project, and a project only reached a link at all if it had
        been created from a won proposal. Da One High Performance Sports had a
        retainer and two projects — ₹95,000 delivered, ₹60,000 live — and not
        one of the three was reachable from this page.
      */}
      {activeTab === 'WORK' && (
        <div className="space-y-6">
          <Card padding="none">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-primary">Retainers</h3>
                <p className="text-micro text-secondary mt-0.5">Recurring monthly work</p>
              </div>
              <span className="text-micro text-secondary">{plural(company.retainers?.length ?? 0, 'retainer')}</span>
            </div>
            {(company.retainers?.length ?? 0) === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-secondary">No retainer with this client.</p>
            ) : (
              <div className="divide-y divide-border">
                {[...(activeRetainer ? [activeRetainer] : []), ...pastRetainers].map((r: any) => (
                  <Link
                    key={r.id}
                    href={`/retainers/${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-subtle outline-none focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary">
                        {r.monthlyValue === null ? 'Hidden' : `${formatMoney(r.monthlyValue)}/mo`}
                      </p>
                      <p className="text-micro text-secondary mt-0.5">
                        Started {formatDate(r.startDate)}
                        {r.termMonths ? ` · ${r.termMonths}-month term` : ' · Continuous'}
                        {r.renewalDate ? ` · renews ${formatDate(r.renewalDate)}` : ''}
                      </p>
                    </div>
                    <Badge tone={r.status === 'ACTIVE' ? 'good' : 'neutral'}>
                      {r.status === 'ACTIVE' ? 'Active' : r.status.toLowerCase()}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card padding="none">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-primary">Projects</h3>
                {/* Brief §8: retainer and one-time money are never summed, so
                    the two are counted separately and never added up here. */}
                <p className="text-micro text-secondary mt-0.5">One-off work, whole contract</p>
              </div>
              <span className="text-micro text-secondary">{plural(company.projects?.length ?? 0, 'project')}</span>
            </div>
            {(company.projects?.length ?? 0) === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-secondary">No projects for this client yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {[...liveProjects, ...pastProjects].map((pr: any) => {
                  const paid = (pr.milestones ?? []).filter((m: any) => m.status === 'PAID').length;
                  const total = (pr.milestones ?? []).length;
                  return (
                    <Link
                      key={pr.id}
                      href={`/projects/${pr.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-subtle outline-none focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary">{pr.name}</p>
                        <p className="text-micro text-secondary mt-0.5">
                          {pr.quotedValue === null ? 'Value hidden' : formatMoney(pr.quotedValue)}
                          {pr.startDate ? ` · ${formatDate(pr.startDate)}` : ''}
                          {total > 0 ? ` · ${paid}/${total} milestones paid` : ''}
                        </p>
                      </div>
                      <Badge
                        tone={pr.status === 'LIVE' ? 'good' : pr.status === 'DELIVERED' ? 'info' : 'neutral'}
                      >
                        {pr.status === 'LIVE' ? 'Live' : pr.status === 'DELIVERED' ? 'Delivered' : 'Cancelled'}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'PROPOSALS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Button variant="primary" onClick={() => setIsNewProposalOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              New proposal
            </Button>
          </div>

          {!company.proposals || company.proposals.length === 0 ? (
            <Card className="p-12 text-center">
              <FileText className="w-10 h-10 text-muted mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-primary">No Proposals</h3>
              <p className="text-xs text-secondary mt-1">No commercial proposals have been sent to this company yet.</p>
            </Card>
          ) : (
            company.proposals.map((prop: any) => {
              const live = !prop.outcome;
              const latestN = prop.versions?.[0]?.n ?? 0;
              const latestVersion = prop.versions?.[0];
              const linkedProject = company.projects?.find((p: any) => p.sourceProposalId === prop.id);
              const linkedRetainer = company.retainers?.find((r: any) => r.sourceProposalId === prop.id);
              return (
                <Card key={prop.id} className="p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-primary">
                        {prop.kind === 'RETAINER' ? 'Monthly Retainer Proposal' : 'Project Quotation'}
                      </h3>
                      <span className="eyebrow px-2 py-0.5 rounded bg-subtle border border-border">
                        {prop.stage.replace(/_/g, ' ')}
                      </span>
                      {prop.outcome === 'LOST' && (
                        <span className="eyebrow px-2 py-0.5 rounded bg-danger-tint border border-danger/30 text-danger">
                          Lost
                        </span>
                      )}
                    </div>
                    {prop.wonVersion && (
                      <span className="text-xs font-semibold text-success bg-success-tint border border-success/30 px-2.5 py-1 rounded-lg">
                        Won on v{prop.wonVersion.n} ({formatMoney(prop.wonVersion.value)})
                      </span>
                    )}
                  </div>

                  {/* Versions Tree */}
                  <div className="space-y-2">
                    {prop.versions?.map((v: any) => (
                      <div
                        key={v.id}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                          prop.wonVersionId === v.id
                            ? 'bg-success-tint/40 border-success/30'
                            : 'bg-subtle/40 border-border'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-primary">v{v.n}</span>
                            <span className="text-xs font-mono font-semibold tabular-nums text-primary">
                              {formatMoney(v.value)}
                            </span>
                            <span className="text-xs text-muted">· {formatDate(v.sentAt)}</span>
                          </div>
                          <p className="text-xs text-body mt-1">{v.scopeSummary}</p>
                        </div>
                        {live && prop.wonVersionId !== v.id && (
                          <button
                            type="button"
                            onClick={() => handleMarkWon(prop.id, v.id, v.n, Number(v.value))}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-success border border-success/30 rounded-lg hover:bg-success-tint transition-colors shrink-0"
                          >
                            <Trophy className="w-3.5 h-3.5" />
                            Mark won
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {prop.versions?.length > 1 && (() => {
                    const v1 = prop.versions[prop.versions.length - 1];
                    const latest = prop.versions[0];
                    if (v1?.value == null || latest?.value == null) return null;
                    const given = Number(v1.value) - Number(latest.value);
                    if (given <= 0) return null;
                    const pct = Math.round((given / Number(v1.value)) * 100);
                    return (
                      <p className="text-xs text-secondary pt-1">
                        Given away in negotiation: <span className="font-semibold text-primary">{formatMoney(given)}</span>, {pct}%.
                        Counts as one proposal in the close rate, not {prop.versions.length}.
                      </p>
                    );
                  })()}

                  {prop.outcome === 'WON' && prop.kind === 'PROJECT' && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      {linkedProject ? (
                        <Link
                          href={`/projects/${linkedProject.id}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          {linkedProject.name} — open project
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setCreatingProjectFor({
                              companyId: company.id,
                              companyName: company.name,
                              quotedValue: Number(prop.wonVersion?.value ?? 0),
                              sourceProposalId: prop.id,
                            })
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          Create project from this
                        </button>
                      )}
                    </div>
                  )}

                  {prop.outcome === 'WON' && prop.kind === 'RETAINER' && (
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      {linkedRetainer ? (
                        <Link
                          href={`/retainers/${linkedRetainer.id}`}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Open retainer
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setCreatingRetainerFor({
                              companyId: company.id,
                              companyName: company.name,
                              monthlyValue: Number(prop.wonVersion?.value ?? 0),
                              sourceProposalId: prop.id,
                            })
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          Create retainer from this
                        </button>
                      )}
                    </div>
                  )}

                  {live && (
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
                      <button
                        type="button"
                        onClick={() => setAddingVersionFor({ id: prop.id, nextVersionNumber: latestN + 1 })}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg hover:bg-subtle transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Add version
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRaisingProformaFor({
                            id: prop.id,
                            defaultAmount: Number(latestVersion?.value ?? 0),
                          })
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg hover:bg-subtle transition-colors"
                      >
                        <ReceiptText className="w-3.5 h-3.5" />
                        Raise proforma
                      </button>
                      {prop.stage === 'PROFORMA_ISSUED' && (
                        <button
                          type="button"
                          onClick={() => handleVerbalYes(prop.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg hover:bg-subtle transition-colors"
                        >
                          <MessageSquareQuote className="w-3.5 h-3.5" />
                          Mark verbal yes
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setLosingProposal(prop.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary hover:text-danger border border-border rounded-lg hover:bg-danger-tint transition-colors ml-auto"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Mark lost
                      </button>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ── Tab 3: Money (Invoices & Proformas) ── */}
      {activeTab === 'MONEY' && (
        <div className="space-y-6">
          {/* Proformas */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-primary pb-3 mb-4 border-b border-border">
              Advance Proforma Invoices
            </h3>
            {!company.proformas || company.proformas.length === 0 ? (
              <p className="text-xs text-muted py-2">No proforma advance requests generated.</p>
            ) : (
              <div className="space-y-2">
                {company.proformas.map((pi: any) => (
                  <div key={pi.id} className="p-3 bg-subtle/40 border border-border rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-primary">{pi.number}</span>
                        <span className={`eyebrow px-2 py-0.5 rounded border ${
                          pi.status === 'PAID' ? 'bg-success-tint text-success border-success/30' : 'bg-warning-tint text-warning-ink border-warning/30'
                        }`}>
                          {pi.status}
                        </span>
                      </div>
                      <span className="text-xs text-secondary">Valid till {formatDate(pi.validTill)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-primary tabular-nums">
                        {formatMoney(pi.amount)}
                      </span>
                      {pi.status === 'UNPAID' && (
                        <button
                          type="button"
                          onClick={() => setEditingProforma(pi)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg hover:bg-subtle transition-colors"
                          title="Edit proforma"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )}
                      <a
                        href={api.proformas.pdfUrl(pi.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg hover:bg-subtle transition-colors"
                        title="Download proforma PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Tax Invoices */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-primary pb-3 mb-4 border-b border-border">
              Tax Invoices (Tally Mirror)
            </h3>
            {!company.invoices || company.invoices.length === 0 ? (
              <p className="text-xs text-muted py-2">No tax invoices recorded.</p>
            ) : (
              <div className="space-y-2">
                {company.invoices.map((inv: any) => (
                  <div key={inv.id} className="p-3 bg-subtle/40 border border-border rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-primary">{inv.number}</span>
                        <span className={`eyebrow px-2 py-0.5 rounded border ${
                          inv.status === 'PAID' ? 'bg-success-tint text-success border-success/30' : 'bg-danger-tint text-danger border-danger/30'
                        }`}>
                          {inv.status}
                        </span>
                      </div>
                      <span className="text-xs text-secondary">Due {formatDate(inv.dueAt)}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-sm font-semibold text-primary tabular-nums block">
                        {formatMoney(inv.amount)}
                      </span>
                      {inv.paidAt && (
                        <span className="text-micro text-success">Paid {formatDate(inv.paidAt)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Tab 4: Audit Trail ── */}
      {activeTab === 'AUDIT' && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-primary pb-3 mb-4 border-b border-border">
            Activity & Audit History
          </h3>
          {!company.activities || company.activities.length === 0 ? (
            <p className="text-xs text-muted py-2">No recorded activities for this company.</p>
          ) : (
            <div className="space-y-3">
              {company.activities.map((a: any) => (
                <div key={a.id} className="text-xs flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-primary">{a.actor?.name || 'System'}</span>
                    <span className="text-secondary">{a.verb.replace(/_/g, ' ')}</span>
                  </div>
                  <span className="text-muted">{formatDate(a.at, 'Asia/Kolkata', 'en-IN', true)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Add Person Modal ── */}
      {isAddPersonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white border border-border rounded-xl shadow-modal w-full max-w-md p-6 animate-in zoom-in-95">
            <h2 className="text-lg font-semibold text-primary">Add Contact Person</h2>
            <p className="text-xs text-secondary mt-1">Add a key contact, approver, or billing payer for {company.name}.</p>

            <form onSubmit={handleAddPerson} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-body mb-1" htmlFor="full-name">Full Name *</label>
                <input id="full-name"
                  type="text"
                  required
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="e.g. Dr. Bidya"
                  className="w-full px-3 py-2 text-sm bg-white border border-border rounded-xl text-primary placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-body mb-1" htmlFor="role">Role</label>
                <select id="role"
                  value={personRole}
                  onChange={(e) => setPersonRole(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm bg-white border border-border rounded-xl text-body focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                >
                  <option value="APPROVER">APPROVER (Signs off scope/work)</option>
                  <option value="PAYER">PAYER (Handles finance/accounts)</option>
                  <option value="CONTACT">CONTACT (General contact)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-body mb-1" htmlFor="email">Email</label>
                  <input id="email"
                    type="email"
                    value={personEmail}
                    onChange={(e) => setPersonEmail(e.target.value)}
                    placeholder="email@company.com"
                    aria-invalid={emailLooksWrong}
                    className={`w-full px-3 py-2 text-sm bg-white border rounded-xl text-primary placeholder:text-muted focus-visible:ring-2 focus-visible:outline-none ${
                      emailLooksWrong
                        ? 'border-danger focus-visible:ring-danger/20'
                        : 'border-border focus-visible:ring-primary/20'
                    }`}
                  />
                  {/*
                    Said here, in the app's own voice. `type="email"` already
                    blocked the submit, but the only feedback was the browser's
                    native bubble — so the form read as a button that does
                    nothing, which is how this was reported.
                  */}
                  {emailLooksWrong && (
                    <p className="mt-1 text-micro text-danger">
                      That is not a complete email address.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-body mb-1" htmlFor="phone">Phone</label>
                  <input id="phone"
                    type="tel"
                    value={personPhone}
                    onChange={(e) => setPersonPhone(e.target.value)}
                    placeholder="+91 98401 00000"
                    className="w-full px-3 py-2 text-sm bg-white border border-border rounded-xl text-primary placeholder:text-muted focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                <Button
                  type="button"
                  onClick={() => setIsAddPersonOpen(false)}
                  className="bg-subtle text-secondary hover:text-primary rounded-xl px-4 py-2 text-sm font-medium"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={addingPerson || !personName.trim() || emailLooksWrong}
                  className="bg-primary text-white hover:bg-primary/90 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {addingPerson ? 'Adding…' : 'Add Person'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditCompanyOpen && (
        <EditCompanyModal
          company={company}
          onCancel={() => setIsEditCompanyOpen(false)}
          onConfirm={() => {
            setIsEditCompanyOpen(false);
            fetchDetail();
          }}
        />
      )}

      {editingProforma && (
        <EditProformaModal
          proforma={editingProforma}
          onCancel={() => setEditingProforma(null)}
          onConfirm={() => {
            setEditingProforma(null);
            fetchDetail();
          }}
        />
      )}

      {isNewProposalOpen && (
        <NewProposalModal
          companyId={company.id}
          companyName={company.name}
          onCancel={() => setIsNewProposalOpen(false)}
          onConfirm={() => {
            setIsNewProposalOpen(false);
            fetchDetail();
          }}
        />
      )}

      {addingVersionFor && (
        <AddVersionModal
          proposalId={addingVersionFor.id}
          nextVersionNumber={addingVersionFor.nextVersionNumber}
          onCancel={() => setAddingVersionFor(null)}
          onConfirm={() => {
            setAddingVersionFor(null);
            fetchDetail();
          }}
        />
      )}

      {losingProposal && (
        <LoseProposalModal
          proposalId={losingProposal}
          onCancel={() => setLosingProposal(null)}
          onConfirm={() => {
            setLosingProposal(null);
            fetchDetail();
          }}
        />
      )}

      {raisingProformaFor && (
        <NewProformaModal
          companyId={company.id}
          companyName={company.name}
          source={{ type: 'PROPOSAL', proposalId: raisingProformaFor.id }}
          defaultAmount={raisingProformaFor.defaultAmount}
          onCancel={() => setRaisingProformaFor(null)}
          onConfirm={() => {
            setRaisingProformaFor(null);
            fetchDetail();
          }}
        />
      )}

      <NewProjectModal
        open={Boolean(creatingProjectFor)}
        onClose={() => setCreatingProjectFor(null)}
        prefill={creatingProjectFor ?? undefined}
        onCreated={(id) => {
          setCreatingProjectFor(null);
          toast.success('Project created');
          router.push(`/projects/${id}`);
        }}
      />

      <NewRetainerModal
        open={Boolean(creatingRetainerFor)}
        onClose={() => setCreatingRetainerFor(null)}
        prefill={creatingRetainerFor ?? undefined}
        onCreated={(id) => {
          setCreatingRetainerFor(null);
          toast.success('Retainer created');
          router.push(`/retainers/${id}`);
        }}
      />
    </div>
  );
}
