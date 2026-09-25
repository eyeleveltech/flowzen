'use client';

/**
 * The studio's own work, as named pieces.
 *
 * Internal tasks had nowhere to live: `workType: INTERNAL` was the whole
 * filing, so the website refresh, a hiring round, GST filing prep and an office
 * Wi-Fi renewal sat in one flat list, told apart only by who happened to be
 * holding them.
 *
 * These are buckets and nothing more. There is no client on one, no value, no
 * invoice, and no cost points at one — see routes/internalProjects.ts on why
 * that is a schema guarantee rather than a convention. They exist to group
 * tasks, which is why they live in Settings beside Departments rather than
 * anywhere near the money.
 *
 * Nothing is backfilled when one is created. A task that already exists is
 * filed by opening it and choosing a bucket, which is what the drawer's "Which
 * work" field is for.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type InternalProject } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { useTeamMembers } from '@/hooks/queries';
import { personOptions } from '@/lib/people';
import { useConfirmStore } from '@/stores/confirm';

export function InternalWorkSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const team = useTeamMembers();
  const confirm = useConfirmStore((st) => st.confirm);

  const { data, isPending } = useQuery({
    queryKey: ['internal-projects'],
    // Everything, not just the active ones: a closed piece of work still has to
    // be findable to be reopened.
    queryFn: () => api.internalProjects.list(),
  });
  const projects: InternalProject[] = data?.projects ?? [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => queryClient.invalidateQueries({ queryKey: ['internal-projects'] });

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.internalProjects.create({ name: name.trim(), ownerId: ownerId || null });
      toast.success(`${name.trim()} added`);
      setName('');
      setOwnerId('');
      setAdding(false);
      void reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not add that');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (p: InternalProject, status: 'ACTIVE' | 'DONE') => {
    try {
      await api.internalProjects.update(p.id, { status });
      toast.success(status === 'DONE' ? `${p.name} marked done` : `${p.name} reopened`);
      void reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    }
  };

  const remove = async (p: InternalProject) => {
    // Only an empty one, and the server enforces it too. Deleting a bucket with
    // work under it would quietly unfile every task in it, and nothing
    // afterwards could tell those apart from tasks never filed at all.
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      message: 'Nothing has been filed under it, so nothing is lost.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.internalProjects.remove(p.id);
      toast.success(`${p.name} deleted`);
      void reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete that');
    }
  };

  return (
    <SectionCard
      title="Internal work"
      description="Named pieces of the studio's own work — a hiring round, the website, compliance — for internal tasks to be grouped under. They carry no client and no money; they only organise the work."
      aside={
        canEdit && !adding ? (
          <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        ) : null
      }
    >
      {adding && (
        <div className="rounded-xl border border-border bg-subtle/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              value={name}
              onChange={setName}
              required
              disabled={busy}
              placeholder="e.g. Hiring, Studio website, Compliance"
            />
            <FieldSelect
              label="Owner"
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Nobody in particular"
              options={personOptions(team)}
              disabled={busy}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setName('');
                setOwnerId('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void add()} loading={busy} disabled={!name.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}

      {isPending ? (
        <p className="text-xs text-secondary">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-xs text-secondary">
          Nothing yet. Internal tasks work perfectly well without one — add a piece of work when you have several tasks
          that belong together.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${p.status === 'DONE' ? 'text-secondary' : 'text-primary'}`}>
                  {p.name}
                  {p.status === 'DONE' && <span className="ml-2 text-micro font-normal text-secondary">done</span>}
                </p>
                <p className="mt-0.5 text-micro text-secondary">
                  {p.taskCounts.total === 0
                    ? 'Nothing filed under it yet'
                    : `${p.taskCounts.open} open of ${p.taskCounts.total}${p.taskCounts.late > 0 ? ` · ${p.taskCounts.late} late` : ''}`}
                  {p.owner ? ` · ${p.owner.name}` : ''}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setStatus(p, p.status === 'DONE' ? 'ACTIVE' : 'DONE')}
                    className="rounded-lg border border-border px-2.5 py-1 text-micro font-medium text-body transition-colors hover:bg-subtle"
                  >
                    {p.status === 'DONE' ? 'Reopen' : 'Mark done'}
                  </button>
                  {/* Deleting is only ever offered for an empty one — anything
                      that has held work is closed instead, so the record of
                      where that work sat survives. */}
                  {p.taskCounts.total === 0 && (
                    <button
                      type="button"
                      onClick={() => void remove(p)}
                      aria-label={`Delete ${p.name}`}
                      title="Delete"
                      className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
