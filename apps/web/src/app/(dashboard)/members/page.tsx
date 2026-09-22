'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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
}

export default function MembersPage() {
  /*
   * Inviting somebody needs `setup.admin`, and this button asked for nothing.
   * The screen itself only needs `work.team`, so every Head could see the
   * button, fill in the form and be refused by the server — the one control in
   * the product that promised something it could not do.
   */
  const canInvite = useAuthStore((s) => s.user?.permissions?.includes('setup.admin') ?? false);
  /** A failed load, said out loud instead of only in the console. */
  const [deptFilter, setDeptFilter] = useState('ALL');
  const queryClient = useQueryClient();
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

  /**
   * Team capacity, cached per department filter.
   *
   * Switching back to a department you already looked at is served from cache
   * instead of re-running the capacity query, which counts tasks per person.
   */
  const { data, isPending, error } = useQuery({
    queryKey: ['team', 'capacity', deptFilter],
    placeholderData: keepPreviousData,
    queryFn: () => api.team.capacity(deptFilter !== 'ALL' ? { dept: deptFilter } : {}),
  });

  const members: TeamMember[] = data?.success ? data.members : [];
  const depts: string[] = data?.success ? data.departments : [];
  const loading = isPending;
  const loadError = error instanceof Error ? error.message : error ? 'Could not load the team' : null;

  /** What the invite / access / deactivate flows call after they change something. */
  const load = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['team'] });
  }, [queryClient]);

  // Derive team stats
  const totalOpen = members.reduce((s, m) => s + m.openTasksCount, 0);
  const totalOverdue = members.reduce((s, m) => s + m.overdueTasksCount, 0);
  const totalWaiting = members.reduce((s, m) => s + m.waitingTasksCount, 0);

  /*
   * `loadPercentage` used to live here: a person's open task count against
   * their own trailing 8-week median, with a banner naming whoever sat over
   * 100%. It was removed. The arithmetic worked and what it measured did not —
   * a task is a task whether it is a two-minute rename or a three-day shoot,
   * so the ratio moved on row count rather than on work, and a quiet fortnight
   * pulled somebody's median low enough that an ordinary week came back as
   * 600%. Naming people to management on that basis is worse than saying
   * nothing.
   *
   * What is left is what the rows actually carry: open, overdue and waiting,
   * per person, each one a number you can click into and see the tasks behind.
   */
  const overdueOnPeople = members.filter((m) => m.overdueTasksCount > 0).length;

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
          <ErrorNote onDismiss={() => queryClient.resetQueries({ queryKey: ['team'] })}>{loadError}</ErrorNote>
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
          // How many people are carrying them, which is the thing a head does
          // something about — one person with nine late tasks and nine people
          // with one each are the same number and different problems.
          note={
            totalOverdue > 0
              ? `across ${overdueOnPeople} ${overdueOnPeople === 1 ? 'person' : 'people'}`
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

      {/* Delivery table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-primary">Delivery</h2>
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
              <th className=""></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <TableRowsSkeleton cols={6} />
            ) : members.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-16 text-center text-sm text-secondary">No team members found.</td></tr>
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
          onInvited={() => {
            setInviting(false);
            // `load()` is documented two hundred lines up as what "the invite /
            // access / deactivate flows call after they change something".
            // Invite was the one that did not call it, so a new member sat
            // invisible until you navigated away and back.
            load();
          }}
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
