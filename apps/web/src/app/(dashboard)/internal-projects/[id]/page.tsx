'use client';

/**
 * One piece of the studio's own work, and everything filed under it.
 *
 * The Internal tab on Live work could list these and nothing more — a name and
 * a count with no way in, so the tasks under a hiring round could be seen only
 * by hunting them out of somebody's My Work one at a time.
 *
 * There are no money tiles here and there never will be: an internal project
 * carries no client, no value and no invoice, and no cost row can point at one.
 * What it has is work, so that is the whole page.
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus } from 'lucide-react';
import { api, ApiError, formatDate } from '@/lib/api-v2';
import { useConfig, useTeamMembers } from '@/hooks/queries';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile, StatRow } from '@/components/ui/stat-tile';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { NewInternalTaskModal } from '@/components/work/NewInternalTaskModal';
import { TaskDrawer, type DrawerTask } from '@/components/work/TaskDrawer';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'DONE', label: 'Done' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export default function InternalProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const team = useTeamMembers();

  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['internal-project', id],
    queryFn: () => api.internalProjects.get(id),
  });
  const project = data?.project;

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['internal-project', id] });
    // The list on Live work counts these, so it goes stale the moment one changes.
    void queryClient.invalidateQueries({ queryKey: ['internal-projects'] });
  };

  usePageHeader(project?.name ?? 'Internal work', project?.owner?.name ?? undefined);

  const tz = config?.organization.timezone;
  const locale = config?.organization.locale;
  const date = (v: string | null | undefined) => formatDate(v, tz, locale, true);
  const canWrite = config?.me.permissions?.includes('work.all') ?? false;

  const changeStatus = async (task: any, next: string) => {
    setBusyId(task.id);
    try {
      await api.tasks.updateStatus(task.id, next);
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <div className="page-shell">
        <ErrorNote>{error instanceof Error ? error.message : 'Could not load this'}</ErrorNote>
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* Back to the list this came from — the Internal tab, not Live work's default. */}
      <Link
        href="/live-work?tab=internal"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Internal work
      </Link>

      {isPending || !project ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-semibold text-primary">{project.name}</h1>
                <Badge tone={project.status === 'ACTIVE' ? 'good' : 'neutral'}>
                  {project.status === 'ACTIVE' ? 'Active' : 'Done'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-secondary">
                {project.description || 'The studio’s own work — no client, no billing.'}
              </p>
              <p className="mt-0.5 text-micro text-secondary">
                {project.owner ? `Owned by ${project.owner.name}` : 'No owner named'}
              </p>
            </div>
            {canWrite && project.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> New task
              </button>
            )}
          </div>

          <StatRow className="mb-8">
            <StatTile dense label="Open" value={project.taskCounts.open} note="still to do" />
            <StatTile dense label="Done" value={project.taskCounts.done} note="finished" />
            <StatTile
              dense
              label="Late"
              value={project.taskCounts.late}
              note={project.taskCounts.late > 0 ? 'past their due date' : 'nothing overdue'}
            />
          </StatRow>

          <Card padding="none">
            <CardBody className="p-0">
              {project.tasks.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Nothing filed under this yet"
                    hint="Add a task here, or move an existing internal task into it from the task itself."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full data-table text-sm">
                    <thead>
                      <tr className="border-b border-border bg-subtle">
                        <th className="eyebrow text-left">Task</th>
                        <th className="eyebrow text-left">Who</th>
                        <th className="eyebrow text-left">Priority</th>
                        <th className="eyebrow text-left">Due</th>
                        <th className="eyebrow text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {project.tasks.map((t: any) => (
                        <tr
                          key={t.id}
                          className="cursor-pointer transition-colors hover:bg-subtle"
                          onClick={() => setSelected(t)}
                        >
                          <td className="font-medium text-primary">{t.title}</td>
                          <td className="text-secondary">
                            {t.assignee?.name ?? '—'}
                            {t.assignee?.designation && (
                              <span className="block text-micro text-secondary">{t.assignee.designation}</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-semibold tracking-[0.03em] ${getPriorityBadge(t.priority)}`}
                            >
                              {getPriorityLabel(t.priority)}
                            </span>
                          </td>
                          {/* Late is said on the row it applies to, not only counted in a tile. */}
                          <td className={t.isOverdue ? 'font-semibold text-danger' : 'text-secondary'}>
                            {date(t.dueDate)}
                          </td>
                          <td className="text-secondary">{STATUS_LABEL[t.status] ?? t.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {project && (
        <NewInternalTaskModal
          open={adding}
          project={{ id: project.id, name: project.name }}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      <TaskDrawer
        task={selected as DrawerTask | null}
        statusOptions={STATUS_OPTIONS}
        busy={busyId === selected?.id}
        onClose={() => setSelected(null)}
        onStatusChange={(t, next) => void changeStatus(t, next)}
        onChanged={reload}
      />
    </div>
  );
}
