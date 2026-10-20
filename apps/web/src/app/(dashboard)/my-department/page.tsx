'use client';

/**
 * My Department — a department head's one place for their people and
 * everything those people are working on (Department head page plan).
 *
 * People · Work · Calendar · Approvals · Equipment · Time split, under a header
 * with the department, how many people, and what needs attention. It replaced
 * Team → Board, which showed task counts and nothing else.
 *
 * Who sees it: the department's head, from their sidebar; Management, from
 * Settings → Departments. The layout refuses anybody else before this mounts,
 * and every request behind it asks the server the same question again — a
 * head of one department opening another's gets the server's refusal.
 *
 * Never here: rankings, scores, timers, "overloaded" labels, or money.
 */

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useConfig, useDepartments, useTeamMembers } from '@/hooks/queries';
import { useAuthStore } from '@/stores';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Select } from '@/components/ui/select';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { NotFoundPanel } from '@/components/ui/not-found-panel';
import { ScreenMessage } from '@/components/ui/screen-message';
import { TaskDrawer } from '@/components/work/TaskDrawer';
import { AssignTaskModal } from '@/components/work/AssignTaskModal';
import { changeTaskStatus } from '@/lib/task-status';
import { plural } from '@/lib/utils';
import { AttentionList } from '@/components/department/AttentionList';
import { PeopleTab } from '@/components/department/PeopleTab';
import { PersonPanel } from '@/components/department/PersonPanel';
import { WorkTab } from '@/components/department/WorkTab';
import { CalendarTab } from '@/components/department/CalendarTab';
import { ApprovalsTab } from '@/components/department/ApprovalsTab';
import { EquipmentTab } from '@/components/department/EquipmentTab';
import { TimeSplitTab, useDepartmentAllocations } from '@/components/department/TimeSplitTab';
import { TASK_STATUS_OPTIONS, statusLabel, toDrawerTask } from '@/components/department/boardBits';

type Tab = 'people' | 'work' | 'calendar' | 'approvals' | 'equipment' | 'time-split';

const TABS: TabDef<Tab>[] = [
  { key: 'people', label: 'People' },
  { key: 'work', label: 'Work' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'time-split', label: 'Time split' },
];

export default function MyDepartmentPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MyDepartment />
    </Suspense>
  );
}

function MyDepartment() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const preset = useAuthStore((s) => s.user?.preset);
  const { data: config } = useConfig();
  const { departments, loading: departmentsLoading } = useDepartments();
  const team = useTeamMembers();
  const [tab, setTab] = useTabState(TABS);

  /*
   * Which departments the switcher offers: the ones they head — or, for
   * Management, every department, since they reach this page from Settings to
   * look at any of them.
   */
  const headed = config?.me.headOf;
  const choices = useMemo(
    () => (preset === 'MANAGEMENT' ? departments.map((d) => ({ id: d.id, name: d.name })) : (headed ?? [])),
    [preset, departments, headed],
  );
  const departmentId = searchParams.get('department') || choices[0]?.id || '';

  const { data: overview, error, isPending, refetch } = useQuery({
    queryKey: ['department', departmentId, 'overview'],
    enabled: Boolean(departmentId),
    queryFn: () => api.departments.overview(departmentId),
  });

  const month = overview?.month ?? '';
  const { data: allocations } = useDepartmentAllocations(departmentId, month);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  usePageHeader(
    'My department',
    overview ? `${overview.department.name} · ${plural(overview.department.peopleCount, 'person', 'people')}` : null,
  );

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['department', departmentId] });

  const switchTo = (id: string) => {
    setPersonId(null);
    setOpenTaskId(null);
    const q = new URLSearchParams(searchParams.toString());
    q.set('department', id);
    router.replace(`/my-department?${q}`, { scroll: false });
  };

  const setStatus = async (t: { id: string; status: string; title?: string; hasClient?: boolean }, next: string) => {
    setBusy(true);
    try {
      if (!(await changeTaskStatus(t, next))) return;
      toast.success(`Moved to ${statusLabel(next)}`);
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update that task');
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show yet: Management with no departments set up, or a head whose list is still loading.
  if (!departmentId) {
    if (!config || (preset === 'MANAGEMENT' && departmentsLoading)) return <PageSkeleton />;
    return (
      <div className="page-shell">
        <ScreenMessage
          icon={Lock}
          title="No department to show"
          message="Departments and their heads are set in Settings → Departments."
          actions={[{ label: 'Go to My Work', href: '/my-work', primary: true }]}
        />
      </div>
    );
  }

  if (error && !overview) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <div className="page-shell">
          <ScreenMessage
            icon={Lock}
            title="This isn't your department"
            message={error.message}
            actions={[{ label: 'Go to My Work', href: '/my-work', primary: true }]}
          />
        </div>
      );
    }
    return (
      <div className="page-shell">
        <NotFoundPanel thing="department" error={error} back={{ href: '/my-work', label: 'Go to My Work' }} onRetry={() => refetch()} />
      </div>
    );
  }

  if (isPending || !overview) return <PageSkeleton />;

  const openTask = openTaskId && overview.tasks[openTaskId] ? toDrawerTask(overview.tasks[openTaskId]) : null;
  const person = personId ? (overview.people.find((p) => p.id === personId) ?? null) : null;
  const personSplit = person ? (allocations ? (allocations.members.find((m) => m.id === person.id) ?? null) : undefined) : undefined;

  return (
    <div className="page-shell space-y-6">
      {/* The department, its head, and — for anybody with more than one — the switch. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Department</p>
          <h2 className="truncate text-xl font-semibold text-primary">{overview.department.name}</h2>
          <p className="text-xs text-secondary">
            {plural(overview.department.peopleCount, 'person', 'people')}
            {overview.department.headName ? ` · Head: ${overview.department.headName}` : ' · No head set'}
          </p>
        </div>
        {choices.length > 1 && (
          <div className="w-full sm:w-64">
            <Select
              ariaLabel="Which department"
              value={departmentId}
              onChange={switchTo}
              options={choices.map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
        )}
      </div>

      <AttentionList overview={overview} onOpenTask={setOpenTaskId} onTimeSplit={() => setTab('time-split')} />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'people' && (
        <PeopleTab overview={overview} onOpenPerson={setPersonId} onOpenTask={setOpenTaskId} onAssign={setAssigning} />
      )}
      {tab === 'work' && <WorkTab departmentId={departmentId} />}
      {tab === 'calendar' && <CalendarTab overview={overview} timezone={config?.organization.timezone ?? 'Asia/Kolkata'} />}
      {tab === 'approvals' && <ApprovalsTab departmentId={departmentId} onOpenTask={setOpenTaskId} />}
      {tab === 'equipment' && <EquipmentTab overview={overview} />}
      {tab === 'time-split' && <TimeSplitTab departmentId={departmentId} departmentName={overview.department.name} month={overview.month} />}

      <PersonPanel
        person={person}
        overview={overview}
        allocation={personSplit}
        onClose={() => setPersonId(null)}
        onOpenTask={setOpenTaskId}
        onAssign={setAssigning}
      />

      {/* Reassign, move the due date, or change the status — the task drawer every list uses. */}
      <TaskDrawer
        task={openTask}
        statusOptions={TASK_STATUS_OPTIONS}
        team={team}
        busy={busy}
        onClose={() => setOpenTaskId(null)}
        onStatusChange={(t, next) => void setStatus(t, next)}
        onChanged={() => void refreshAll()}
      />

      {assigning && (
        <AssignTaskModal
          person={assigning}
          onClose={() => setAssigning(null)}
          onCreated={() => {
            setAssigning(null);
            void refreshAll();
          }}
        />
      )}
    </div>
  );
}
