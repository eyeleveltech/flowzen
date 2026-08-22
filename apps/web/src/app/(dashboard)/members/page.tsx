'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  X,
  Mail,
  KeyRound,
  UserPlus,
  UserMinus,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  Briefcase,
  ChevronRight,
  Filter,
  RotateCcw,
  Check,
  Building,
  Calendar,
  Layers,
  Copy,
  Phone,
  Shield,
  ArrowUpRight,
  Crown,
  Lock,
} from 'lucide-react';
import {
  api,
  ApiError,
  atLeast,
  formatDate,
  type Member,
  type MemberProject,
  type MemberTask,
  type OrgConfig,
  type Role,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { EmptyState, ErrorNote, Note } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/skeleton-loaders';
import { Drawer } from '@/components/ui/drawer';
import { getInitials, getAvatarColor } from '@/lib/utils';

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALES: 'Sales',
  MEMBER: 'Member',
};

const ROLE_HINT: Record<Role, string> = {
  SUPER_ADMIN: 'Owns the organisation. One person, transferred rather than granted.',
  ADMIN: 'Everything, including money.',
  MANAGER: 'Runs delivery and the team. No money.',
  SALES: 'The pipeline, quotations and clients.',
  MEMBER: 'Their own work.',
};

const ORDER: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES', 'MEMBER'];

const ROLE_OPTIONS: Option[] = ORDER.map((r) => ({
  value: r,
  label: ROLE_LABEL[r],
  sublabel: ROLE_HINT[r],
}));

const STATUS_OPTIONS: Option[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Invited' },
  { value: 'INACTIVE', label: 'Retired' },
];

const STATUS: Record<Member['status'], { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'good' },
  PENDING: { label: 'Invited', tone: 'warn' },
  INACTIVE: { label: 'Retired', tone: 'neutral' },
};

const PRIORITY_TONE: Record<string, 'good' | 'neutral' | 'bad' | 'info' | 'warn'> = {
  LOW: 'info',
  MEDIUM: 'neutral',
  HIGH: 'warn',
  URGENT: 'bad',
};

type LinkKind = 'invite' | 'reset';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string; kind: LinkKind } | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [list, cfg] = await Promise.all([api.users.list(), api.config.get()]);
      setMembers(Array.isArray(list) ? (list as Member[]) : []);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const me = config?.me;
  const myRole = me?.role as Role | undefined;
  const canManage = atLeast(myRole, 'ADMIN');
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const locale = config?.organization.locale ?? 'en-IN';

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  const changeRole = (member: Member, role: Role) =>
    act(member.id, async () => {
      const result = await api.users.setRole(member.id, role);
      if (result.message) setNote(result.message);
    });

  // Extract unique departments from members
  const departmentOptions: Option[] = useMemo(() => {
    const deptMap = new Map<string, string>();
    members.forEach((m) => {
      if (m.department) {
        deptMap.set(m.department.id, m.department.name);
      }
    });
    return Array.from(deptMap.entries()).map(([id, name]) => ({
      value: id,
      label: name,
    }));
  }, [members]);

  // Client-side filtering
  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.designation && m.designation.toLowerCase().includes(q)) ||
          (m.department?.name && m.department.name.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (selectedRoles.length > 0 && !selectedRoles.includes(m.role)) {
        return false;
      }
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(m.status)) {
        return false;
      }
      if (selectedDepartments.length > 0 && (!m.department || !selectedDepartments.includes(m.department.id))) {
        return false;
      }
      return true;
    });
  }, [members, search, selectedRoles, selectedStatuses, selectedDepartments]);

  const hasFilters = Boolean(
    search ||
    selectedRoles.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedDepartments.length > 0
  );

  const clearFilters = () => {
    setSearch('');
    setSelectedRoles([]);
    setSelectedStatuses([]);
    setSelectedDepartments([]);
  };

  if (loading) return <TableSkeleton rows={4} />;

  return (
    <>
      <div className="space-y-5 pb-10">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">Team Members</h1>
          </div>

          {canManage && (
            <Button variant="primary" icon={Plus} onClick={() => setInviting(true)}>
              Invite Member
            </Button>
          )}
        </div>

        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
        {note && <Note tone="info">{note}</Note>}

        {/* Filter Toolbar */}
        <div className="rounded-xl border border-border bg-white p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Box */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search member name, email, designation..."
                className="w-full rounded-xl border border-border bg-white pl-9 pr-8 py-1.5 text-sm text-body placeholder:text-muted focus:border-primary focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-2.5 text-muted hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Custom MultiSelect Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-subtle">
            <div className="flex items-center gap-1 text-xs font-medium text-muted mr-1">
              <Filter className="h-3.5 w-3.5" /> Filters:
            </div>

            {/* Role Filter */}
            <div className="w-34">
              <MultiSelect
                compact={true}
                placeholder="All Roles"
                options={ROLE_OPTIONS}
                value={selectedRoles}
                onChange={setSelectedRoles}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>

            {/* Status Filter */}
            <div className="w-32">
              <MultiSelect
                compact={true}
                placeholder="All Statuses"
                options={STATUS_OPTIONS}
                value={selectedStatuses}
                onChange={setSelectedStatuses}
                triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
              />
            </div>

            {/* Department Filter */}
            {departmentOptions.length > 0 && (
              <div className="w-38">
                <MultiSelect
                  compact={true}
                  placeholder="All Departments"
                  options={departmentOptions}
                  value={selectedDepartments}
                  onChange={setSelectedDepartments}
                  triggerClassName="h-8.5 px-3 py-1 text-xs rounded-lg bg-surface border-border"
                />
              </div>
            )}

            {/* Clear Filters */}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors ml-auto"
              >
                <RotateCcw className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Member Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilters ? 'No matching members found' : 'Nobody here yet'}
            hint={hasFilters ? 'Try adjusting your filters.' : 'Invite the people you work with.'}
          />
        ) : (
          <Table>
            <THead>
              <TR className="bg-surface hover:bg-surface">
                <TH>MEMBER</TH>
                <TH>DESIGNATION & DEPT</TH>
                <TH>ROLE</TH>
                <TH>PROJECTS</TH>
                <TH>TASKS OVERVIEW</TH>
                <TH>STATUS</TH>
                <TH className="text-right">ACTIONS</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((m) => {
                const isMe = m.id === me?.userId;
                const editable = canManage && !isMe && m.status !== 'INACTIVE';
                const openCount = m.taskStats?.open ?? 0;
                const inReviewCount = m.taskStats?.inReview ?? 0;
                const overdueCount = m.taskStats?.overdue ?? 0;
                const activeProjectsCount = m.activeProjectsCount ?? 0;

                return (
                  <TR
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    className="cursor-pointer hover:bg-subtle transition-colors group"
                  >
                    {/* 1. Member Profile */}
                    <TD>
                      <div className="flex items-center gap-3">
                        {m.avatar ? (
                          <img
                            src={m.avatar}
                            alt=""
                            className="h-9 w-9 rounded-full object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${getAvatarColor(
                              m.name
                            )}`}
                          >
                            {getInitials(m.name)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-primary text-sm truncate flex items-center gap-1.5">
                            {m.name}
                            {isMe && (
                              <span className="text-[10px] font-medium px-1.5 py-0.2 bg-subtle text-secondary rounded">
                                you
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-secondary truncate">{m.email}</p>
                        </div>
                      </div>
                    </TD>

                    {/* 2. Designation & Department */}
                    <TD>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-primary truncate">
                          {m.designation || 'Team Member'}
                        </span>
                        {m.department && (
                          <span className="text-[11px] text-secondary truncate">
                            {m.department.name}
                          </span>
                        )}
                      </div>
                    </TD>

                    {/* 3. Role */}
                    <TD onClick={(e) => editable && e.stopPropagation()}>
                      {editable ? (
                        <div className="w-34">
                          <Select
                            value={m.role}
                            onChange={(v) => changeRole(m, v as Role)}
                            disabled={busy === m.id}
                            ariaLabel={`Role for ${m.name}`}
                            buttonClassName="px-2.5 py-1 text-xs bg-white border-border rounded-lg"
                            options={ROLE_OPTIONS}
                          />
                        </div>
                      ) : (
                        <Badge tone="neutral">{ROLE_LABEL[m.role]}</Badge>
                      )}
                    </TD>

                    {/* 4. Projects Status */}
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="h-3.5 w-3.5 text-secondary shrink-0" />
                        <span className="text-xs font-semibold text-primary">
                          {activeProjectsCount} active
                        </span>
                      </div>
                    </TD>

                    {/* 5. Tasks Overview */}
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-surface border border-border text-primary">
                          {openCount} open
                        </span>
                        {inReviewCount > 0 && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                            {inReviewCount} in review
                          </span>
                        )}
                        {overdueCount > 0 && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">
                            {overdueCount} overdue
                          </span>
                        )}
                      </div>
                    </TD>

                    {/* 6. Status */}
                    <TD>
                      <Badge tone={STATUS[m.status].tone}>
                        {STATUS[m.status].label}
                        {m.inviteExpired && ' · expired'}
                      </Badge>
                    </TD>

                    {/* 7. Actions */}
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedMember(m)}
                          className="text-xs text-secondary hover:text-primary gap-1"
                        >
                          View Work <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      {/* Member Details Drawer */}
      <MemberWorkDrawer
        member={selectedMember}
        isOpen={selectedMember !== null}
        onClose={() => setSelectedMember(null)}
        isMe={selectedMember?.id === me?.userId}
        tz={tz}
        locale={locale}
      />

      {/* Invite Modal */}
      <InviteDialog
        open={inviting}
        myRole={myRole}
        mailConfigured={config?.mailConfigured ?? false}
        onClose={() => setInviting(false)}
        onInvited={({ name, email, url, emailed }) => {
          setInviting(false);
          if (emailed) setNote(`Invitation emailed to ${email}.`);
          else setLink({ name, url, kind: 'invite' });
          void load();
        }}
      />

      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  );
}

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);
const inviteUrl = (token: string) => `${origin()}/accept-invite?token=${token}`;
const resetUrl = (token: string) => `${origin()}/reset-password?token=${token}`;

/** Clean Member Details Slide-Over Drawer with Proper Inner Padding & Read-Only Roles */
function MemberWorkDrawer({
  member,
  isOpen,
  onClose,
  isMe,
  tz,
  locale,
}: {
  member: Member | null;
  isOpen: boolean;
  onClose: () => void;
  isMe: boolean;
  tz: string;
  locale: string;
}) {
  const [tab, setTab] = useState<'TASKS' | 'PROJECTS' | 'DETAILS'>('TASKS');
  const [taskSearch, setTaskSearch] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);

  if (!member) return null;

  const tasks = member.tasks || [];
  const projects = member.projects || [];
  const stats = member.taskStats || {
    total: tasks.length,
    open: tasks.filter((t) => t.status !== 'DONE').length,
    inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
    inReview: tasks.filter((t) => t.status === 'IN_REVIEW').length,
    completed: tasks.filter((t) => t.status === 'DONE').length,
    overdue: tasks.filter(
      (t) =>
        t.status !== 'DONE' &&
        t.status !== 'ON_HOLD' &&
        t.status !== 'BLOCKED' &&
        t.dueDate &&
        new Date(t.dueDate) < new Date()
    ).length,
  };

  const copyEmail = () => {
    void navigator.clipboard.writeText(member.email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const filteredTasks = tasks.filter((t) => {
    if (!taskSearch.trim()) return true;
    const q = taskSearch.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.project?.name && t.project.name.toLowerCase().includes(q)) ||
      (t.project?.company?.name && t.project.company.name.toLowerCase().includes(q))
    );
  });

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      variant="slideover"
      title="Member Details"
      className="w-full max-w-xl"
    >
      <div className="p-6 space-y-6">
        {/* Profile Card */}
        <div className="flex items-start gap-4 pb-5 border-b border-border">
          {member.avatar ? (
            <img
              src={member.avatar}
              alt=""
              className="h-14 w-14 rounded-full object-cover shrink-0 border border-border ring-2 ring-border/50"
            />
          ) : (
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-bold border border-border ${getAvatarColor(
                member.name
              )}`}
            >
              {getInitials(member.name)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-primary truncate">{member.name}</h2>
              {isMe && (
                <span className="text-[10px] font-medium px-1.5 py-0.2 bg-subtle text-secondary rounded">
                  you
                </span>
              )}
              <Badge tone={STATUS[member.status].tone}>{STATUS[member.status].label}</Badge>
              <Badge tone="neutral">{ROLE_LABEL[member.role]}</Badge>
            </div>

            <p className="text-xs font-medium text-secondary truncate mt-1">
              {member.designation || 'Team Member'}
              {member.department && ` · ${member.department.name}`}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 mt-2">
              <button
                onClick={copyEmail}
                className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors bg-surface px-2.5 py-1 rounded-md border border-border"
                title="Click to copy email"
              >
                <Mail className="h-3.5 w-3.5 text-muted" />
                <span>{member.email}</span>
                {copiedEmail ? (
                  <Check className="h-3 w-3 text-emerald-600 ml-0.5" />
                ) : (
                  <Copy className="h-3 w-3 text-muted ml-0.5" />
                )}
              </button>

              {member.phone && (
                <a
                  href={`tel:${member.phone}`}
                  className="inline-flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors bg-surface px-2.5 py-1 rounded-md border border-border"
                >
                  <Phone className="h-3.5 w-3.5 text-muted" />
                  <span>{member.phone}</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* 4 Clean Summary Metric Cards */}
        <div className="grid grid-cols-4 gap-2.5">
          <div className="rounded-xl border border-border bg-surface/50 p-3 text-center">
            <span className="text-[11px] font-medium text-secondary block">Projects</span>
            <span className="text-lg font-bold text-primary mt-0.5 block">
              {member.activeProjectsCount ?? projects.length}
            </span>
          </div>

          <div className="rounded-xl border border-border bg-surface/50 p-3 text-center">
            <span className="text-[11px] font-medium text-secondary block">Open</span>
            <span className="text-lg font-bold text-primary mt-0.5 block">{stats.open}</span>
          </div>

          <div className="rounded-xl border border-border bg-surface/50 p-3 text-center">
            <span className="text-[11px] font-medium text-secondary block">In Review</span>
            <span className="text-lg font-bold text-primary mt-0.5 block">{stats.inReview}</span>
          </div>

          <div className="rounded-xl border border-border bg-surface/50 p-3 text-center">
            <span className="text-[11px] font-medium text-secondary block">Overdue</span>
            <span className={`text-lg font-bold mt-0.5 block ${stats.overdue > 0 ? 'text-red-600' : 'text-primary'}`}>
              {stats.overdue}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-4 border-b border-border text-xs">
          <button
            onClick={() => setTab('TASKS')}
            className={`pb-2.5 font-semibold transition-colors border-b-2 ${tab === 'TASKS' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'
              }`}
          >
            Assigned Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setTab('PROJECTS')}
            className={`pb-2.5 font-semibold transition-colors border-b-2 ${tab === 'PROJECTS' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'
              }`}
          >
            Projects ({projects.length})
          </button>
          <button
            onClick={() => setTab('DETAILS')}
            className={`pb-2.5 font-semibold transition-colors border-b-2 ${tab === 'DETAILS' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'
              }`}
          >
            Member Info
          </button>
        </div>

        {/* Tab 1: Assigned Tasks */}
        {tab === 'TASKS' && (
          <div className="space-y-3">
            {tasks.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Filter tasks by name or project..."
                  className="w-full rounded-xl border border-border bg-white pl-8 pr-8 py-1.5 text-xs text-body placeholder:text-muted focus:border-primary focus:outline-none"
                />
                {taskSearch && (
                  <button
                    onClick={() => setTaskSearch('')}
                    className="absolute right-2.5 top-2.5 text-muted hover:text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {filteredTasks.length === 0 ? (
              <div className="py-12 text-center text-xs text-secondary italic rounded-xl border border-dashed border-border bg-surface/30">
                {taskSearch ? 'No matching tasks.' : 'No tasks assigned to this member.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between p-3.5 rounded-xl border border-border bg-white hover:border-primary/80 transition-colors gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-semibold truncate ${task.status === 'DONE' ? 'line-through text-muted' : 'text-primary'
                          }`}
                      >
                        {task.title}
                      </p>
                      {task.project && (
                        <p className="text-[11px] text-secondary truncate mt-0.5">
                          {task.project.company?.name ? `${task.project.company.name} · ` : ''}
                          {task.project.name}
                        </p>
                      )}
                      {task.dueDate && (
                        <p className="text-[10px] text-muted mt-0.5">
                          Due {formatDate(task.dueDate, tz, locale)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={PRIORITY_TONE[task.priority] ?? 'neutral'}>{task.priority}</Badge>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-surface border border-border text-primary">
                        {task.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Projects */}
        {tab === 'PROJECTS' && (
          <div className="space-y-3">
            {projects.length === 0 ? (
              <div className="py-12 text-center text-xs text-secondary italic rounded-xl border border-dashed border-border bg-surface/30">
                This member is not associated with any projects yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {projects.map((proj) => (
                  <div
                    key={proj.id}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-white hover:border-primary/80 transition-colors gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-primary truncate">{proj.name}</p>
                        {proj.isLead && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            Lead
                          </span>
                        )}
                      </div>
                      {proj.company && (
                        <p className="text-[11px] text-secondary truncate mt-0.5">{proj.company.name}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone="neutral">{proj.status}</Badge>
                      <a
                        href={`/projects/${proj.id}`}
                        className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        View <ArrowUpRight className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Read-Only Member Information */}
        {tab === 'DETAILS' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-white p-4 space-y-3 text-xs">
              <span className="font-bold text-primary block uppercase tracking-wider text-[11px]">
                Organizational Role
              </span>
              <div className="flex items-center justify-between py-1">
                <span className="text-secondary">Assigned Role:</span>
                <Badge tone="neutral">{ROLE_LABEL[member.role]}</Badge>
              </div>
              <p className="text-[11px] text-muted">{ROLE_HINT[member.role]}</p>
            </div>

            <div className="rounded-xl border border-border bg-white p-4 space-y-2.5 text-xs">
              <span className="font-bold text-primary block uppercase tracking-wider text-[11px]">
                Account Details
              </span>
              <div className="flex items-center justify-between text-secondary py-1">
                <span>Designation</span>
                <span className="font-semibold text-primary">{member.designation || 'Team Member'}</span>
              </div>
              <div className="flex items-center justify-between text-secondary py-1 border-t border-border/60">
                <span>Department</span>
                <span className="font-semibold text-primary">{member.department?.name || '—'}</span>
              </div>
              <div className="flex items-center justify-between text-secondary py-1 border-t border-border/60">
                <span>Joined Date</span>
                <span className="font-semibold text-primary">{formatDate(member.joiningDate, tz, locale)}</span>
              </div>
              <div className="flex items-center justify-between text-secondary py-1 border-t border-border/60">
                <span>Sign In Method</span>
                <span className="font-semibold text-primary">
                  {member.signIn.google ? 'Google Workspace' : 'Email & Password'}
                </span>
              </div>
              <div className="flex items-center justify-between text-secondary py-1 border-t border-border/60">
                <span>Account Status</span>
                <Badge tone={STATUS[member.status].tone}>{STATUS[member.status].label}</Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Invite Member Dialog */
function InviteDialog({
  open,
  myRole,
  mailConfigured,
  onClose,
  onInvited,
}: {
  open: boolean;
  myRole: Role | undefined;
  mailConfigured: boolean;
  onClose: () => void;
  onInvited: (result: { name: string; email: string; url: string; emailed: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setDesignation('');
      setRole('MEMBER');
      setError(null);
    }
  }, [open]);

  const choices = ORDER.filter((r) => r !== 'SUPER_ADMIN' && atLeast(myRole, r));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.users.invite({
        name,
        email,
        role,
        designation: designation || null,
      });
      onInvited({
        name,
        email,
        url: inviteUrl(result.data.inviteToken),
        emailed: result.data.emailed,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite team member">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {error && <ErrorNote>{error}</ErrorNote>}

          <Field
            label="Name"
            required
            value={name}
            onChange={setName}
            placeholder="Full name"
          />

          <Field
            label="Email"
            type="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="work@example.com"
          />

          <Field
            label="Designation"
            value={designation}
            onChange={setDesignation}
            placeholder="e.g. Lead Frontend Engineer, Account Executive"
          />

          <FieldSelect
            label="Role"
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={choices.map((r) => ({
              value: r,
              label: `${ROLE_LABEL[r]} — ${ROLE_HINT[r]}`,
            }))}
          />
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Inviting…' : 'Send Invitation'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** Link sharing dialog */
function LinkDialog({
  link,
  onClose,
}: {
  link: { name: string; url: string; kind: LinkKind } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [link]);

  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  };

  const isInvite = link.kind === 'invite';

  return (
    <Modal open={link !== null} onClose={onClose} title={isInvite ? 'Invitation link' : 'Password reset link'}>
      <ModalBody className="space-y-4">
        <p className="text-sm text-secondary">
          {isInvite
            ? `Share this link with ${link.name} to activate their account.`
            : `Share this link with ${link.name}. It works for one hour.`}
        </p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={link.url}
            className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-xs font-mono text-primary select-all focus:outline-none"
          />
          <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
