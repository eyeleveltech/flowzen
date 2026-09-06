'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { ErrorNote } from '@/components/ui/empty-state';
import { api, fileUrl } from '@/lib/api-v2';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { AssignTaskModal } from '@/components/work/AssignTaskModal';
import { InviteMemberModal } from '@/components/work/InviteMemberModal';
import { useAuthStore } from '@/stores';
import { AccessModal } from '@/components/work/AccessModal';
import { ResetLinkModal } from '@/components/work/ResetLinkModal';
import { HeldAssets } from '@/components/assets/HeldAssets';
import { DeactivateModal } from '@/components/work/DeactivateModal';
import { Modal, ModalBody } from '@/components/ui/modal';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { RowMenu } from '@/components/ui/row-menu';
import { MemberDrawer } from '@/components/work/MemberDrawer';
import { Badge } from '@/components/ui/badge';
import { presetLabel } from '@/lib/people';
import { KeyRound, Package, Plus, ShieldCheck, UserMinus } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  /** What they are called at work — "Developer". Their own to edit, on /profile. */
  designation?: string | null;
  email: string;
  dept?: string | null;
  /** What the app lets them do. Not a job title, and not theirs to change. */
  preset?: string | null;
  permissions?: string[];
  monthlyCost?: number | null;
  openTasksCount: number;
  overdueTasksCount: number;
  waitingTasksCount: number;
  completedTasksCount: number;
  /** Null when this person has never finished a task — there is nothing to average. */
  avgTurnaround: string | null;
  loadPercentage: number;
}

export default function MembersPage() {
  /*
   * Inviting somebody needs `setup.admin`, and this button asked for nothing.
   * The screen itself only needs `work.team`, so every Head could see the
   * button, fill in the form and be refused by the server — the one control in
   * the product that promised something it could not do.
   */
  const canInvite = useAuthStore((s) => s.user?.permissions?.includes('setup.admin') ?? false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  /** A failed load, said out loud instead of only in the console. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [depts, setDepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [assigningTo, setAssigningTo] = useState<TeamMember | null>(null);
  const [inviting, setInviting] = useState(false);
  const [editingAccessFor, setEditingAccessFor] = useState<TeamMember | null>(null);
  const [resettingFor, setResettingFor] = useState<TeamMember | null>(null);
  const [kitFor, setKitFor] = useState<TeamMember | null>(null);
  const [deactivating, setDeactivating] = useState<TeamMember | null>(null);
  // By id, not by object: the drawer fetches the person's full record anyway,
  // and holding the row would mean rendering yesterday's counts beside today's
  // task list.
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = deptFilter !== 'ALL' ? `?dept=${deptFilter}` : '';
      const res = await api.team.capacity(deptFilter !== 'ALL' ? { dept: deptFilter } : {});
      if (res.success) {
        setMembers(res.members);
        setDepts(res.departments);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the team');
    } finally {
      setLoading(false);
    }
  }, [deptFilter]);

  useEffect(() => { load(); }, [load]);

  // Derive team stats
  const totalOpen = members.reduce((s, m) => s + m.openTasksCount, 0);
  const totalOverdue = members.reduce((s, m) => s + m.overdueTasksCount, 0);
  const totalWaiting = members.reduce((s, m) => s + m.waitingTasksCount, 0);

  /*
   * Over a normal load, and how many of those are also behind.
   *
   * This used to require BOTH — over 100% and something overdue — and then
   * announce the result as "N people are over a normal load". Charles sits at
   * 200% with nothing late, so the sentence said three when four people were
   * over a normal load and the one furthest over with no excuse was the one it
   * left out.
   *
   * The threshold here is 100% — "more than this person's own normal". The
   * notification rule fires at 130%, deliberately: a banner summarises, an
   * alert interrupts, and they should not interrupt at the same point.
   */
  const overloaded = members.filter((m) => m.loadPercentage > 100).sort((a, b) => b.loadPercentage - a.loadPercentage);
  const alsoLate = overloaded.filter((m) => m.overdueTasksCount > 0);
  const lateOnOverloaded = alsoLate.reduce((n, m) => n + m.overdueTasksCount, 0);


  const getLoadColor = (pct: number) => {
    if (pct >= 100) return 'bg-danger';
    if (pct >= 70) return 'bg-success';
    return 'bg-success';
  };

  /*
   * What is on screen, not whoever happens to sort first.
   *
   * This read `members[0]?.dept`, so the page was headed "Team · Accounts"
   * while showing all fourteen people from seven departments — Priya simply
   * sorts first.
   */
  usePageHeader('Team', deptFilter === 'ALL' ? 'All departments' : deptFilter);

  return (
    <div className="page-shell">
      {loadError && (
        <div className="mb-6">
          {/*
            A failed load used to reach console.error and stop, so the screen
            rendered its empty state and "the server is down" looked exactly
            like "you have nothing yet".
          */}
          <ErrorNote onDismiss={() => setLoadError(null)}>{loadError}</ErrorNote>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          {depts.length > 0 && (
            <select
              aria-label="Filter the team by department"
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="border border-border rounded-lg px-3 py-1.5 text-sm text-body outline-none focus:border-primary bg-white"
            >
              <option value="ALL">All departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <ExportCsvButton href={fileUrl(`/team/capacity?format=csv${deptFilter !== 'ALL' ? `&dept=${deptFilter}` : ''}`)} />
          {canInvite && (
            <button
              className="flex items-center gap-1.5 bg-primary text-white text-sm font-semibold px-4 h-8 rounded-lg hover:bg-primary/90 transition-colors"
              onClick={() => setInviting(true)}
            >
              <span className="text-base leading-none">+</span> Invite
            </button>
          )}
      </div>

      <StatRow className="mb-6">
        <StatTile
          label="People"
          value={members.length}
          note={`across ${depts.length} team${depts.length !== 1 ? 's' : ''}`}
        />
        <StatTile label="Open Tasks" value={totalOpen} note="this week" />
        <StatTile
          label="Overdue"
          value={totalOverdue}
          /*
           * Overdue TASKS carried by people who are already over a normal
           * load. This read `flagged.length` — a count of PEOPLE — under the
           * words "sit with one person", so three overloaded people were
           * reported as three late tasks sitting with somebody.
           */
          note={
            totalOverdue > 0
              ? `${lateOnOverloaded} with someone already over a normal load`
              : 'none'
          }
          tone={totalOverdue > 0 ? 'danger' : 'default'}
        />
        <StatTile
          label="Waiting on Clients"
          value={totalWaiting}
          note="not your team's delay"
          tone={totalWaiting > 0 ? 'warning' : 'default'}
        />
      </StatRow>

      {/*
        One line, and the table below carries the detail — every flagged person
        is already a red row in it, so repeating each one's load and overdue
        count here said the same thing twice.

        It also could not count. The sentence ended "Neither was reported by
        anyone, both come from task counts" however many people were flagged,
        and today there are three.
      */}
      {overloaded.length > 0 && (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 rounded-xl border border-danger/30 bg-danger-tint px-4 py-3 text-sm">
          <span className="font-semibold text-primary">
            {overloaded.length === 1 ? '1 person is' : `${overloaded.length} people are`} over a normal load:
          </span>
          <span className="text-body">
            {overloaded.map((m) => `${m.name} (${m.loadPercentage}%)`).join(', ')}.
          </span>
          {alsoLate.length > 0 && (
            <span className="text-body">
              {alsoLate.length === overloaded.length
                ? 'All of them have'
                : `${alsoLate.length} of them ${alsoLate.length === 1 ? 'has' : 'have'}`}{' '}
              work already late.
            </span>
          )}
          <span className="text-secondary">Counted from tasks, against each person’s own normal — not reported by anyone.</span>
        </div>
      )}

      {/* Load and delivery table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-primary">Load and delivery</h2>
          <span className="text-micro text-secondary">
            {new Date().toLocaleString('en-IN', { month: 'long' })}
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-border">
              <th className="eyebrow text-left">Person</th>
              <th className="eyebrow text-center">Open</th>
              <th className="eyebrow text-center">Overdue</th>
              <th className="eyebrow text-center">Waiting</th>
              <th
                className="eyebrow text-center px-4 py-3"
                title="Working hours between a task being assigned and finished, waiting time removed — averaged over every task this person has ever completed. 10:00–19:00, Monday to Saturday, so 9h is one working day."
              >
                Avg close
              </th>
              <th className="eyebrow text-left">Load vs normal</th>
              <th className=""></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <TableRowsSkeleton cols={7} />
            ) : members.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-secondary">No team members found.</td></tr>
            ) : members.map(m => (
              <tr
                key={m.id}
                onClick={() => setOpenMemberId(m.id)}
                className="cursor-pointer transition-colors hover:bg-subtle"
              >
                <td className="">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-micro font-bold ${getAvatarColor(m.name)}`}>
                      {getInitials(m.name)}
                    </div>
                    {/*
                      Three facts, each written once.

                      The name was carrying the job title — "Vikram
                      (Developer)" — and the line underneath printed the
                      department, so ten of fourteen rows said the same thing
                      twice while four said it once. Whether you got a second
                      line came down to whether the word in brackets happened
                      to contain the department's name: "Digital Marketing"
                      did, "Developer" does not contain "Development", and
                      "Founder" does not contain "Management". That is the
                      whole of the inconsistency.

                      Now `name` is a name, `designation` is what they are
                      called, and the badge is what the app lets them do —
                      which is a different question from either, and the one
                      the Access dialog answers.
                    */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(ev) => { ev.stopPropagation(); setOpenMemberId(m.id); }}
                          className="truncate rounded-sm text-left text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          {m.name}
                        </button>
                        {m.preset && <Badge tone="neutral">{presetLabel(m.preset)}</Badge>}
                      </div>
                      {/*
                        The designation, and only the designation.

                        Appending the department brought the duplication
                        straight back in a new place — "Business Development ·
                        Business Development", "Designer · Design" — and, worse,
                        brought back the inconsistency: some rows would have
                        doubled up and some would not, which is the thing that
                        looked broken in the first place. Every row is the same
                        shape now. The department is the filter above the table
                        and a column in the export; it does not need saying
                        fourteen times.
                      */}
                      <p className="truncate text-micro text-secondary">{m.designation || m.dept || '—'}</p>
                    </div>
                  </div>
                </td>
                <td className="text-center text-body">{m.openTasksCount}</td>
                <td className="text-center">
                  <span className={`text-sm font-semibold ${m.overdueTasksCount > 0 ? 'text-danger' : 'text-body'}`}>
                    {m.overdueTasksCount}
                  </span>
                </td>
                <td className="text-center">
                  <span className={`text-sm ${m.waitingTasksCount > 0 ? 'text-warning-ink' : 'text-body'}`}>
                    {m.waitingTasksCount}
                  </span>
                </td>
                {/* A dash, not "0h 0m". Four of fourteen people here have
                    never finished a task, and zero read as the fastest
                    turnaround on the screen. */}
                <td className="text-center text-body">
                  {m.avgTurnaround ?? <span className="text-secondary">—</span>}
                </td>
                <td className="">
                  <div className="flex items-center gap-3 min-w-40">
                    <div className="flex-1 bg-subtle rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getLoadColor(m.loadPercentage)}`}
                        style={{ width: `${Math.min(m.loadPercentage, 100)}%` }}
                      />
                    </div>
                    {/* "of normal" moved to the column header — it was the
                        same two words on all fourteen rows. */}
                    <span className={`w-11 shrink-0 text-right text-micro font-medium tabular-nums ${m.loadPercentage >= 100 ? 'text-danger' : 'text-secondary'}`}>
                      {m.loadPercentage}%
                    </span>
                  </div>
                </td>
                <td className="">
                  {/*
                    Five outlined buttons per row is seventy on this page, all
                    drawn the same, taking a third of the table's width — which
                    is what forced every name onto two lines. "Switch off" ends
                    an account and looked exactly like "Kit", which lists what
                    somebody is carrying.

                    `visible` rather than a wrapping conditional: `permissions`
                    is undefined for anybody the viewer cannot administer, and
                    the gate belongs on the three actions it applies to.
                  */}
                  {/* The menu is inside the row, and the row now opens the
                      drawer — without this, choosing "Switch off account"
                      would also slide the person's record open behind the
                      confirmation. */}
                  <div className="flex justify-end" onClick={(ev) => ev.stopPropagation()}>
                    <RowMenu
                      label={`Actions for ${m.name}`}
                      actions={[
                        { label: 'Assign a task', icon: Plus, onSelect: () => setAssigningTo(m) },
                        // What company kit is logged out to them. The register
                        // answers this by holder; this is the way in from the
                        // person rather than from the equipment.
                        { label: 'Kit they hold', icon: Package, onSelect: () => setKitFor(m) },
                        {
                          label: 'Access & permissions',
                          icon: ShieldCheck,
                          onSelect: () => setEditingAccessFor(m),
                          visible: m.permissions !== undefined,
                        },
                        // The only way back in for somebody locked out — there
                        // is no self-service reset (see ResetLinkModal).
                        {
                          label: 'Send a password link',
                          icon: KeyRound,
                          onSelect: () => setResettingFor(m),
                          visible: m.permissions !== undefined,
                        },
                        // Offboarding. Refused by the server while they are
                        // still holding company kit — see DeactivateModal.
                        {
                          label: 'Switch off account',
                          icon: UserMinus,
                          tone: 'danger',
                          onSelect: () => setDeactivating(m),
                          visible: m.permissions !== undefined,
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <MemberDrawer memberId={openMemberId} onClose={() => setOpenMemberId(null)} />

      {assigningTo && (
        <AssignTaskModal
          person={assigningTo}
          onClose={() => setAssigningTo(null)}
          onCreated={() => { setAssigningTo(null); void load(); }}
        />
      )}

      {inviting && (
        <InviteMemberModal
          onClose={() => setInviting(false)}
          onInvited={() => setInviting(false)}
        />
      )}

      {resettingFor && (
        <ResetLinkModal person={resettingFor} onClose={() => setResettingFor(null)} />
      )}

      {deactivating && (
        <DeactivateModal
          person={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={() => { setDeactivating(null); void load(); }}
        />
      )}

      {kitFor && (
        <Modal open onClose={() => setKitFor(null)} title={`Equipment · ${kitFor.name}`}>
          <ModalBody>
            <HeldAssets
              userId={kitFor.id}
              title="Logged out to them"
              emptyHint="Nothing is logged out to them at the moment."
            />
          </ModalBody>
        </Modal>
      )}

      {editingAccessFor && (
        <AccessModal
          person={editingAccessFor}
          onClose={() => setEditingAccessFor(null)}
          onSaved={() => { setEditingAccessFor(null); void load(); }}
        />
      )}
    </div>
  );
}
