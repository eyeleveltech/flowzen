'use client';

/**
 * One task, opened.
 *
 * ─── Why a drawer and not a wider row ───────────────────────────────────────
 *
 * A task list is scanned; a task is read. The list answers "what is late and
 * whose is it", and everything else about a task — the note somebody left, how
 * many times it has been reopened, which client and which piece of work it
 * hangs off — is detail that would turn every row into a paragraph if it had
 * to live in the table. So the table stays scannable and this holds the rest.
 *
 * ─── Editing ────────────────────────────────────────────────────────────────
 *
 * Until now the only field anybody could change after creation was the note.
 * A task typed with the wrong due date, or handed to the wrong person, could
 * only be cancelled and typed again — which loses the thread and leaves a
 * cancelled row behind pretending somebody decided not to do the work.
 *
 * ─── Deleting ───────────────────────────────────────────────────────────────
 *
 * Soft, per §16, and undoable from the toast rather than from a trash screen —
 * a task is an everyday object and the moment you want it back is the second
 * after it goes. The server refuses outright once a task is finished, because
 * its timing already counts towards how long this kind of work takes.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { api, formatDate } from '@/lib/api-v2';
import { useConfirmStore } from '@/stores';
import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field, FieldSelect } from '@/components/ui/field';
import { MultiSelect } from '@/components/ui/multi-select';
import { TASK_TYPE_OPTIONS, taskTypeLabel } from '@/lib/task-type';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPriorityBadge, getPriorityLabel } from '@/lib/priority';
import { plural } from '@/lib/utils';
import { personLine, personOptions } from '@/lib/people';

export type DrawerTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
  assignedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
  reopenCount?: number;
  waitingOn?: 'CLIENT' | 'ANOTHER_PERSON' | null;
  /** The lead — the first of `assignees`, kept apart so "whose task" always has an answer. */
  assignee?: { id: string; name: string; designation?: string | null } | null;
  /** Everybody on it, the lead included. */
  assignees?: { id: string; name: string; designation?: string | null }[];
  /** Who asked for the work. Chosen on the form; falls back to `creator`. */
  assignedBy?: { id: string; name: string; designation?: string | null } | null;
  /** Who typed it in. Only worth showing when it is somebody else. */
  creator?: { id: string; name: string; designation?: string | null } | null;
  /** Who checks it before it counts as done. */
  reviewer?: { id: string; name: string; designation?: string | null } | null;
  taskType?: string | null;
  /** Everything below is context the caller knows and the task row does not carry. */
  clientName?: string | null;
  clientHref?: string | null;
  workLabel?: string | null;
  workHref?: string | null;
  projectName?: string | null;
  projectHref?: string | null;
  /** My Work computes these; nothing else does. */
  workingHoursText?: string | null;
  typeMedianText?: string | null;
};

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/** The date input wants `YYYY-MM-DD`; the API sends a full ISO timestamp. */
const dateValue = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function TaskDrawer({
  task,
  statusOptions,
  team,
  busy = false,
  onClose,
  onStatusChange,
  onChanged,
}: {
  task: DrawerTask | null;
  statusOptions: { value: string; label: string }[];
  /** Assignee choices. Omit to leave the assignee read-only — a screen with no roster should not offer a picker it cannot fill. */
  team?: { id: string; name: string; dept?: string }[];
  busy?: boolean;
  onClose: () => void;
  onStatusChange: (t: DrawerTask, next: string) => void;
  /** Called after any edit, delete or restore, so the caller can refetch. */
  onChanged: () => void;
}) {
  const confirm = useConfirmStore((s) => s.confirm);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assignedById, setAssignedById] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [taskType, setTaskType] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [notes, setNotes] = useState('');

  // Reset to the task in front of you whenever it changes, including when the
  // drawer is closed and reopened on a different row — otherwise the form
  // keeps the last task's title and offers to save it onto this one.
  useEffect(() => {
    setEditing(false);
    setTitle(task?.title ?? '');
    // Falls back to the lead when a caller has not sent the whole set, so a
    // screen that only knows one person still opens a usable form.
    setAssigneeIds(task?.assignees?.map((a) => a.id) ?? (task?.assignee ? [task.assignee.id] : []));
    setAssignedById(task?.assignedBy?.id ?? task?.creator?.id ?? '');
    setReviewerId(task?.reviewer?.id ?? '');
    setTaskType(task?.taskType ?? '');
    setDueDate(dateValue(task?.dueDate));
    setPriority(task?.priority ?? 'MEDIUM');
    setNotes(task?.notes ?? '');
  }, [task]);

  if (!task) return null;

  const finished = task.status === 'DONE' || task.status === 'CANCELLED';

  const save = async () => {
    if (!title.trim()) {
      toast.error('A task needs a title');
      return;
    }
    setSaving(true);
    try {
      await api.tasks.update(task.id, {
        title: title.trim(),
        dueDate,
        priority,
        notes: notes.trim() || null,
        ...(team && assignedById ? { assignedById } : {}),
        reviewerId: reviewerId || null,
        taskType: taskType || null,
        ...(team && assigneeIds.length > 0 ? { assigneeIds } : {}),
      });
      toast.success('Task updated');
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      message: `"${task.title}" will be removed from this list. You can put it back from the message that appears.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await api.tasks.remove(task.id);
      onClose();
      onChanged();
      // Undo lives here rather than behind a trash screen: the moment somebody
      // wants a task back is the second after it goes, and §16 asks for a way
      // back, not for a filing cabinet.
      toast.success(
        (t) => (
          <span className="flex items-center gap-3">
            Task deleted
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  await api.tasks.restore(task.id);
                  toast.success('Task restored');
                  onChanged();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not restore that task');
                }
              }}
              className="rounded-sm font-semibold text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 8000 },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete that task');
    }
  };

  return (
    <Drawer
      isOpen={Boolean(task)}
      onClose={onClose}
      variant="slideover"
      title={editing ? 'Edit task' : task.title}
      description={editing ? undefined : (task.clientName ?? undefined)}
    >
      {/*
        The slideover hands its child the bare panel — no padding, no column —
        unlike the bottom sheet, which pads for you. Without this wrapper the
        content ran to both edges and the detail block's right border was cut
        off by the panel. `flex h-full flex-col` is the pairing the Drawer's
        own comment documents: the body takes the free space and scrolls
        inside itself, and the actions sit on the bottom edge instead of
        stopping wherever the content happened to end.

        px-6 / py-5 and the footer below are ModalBody and ModalFooter's
        measurements, so a task opened in a drawer is spaced like every other
        dialog in the product.
      */}
      <div className="flex h-full flex-col">
        {editing ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <Field label="Title" value={title} onChange={setTitle} required />
              {team && (
                <div>
                  <label className="eyebrow mb-1.25 block">
                    Assigned to <span className="text-danger">*</span>
                  </label>
                  {/*
                    Several people, because several people do the work. The
                    first is the lead — the one a person's load, the overload
                    alerts and "whose task is this" all resolve to — so the
                    order in this list is not decoration.

                    Names only: `User.name` used to read "Janani (Head,
                    Design)", and now that the title lives in its own column
                    appending it back would put it there twice.
                  */}
                  <MultiSelect
                    compact={false}
                    showSelectAll={false}
                    value={assigneeIds}
                    onChange={setAssigneeIds}
                    ariaLabel="Assigned to"
                    placeholder="Nobody yet"
                    options={personOptions(team)}
                  />
                  {assigneeIds.length > 1 && (
                    <p className="mt-1 text-micro text-secondary">
                      The first is the lead. It counts on all of their desks.
                    </p>
                  )}
                </div>
              )}
              {team && (
                <FieldSelect
                  label="Assigned by"
                  value={assignedById}
                  onChange={setAssignedById}
                  placeholder="Nobody in particular"
                  options={personOptions(team)}
                />
              )}
              {team && (
                <FieldSelect
                  label="Reviewer"
                  value={reviewerId}
                  onChange={setReviewerId}
                  placeholder="Nobody reviews it"
                  options={personOptions(team)}
                />
              )}
              <FieldSelect
                label="Type of work"
                value={taskType}
                onChange={setTaskType}
                placeholder="Not set"
                options={TASK_TYPE_OPTIONS}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Due date" type="date" value={dueDate} onChange={setDueDate} required />
                <FieldSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
              </div>
              <Field
                label="Notes"
                value={notes}
                onChange={setNotes}
                textarea
                rows={4}
                placeholder="Anything whoever picks this up needs to know"
              />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-surface px-6 py-4">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <Eyebrow>Status</Eyebrow>
                <Select
                  value={task.status}
                  onChange={(v) => onStatusChange(task, v)}
                  options={statusOptions}
                  ariaLabel="Status"
                  disabled={busy}
                  className="mt-1.5 w-full"
                />
              </div>

              <Card padding="none" className="overflow-hidden">
                <dl className="divide-y divide-border text-sm">
                        {/* `personLine` rather than `name`: the job title lives in
                      its own column now, and this row is where somebody checks
                      they handed the work to the right people. */}
                  <Row
                    label="Assigned to"
                    value={
                      task.assignees && task.assignees.length > 1
                        ? task.assignees.map((a) => a.name).join(', ')
                        : personLine(task.assignee)
                    }
                  />
                  {/* Who asked for the work. Falls back to whoever typed it
                      in, which is the same person on all but the tasks
                      somebody wrote up on another person's behalf. */}
                  {(task.assignedBy ?? task.creator) && (
                    <Row label="Assigned by" value={personLine(task.assignedBy ?? task.creator)} />
                  )}
                  {/* And only when those are two different people: the row
                      earns its place by disagreeing with the one above it.
                      Shown rather than hidden because "Janani asked for this"
                      is a claim somebody typed, and who typed it is the
                      answer to whether it is true. */}
                  {task.creator && task.assignedBy && task.creator.id !== task.assignedBy.id && (
                    <Row label="Added by" value={personLine(task.creator)} />
                  )}
                  {task.reviewer && <Row label="Reviewed by" value={personLine(task.reviewer)} />}
                  {taskTypeLabel(task.taskType) && <Row label="Type of work" value={taskTypeLabel(task.taskType)} />}
                  {task.assignedAt && <Row label="Assigned on" value={formatDate(task.assignedAt)} />}
                  <Row label="Due" value={formatDate(task.dueDate)} />
                  <Row
                    label="Priority"
                    value={
                      <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-micro font-semibold tracking-[0.03em] ${getPriorityBadge(task.priority)}`}>
                        {getPriorityLabel(task.priority)}
                      </span>
                    }
                  />
                  {/*
                    A month card's task never has a project and a project's
                    task never has a month card — the two are mutually
                    exclusive in the data, so each row appears only where it
                    means something rather than as a dash.
                  */}
                  {task.clientName && (
                    <Row
                      label="Client"
                      value={
                        task.clientHref ? (
                          <DrawerLink href={task.clientHref}>{task.clientName}</DrawerLink>
                        ) : (
                          task.clientName
                        )
                      }
                    />
                  )}
                  {task.workLabel && (
                    <Row
                      label="Work"
                      value={
                        task.workHref ? <DrawerLink href={task.workHref}>{task.workLabel}</DrawerLink> : task.workLabel
                      }
                    />
                  )}
                  {task.projectName && (
                    <Row
                      label="Project"
                      value={
                        task.projectHref ? (
                          <DrawerLink href={task.projectHref}>{task.projectName}</DrawerLink>
                        ) : (
                          task.projectName
                        )
                      }
                    />
                  )}
                  {task.workingHoursText && (
                    <Row
                      label={finished ? 'Time taken' : 'Open for'}
                      value={
                        task.typeMedianText
                          ? `${task.workingHoursText} (usually ~${task.typeMedianText})`
                          : task.workingHoursText
                      }
                    />
                  )}
                  {Boolean(task.reopenCount) && <Row label="Reopened" value={plural(task.reopenCount!, 'time')} />}
                  {task.status === 'ON_HOLD' && task.waitingOn && (
                    <Row
                      label="Waiting on"
                      value={
                        <Badge tone="warn">
                          {task.waitingOn === 'ANOTHER_PERSON' ? 'Another person' : 'The client'}
                        </Badge>
                      }
                    />
                  )}
                </dl>
              </Card>

              <div>
                <Eyebrow>Notes</Eyebrow>
                {task.notes ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-primary">{task.notes}</p>
                ) : (
                  <p className="mt-1.5 rounded-xl border border-dashed border-line bg-subtle/40 px-3.5 py-3 text-sm text-secondary">
                    Nothing written down yet. Edit the task to leave one.
                  </p>
                )}
              </div>
            </div>

            {/*
              Destructive on the left, everything else on the right, with the
              full width of the panel between them. Delete and Edit sitting
              side by side puts a millimetre between the two, and only one of
              them needs the toast noticed to be taken back.

              It keeps its word. A bare bin icon in a corner is the smallest,
              least labelled thing in the drawer and also the only one that
              removes something.
            */}
            <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-surface px-6 py-4">
              {/*
                Hidden once a task is finished rather than shown and refused:
                the server says no, and a button whose only outcome is an error
                message is a worse way to say that than not offering it.
              */}
              {!finished && (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  className="text-danger hover:bg-danger-tint hover:text-danger"
                  onClick={() => void remove()}
                >
                  Delete
                </Button>
              )}
              <Button variant="ghost" className="ml-auto" onClick={onClose}>
                Close
              </Button>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-secondary">{label}</dt>
      {/* `min-w-0` so a long client name truncates instead of pushing the row
          wider than the panel, which is what put the card's right border off
          the edge of the screen. */}
      <dd className="min-w-0 truncate text-right font-medium text-primary">{value}</dd>
    </div>
  );
}

function DrawerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm underline underline-offset-2 outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </Link>
  );
}
