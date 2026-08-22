'use client';

/**
 * One project.
 *
 * A project belongs to the CLIENT and only to the client. What the client is on —
 * retainer or project, at what price — is SHOWN here, read from the company, so
 * this survives the engagement renewing or ending (master plan §3.12).
 *
 * Health is computed by the server from dates and overdue tasks. A flag somebody
 * sets by hand is green everywhere, forever (§4.8).
 *
 * Every task carries an assignee AND a separate reviewer, because agency work is
 * checked before a client sees it — and the checker is frequently not on the
 * project otherwise (§4.8).
 */

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, List, LayoutDashboard, CheckCircle2, Circle, Settings2, UserPlus, UserMinus, Globe, Smartphone, ShoppingBag, FileCode, Share2, Search, Zap, Package } from 'lucide-react';
import {
  api,
  ApiError,
  atLeast,
  formatDate,
  formatMoney,
  type Company,
  type Member,
  type OrgConfig,
  type Role,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { ProjectDetailSkeleton } from '@/components/ui/skeleton-loaders';
import { NewTaskPanel } from '@/components/tasks/NewTaskPanel';
import { MultiSelect, type Option } from '@/components/ui/multi-select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { ActivityFeed } from '@/components/activities/ActivityFeed';
import { LogActivityDialog } from '@/components/activities/LogActivityDialog';

type Health = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';
type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  dueDate: string | null;
  assignee: { id: string; name: string } | null;
  reviewer: { id: string; name: string } | null;
};

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
  company: {
    id: string;
    name: string;
    status: string;
    /**
     * No `amount`, on purpose. These are the project screens — the price is not
     * something delivery decides, and the server no longer sends it here for any
     * role. Whoever needs the number opens the client in CRM or Revenue.
     */
    engagements: {
      id: string;
      type: string;
      billingFrequency: string;
      endDate: string | null;
    }[];
  };
  owner: { id: string; name: string } | null;
  members: { user: { id: string; name: string } }[];
  tasks: Task[];
  activities: { id: string; type: string; message: string; body: string | null; occurredAt: string; user?: { name: string } }[];
};

const HEALTH: Record<Health, { label: string; tone: Tone }> = {
  ON_TRACK: { label: 'On track', tone: 'good' },
  AT_RISK: { label: 'At risk', tone: 'warn' },
  OFF_TRACK: { label: 'Off track', tone: 'bad' },
};

/** In-review is its own column: work sitting with a checker is neither done nor moving. */
const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'TODO', label: 'To do' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'IN_REVIEW', label: 'In review' },
  { status: 'DONE', label: 'Done' },
];

const STATUS_OPTIONS = [
  ...COLUMNS.map((c) => ({ value: c.status, label: c.label })),
  { value: 'BLOCKED', label: 'Blocked' },
];

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<'BOARD' | 'LIST'>('LIST');
  const [currentTab, setCurrentTab] = useState<'tasks' | 'team' | 'comments' | 'activity'>('tasks');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logging, setLogging] = useState(false);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [newComment, setNewComment] = useState('');
  const [addingMemberId, setAddingMemberId] = useState('');
  const [teamBusy, setTeamBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, cfg] = await Promise.all([
        api.projects.get(id) as Promise<unknown> as Promise<Project>,
        api.config.get(),
      ]);
      setProject(p);
      setConfig(cfg);
      setError(null);
      void api.users
        .list()
        .then((list) => setTeam(list.filter((m) => m.status === 'ACTIVE')))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (task: Task, status: TaskStatus) => {
    // Optimistic, then reconciled. The server decides; this only makes the
    // change feel immediate.
    setProject((p) =>
      p ? { ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) } : p,
    );
    try {
      await api.projects.updateTask(task.id, { status });
    } finally {
      void load();
    }
  };

  if (loading) return <ProjectDetailSkeleton />;

  if (!project) {
    return (
      <EmptyState
        title="That project does not exist"
        hint={error ?? undefined}
        action={
          <Link href="/projects">
            <Button>Back to projects</Button>
          </Link>
        }
      />
    );
  }

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const date = (v: string | null | undefined) => formatDate(v, tz, locale);
  const canManage = atLeast(config?.me.role as Role | undefined, 'MANAGER');
  const blocked = project.tasks.filter((t) => t.status === 'BLOCKED');

  const addMember = async (userId: string) => {
    if (!userId) return;
    setTeamBusy(userId);
    try {
      await api.projects.addMember(id, userId);
      await load();
      setAddingMemberId('');
    } catch {}
    finally { setTeamBusy(null); }
  };

  const removeMember = async (userId: string) => {
    setTeamBusy(userId);
    try {
      await api.projects.removeMember(id, userId);
      await load();
    } catch {}
    finally { setTeamBusy(null); }
  };

  return (
    <>
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Projects
      </Link>

      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{project.name}</h1>
            <Badge tone={HEALTH[project.health].tone}>{HEALTH[project.health].label}</Badge>
          </div>
          <Link
            href={`/clients/${project.company.id}`}
            className="mt-1 inline-block text-sm text-secondary hover:underline"
          >
            {project.company.name}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="ghost" icon={Settings2} onClick={() => setEditing(true)}>
              Edit project
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Task
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Due" value={date(project.dueDate)} />
          <Figure label="Started" value={date(project.startDate)} />
          <Figure label="Lead" value={project.owner?.name ?? 'Nobody'} />
          <Figure
            label="Open tasks"
            value={String(project.tasks.filter((t) => t.status !== 'DONE').length)}
          />
        </div>

        {/*
          Context, not a link. The project is attached to the client, so this
          survives the engagement renewing or ending (§3.12). Money is only sent
          to Admin and above — the server decides that, not this component.
        */}
        {project.company.engagements.length > 0 && (
          <Card padding="sm">
            <h2 className="text-sm font-semibold text-primary">What this client is on</h2>
            <p className="mt-1 text-sm text-secondary">
              {project.company.engagements
                .map((e) =>
                  e.type === 'RETAINER'
                    ? e.endDate
                      ? 'Retainer, with an end date'
                      : 'Rolling retainer — the work keeps arriving'
                    : 'Fixed-scope project — it ends',
                )
                .join(' · ')}
            </p>
          </Card>
        )}

        {/* ── Tabs ──────────────────────────────────────────── */}
        <div className="flex rounded-md bg-muted/50 p-1 w-fit mt-8">
          {[
            { id: 'tasks', label: `Tasks (${project.tasks.length})` },
            { id: 'team', label: `Team (${project.members.length})` },
            { id: 'comments', label: 'Comments' },
            { id: 'activity', label: 'Activity' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setCurrentTab(t.id as any)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                currentTab === t.id ? 'bg-white text-primary border border-border font-semibold' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {currentTab === 'tasks' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">Tasks</h2>
              <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
                <button
                  onClick={() => setView('BOARD')}
                  className={`rounded px-2 py-1 text-xs ${view === 'BOARD' ? 'bg-white border border-border text-primary font-medium' : 'text-secondary hover:text-primary'}`}
                >
                  <LayoutDashboard className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setView('LIST')}
                  className={`rounded px-2 py-1 text-xs ${view === 'LIST' ? 'bg-white border border-border text-primary font-medium' : 'text-secondary hover:text-primary'}`}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>

        {view === 'BOARD' ? (
          <div className="grid gap-3 lg:grid-cols-4">
            {COLUMNS.map((column) => {
              const tasks = project.tasks.filter((t) => t.status === column.status);
              return (
                <section
                  key={column.status}
                  className="rounded-card border border-border bg-surface p-3"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging && dragging.status !== column.status) {
                      move(dragging, column.status);
                      setDragging(null);
                    }
                  }}
                >
                  <h2 className="mb-2 flex items-center justify-between text-xs font-semibold text-primary">
                    {column.label}
                    <span className="font-normal text-secondary">{tasks.length}</span>
                  </h2>

                  <ul className="space-y-2 min-h-16">
                    {tasks.map((task) => (
                      <li
                        key={task.id}
                        draggable
                        onDragStart={() => setDragging(task)}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => setSelectedTask(task)}
                        className={`cursor-grab rounded-xl border border-border bg-white p-3 hover:border-primary transition-colors active:cursor-grabbing ${
                          dragging?.id === task.id ? 'opacity-50' : ''
                        }`}
                      >
                        <p className="text-sm font-medium text-body">{task.title}</p>

                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-secondary">
                          {task.assignee && <span>{task.assignee.name}</span>}
                          {task.reviewer && <span>· checks: {task.reviewer.name}</span>}
                          {task.dueDate && <span>· {date(task.dueDate)}</span>}
                        </div>
                      </li>
                    ))}
                    {tasks.length === 0 && (
                      <li className="py-4 text-center text-xs text-secondary">—</li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="rounded-card border border-border bg-white overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs font-medium text-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                  <th className="px-4 py-3 font-medium">Reviewer</th>
                  <th className="px-4 py-3 font-medium">Due Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {project.tasks.filter((t) => t.status !== 'BLOCKED').map((task) => (
                  <tr 
                    key={task.id} 
                    className="hover:bg-subtle transition-colors cursor-pointer group"
                    onClick={() => setSelectedTask(task)}
                  >
                    <td className="px-4 py-3 font-medium text-primary">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            move(task, 'DONE');
                          }}
                          className="shrink-0 text-secondary hover:text-green-600 transition-colors"
                        >
                          {task.status === 'DONE' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>
                        <span className="truncate">{task.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-secondary">{task.assignee?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-secondary">{task.reviewer?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-secondary">{date(task.dueDate) ?? '—'}</td>
                    <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                      <Select
                        value={task.status}
                        onChange={(v) => move(task, v as TaskStatus)}
                        options={STATUS_OPTIONS}
                        ariaLabel={`Status for ${task.title}`}
                        buttonClassName="px-2 py-1.5 text-xs w-32"
                      />
                    </td>
                  </tr>
                ))}
                {project.tasks.filter((t) => t.status !== 'BLOCKED').length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-secondary text-sm">No tasks here yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {blocked.length > 0 && (
          <Card className="border-red-200 bg-red-50/40">
            <h2 className="mb-2 text-sm font-semibold text-primary">Blocked</h2>
            <ul className="space-y-1 text-sm">
              {blocked.map((t) => (
                <li key={t.id} className="text-body cursor-pointer hover:underline" onClick={() => setSelectedTask(t)}>
                  {t.title}
                  {t.assignee && <span className="text-secondary"> · {t.assignee.name}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        </div>
        )}

        {currentTab === 'team' && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-primary">On this project</h2>
            </div>
            {project.members.length === 0 && (
              <p className="text-sm text-secondary mb-3">No members added yet.</p>
            )}
            <ul className="space-y-2 mb-4">
              {project.members.map((m) => (
                <li key={m.user.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                      {m.user.name.charAt(0)}
                    </div>
                    <span className="text-sm text-primary">{m.user.name}</span>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => removeMember(m.user.id)}
                      disabled={teamBusy === m.user.id}
                      className="rounded p-1 text-secondary hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Remove from project"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canManage && (
              <div className="flex items-center gap-2">
                <select
                  value={addingMemberId}
                  onChange={(e) => setAddingMemberId(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Add a team member…</option>
                  {team
                    .filter((u) => !project.members.some((m) => m.user.id === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                </select>
                <Button
                  size="sm"
                  icon={UserPlus}
                  onClick={() => addMember(addingMemberId)}
                  disabled={!addingMemberId || !!teamBusy}
                >
                  Add
                </Button>
              </div>
            )}
          </Card>
        )}
        {currentTab === 'comments' && (
          <div className="space-y-4">
            <ActivityFeed
              items={project.activities
                .filter((a) => a.type === 'NOTE' || a.type === 'COMMENT' || a.type === 'CALL' || a.type === 'EMAIL' || a.type === 'MEETING')
                .map((a) => ({
                  key: a.id,
                  at: a.occurredAt,
                  text: a.message,
                  body: a.body,
                  userName: a.user?.name,
                }))}
            />
            <div className="flex gap-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment or note…"
                rows={3}
                className="flex-1 rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!newComment.trim()}
                onClick={async () => {
                  if (!newComment.trim()) return;
                  try {
                    await api.activities.log({ projectId: id, companyId: project.company.id, type: 'NOTE', message: newComment.trim() });
                    setNewComment('');
                    void load();
                  } catch {}
                }}
              >
                Post comment
              </Button>
            </div>
          </div>
        )}
        {currentTab === 'activity' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" icon={Plus} onClick={() => setLogging(true)}>
                Log activity
              </Button>
            </div>
            <ActivityFeed 
              items={project.activities.map(a => ({
                key: a.id,
                at: a.occurredAt,
                text: a.message,
                body: a.body,
                userName: a.user?.name,
              }))} 
            />
          </div>
        )}
      </div>

      <LogActivityDialog
        open={logging}
        projectId={project.id}
        companyId={project.company.id}
        onClose={() => setLogging(false)}
        onLogged={() => {
          setLogging(false);
          void load();
        }}
      />

      <NewTaskPanel
        isOpen={adding}
        defaultProjectId={project.id}
        onClose={() => setAdding(false)}
        onSuccess={load}
      />

      <TaskDetailPanel
        task={selectedTask}
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTask(null)}
        onUpdate={load}
        timezone={tz}
        locale={locale}
      />
      <EditProjectPanel
        project={editing ? project : null}
        isOpen={editing}
        team={team}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); void load(); }}
      />
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="sm">
      <p className="text-xs text-secondary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-primary">{value}</p>
    </Card>
  );
}

function NewTaskDialog({
  open,
  projectId,
  team,
  canAssign,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  team: Member[];
  canAssign: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle('');
      setAssigneeId('');
      setReviewerId('');
      setDueDate('');
      setPriority('MEDIUM');
      setError(null);
    }
  }, [open]);

  const people = [
    { value: '', label: 'Nobody' },
    ...team.map((m) => ({ value: m.id, label: m.name, sublabel: m.designation ?? undefined })),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.projects.createTask({
        // Exactly one parent — a database CHECK enforces it, so sending both
        // would be refused rather than quietly stored.
        projectId,
        dealId: null,
        title,
        assigneeId: assigneeId || null,
        reviewerId: reviewerId || null,
        dueDate: dueDate || null,
        priority,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form onSubmit={submit}>
        <ModalBody>
          <Field label="What needs doing?" value={title} onChange={setTitle} required />

          {canAssign && team.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldSelect
                label="Who does it"
                value={assigneeId}
                onChange={setAssigneeId}
                options={people}
              />
              <div>
                <FieldSelect
                  label="Who checks it"
                  value={reviewerId}
                  onChange={setReviewerId}
                  options={people}
                />
                {/* Separate from the assignee on purpose — the checker is often
                    not otherwise on the project (§4.8). */}
                <p className="mt-1 text-xs text-secondary">Often not the same person.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" type="date" value={dueDate} onChange={setDueDate} />
            <FieldSelect
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
                { value: 'URGENT', label: 'Urgent' },
              ]}
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!title}>
            Add Task
          </Button>
        </ModalFooter>
      </form>
    </Modal>
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

function EditProjectPanel({
  project,
  isOpen,
  team = [],
  onClose,
  onSaved,
}: {
  project: Project | null;
  isOpen: boolean;
  team?: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);

  // 10 Project Fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['WEB']);
  const [type, setType] = useState('ONE_TIME');
  const [status, setStatus] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [scope, setScope] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    void api.companies.list().then((list) => setCompanies(list as any)).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!project) return;
    setName(project.name ?? '');
    setDescription(project.description ?? '');
    setPlatforms(project.platform ? project.platform.split(',') : ['WEB']);
    setType(project.type ?? 'ONE_TIME');
    setStatus(project.status ?? 'PLANNING');
    setCompanyId(project.company?.id ?? '');
    setOwnerId(project.owner?.id ?? '');
    setMemberIds(project.members ? project.members.map((m) => m.user.id) : []);
    setStartDate(project.startDate ? project.startDate.slice(0, 10) : '');
    setDueDate(project.dueDate ? project.dueDate.slice(0, 10) : '');
    setScope(project.scope ?? '');
    setError(null);
  }, [project]);

  if (!project) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.projects.update(project.id, {
        name,
        description: description || null,
        platform: platforms.length > 0 ? platforms.join(',') : null,
        type,
        status: status as any,
        companyId: companyId || undefined,
        ownerId: ownerId || null,
        memberIds,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        scope: scope || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save project');
    } finally {
      setSaving(false);
    }
  };

  const teamOptions = team
    .filter((u) => u.status === 'ACTIVE')
    .map((u) => ({ value: u.id, label: u.name }));

  const ownerOptions = [
    { value: '', label: '— Choose Project Owner —' },
    ...teamOptions,
  ];

  return (
    <Modal open={isOpen} onClose={onClose} title="Edit Project" size="lg">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* 1. Project Name */}
          <Field label="Project Name *" value={name} onChange={setName} required />

          {/* 5. Client */}
          {companies.length > 0 && (
            <FieldSelect
              label="Client / Company"
              value={companyId}
              onChange={setCompanyId}
              placeholder="Choose a client…"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}

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

          {/* Project Type */}
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
            <FieldSelect label="Project Owner" value={ownerId} onChange={setOwnerId} options={ownerOptions} />
          </div>

          {/* 7. Team Members (MultiSelect Dropdown) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary">Team Members</label>
            <MultiSelect
              compact={false}
              placeholder="Click to add team members…"
              options={teamOptions}
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
              placeholder="Project description…"
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
              placeholder="Detailed scope of work and deliverables…"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
