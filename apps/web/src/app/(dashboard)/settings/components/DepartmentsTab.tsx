'use client';

/**
 * Settings → Departments (Departments Plan 1).
 *
 * A department is a record now, and everybody is in exactly one. This is where
 * they are named, ordered, given a head, merged and archived — and where
 * people are moved between them. A rename here shows on every screen at once,
 * because every screen points at the id.
 *
 * It replaces the free-text list under Organisation, which could not rename
 * anything (people kept the old spelling) and let "Video & Production" and
 * "Video / Production" both exist.
 *
 * Editable with `setup.admin`; everyone else sees it read-only.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, ApiError, type Department, type DepartmentPerson } from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { useConfirmStore } from '@/stores/confirm';
import { presetLabel } from '@/lib/people';
import { cn, getInitials } from '@/lib/utils';

/** Who may head a department: Department head or Management access. */
const HEAD_PRESETS = ['HEAD', 'MANAGEMENT'];
const HEAD_HINT = 'To make someone a head, first give them Department head access in Team → Access.';

const selectCls =
  'h-8 rounded-lg border border-border bg-white px-2 text-xs text-body outline-none focus:border-primary disabled:opacity-50';

/** "Video", "Video and Design", "Video, Design and Content". */
const andList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function PersonRow({
  person,
  canEdit,
  moveTargets,
  selected,
  onToggle,
  onMove,
}: {
  person: DepartmentPerson;
  canEdit: boolean;
  moveTargets: { id: string; name: string }[];
  selected?: boolean;
  onToggle?: () => void;
  onMove: (departmentId: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
      {canEdit && onToggle && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          onChange={onToggle}
          aria-label={`Select ${person.name}`}
          className="h-4 w-4 rounded border-border accent-primary"
        />
      )}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-white" aria-hidden="true">
        {getInitials(person.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm text-primary">{person.name}</span>
        {person.designation && <span className="ml-2 text-xs text-secondary">{person.designation}</span>}
      </span>
      <Badge tone="neutral">{presetLabel(person.preset)}</Badge>
      {canEdit && (
        <select
          aria-label={`Move ${person.name} to another department`}
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className={selectCls}
        >
          <option value="">Move to…</option>
          {moveTargets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

function DepartmentCard({
  dept,
  index,
  count,
  canEdit,
  others,
  headCandidates,
  onRename,
  onHead,
  onMoveUp,
  onMoveDown,
  onMerge,
  onArchive,
  onMovePeople,
}: {
  dept: Department;
  index: number;
  count: number;
  canEdit: boolean;
  others: { id: string; name: string }[];
  headCandidates: DepartmentPerson[];
  onRename: (name: string) => Promise<boolean>;
  onHead: (headId: string | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMerge: (intoId: string) => void;
  onArchive: () => void;
  onMovePeople: (userIds: string[], departmentId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(dept.name);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const people = dept.people ?? [];
  const busy = dept.peopleCount > 0;

  const saveName = async () => {
    if (!name.trim() || name.trim() === dept.name) {
      setRenaming(false);
      setName(dept.name);
      return;
    }
    if (await onRename(name.trim())) setRenaming(false);
  };

  return (
    <section aria-label={dept.name} className="rounded-card border border-border bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {renaming ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Department name"
              maxLength={60}
              className="h-8 w-56 rounded-lg border border-primary/40 px-2 text-sm text-primary outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setRenaming(false);
                  setName(dept.name);
                }
              }}
            />
            <button type="submit" aria-label="Save the name" className="rounded p-1 text-success hover:bg-subtle">
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Keep the old name"
              onClick={() => {
                setRenaming(false);
                setName(dept.name);
              }}
              className="rounded p-1 text-secondary hover:bg-subtle"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            {dept.name}
            {canEdit && (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                aria-label={`Rename ${dept.name}`}
                className="rounded p-0.5 text-secondary hover:bg-subtle hover:text-primary"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </h3>
        )}
        <span className="rounded-full bg-subtle px-1.5 py-px text-micro tabular-nums text-secondary">
          {dept.peopleCount} {dept.peopleCount === 1 ? 'person' : 'people'}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            Head
            <select
              aria-label={`Head of ${dept.name}`}
              value={dept.headId ?? ''}
              disabled={!canEdit}
              onChange={(e) => onHead(e.target.value || null)}
              title={HEAD_HINT}
              className={selectCls}
            >
              <option value="">No head</option>
              {headCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <>
              <button type="button" onClick={onMoveUp} disabled={index === 0} aria-label={`Move ${dept.name} up`} className="rounded p-1 text-secondary hover:bg-subtle disabled:opacity-30">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === count - 1}
                aria-label={`Move ${dept.name} down`}
                className="rounded p-1 text-secondary hover:bg-subtle disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="px-4 py-1">
        {people.length === 0 ? (
          <p className="py-3 text-sm text-secondary">Nobody in it yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                canEdit={canEdit}
                moveTargets={others}
                selected={selected.has(p.id)}
                onToggle={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  })
                }
                onMove={(to) => onMovePeople([p.id], to)}
              />
            ))}
          </ul>
        )}
      </div>

      {canEdit && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          {selected.size > 0 && (
            <select
              aria-label={`Move the ${selected.size} selected`}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                onMovePeople([...selected], e.target.value);
                setSelected(new Set());
              }}
              className={selectCls}
            >
              <option value="">Move {selected.size} selected…</option>
              {others.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={`Merge ${dept.name} into another department`}
            value=""
            onChange={(e) => e.target.value && onMerge(e.target.value)}
            className={selectCls}
          >
            <option value="">Merge into…</option>
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onArchive}
            disabled={busy}
            className={cn(
              'ml-auto rounded-lg px-2 py-1 text-xs font-medium',
              busy ? 'cursor-not-allowed text-secondary' : 'text-secondary hover:bg-danger-tint hover:text-danger',
            )}
          >
            {busy ? `Move its ${dept.peopleCount} ${dept.peopleCount === 1 ? 'person' : 'people'} first, or merge it.` : 'Archive'}
          </button>
        </footer>
      )}
    </section>
  );
}

export function DepartmentsTab({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ['departments', 'settings', canEdit],
    queryFn: () => api.departments.list({ includeArchived: canEdit, withPeople: true }),
  });

  const all = data?.departments ?? [];
  const active = all.filter((d) => !d.archived);
  const archived = all.filter((d) => d.archived);
  const unplaced = data?.unplaced ?? [];
  // Department head access with no department to lead: their view is not
  // limited yet, so they still see everybody.
  const leadingNothing = (data?.headsLeadingNothing ?? []).map((p) => p.name);

  // Anybody with Department head or Management access, wherever they sit.
  const headCandidates = useMemo(
    () =>
      [...active.flatMap((d) => d.people ?? []), ...unplaced]
        .filter((p) => HEAD_PRESETS.includes(p.preset))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [active, unplaced],
  );
  const noHead = active.filter((d) => !d.headId).map((d) => d.name);

  /** Every list of departments on every screen is now out of date. */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['departments'] });
    void queryClient.invalidateQueries({ queryKey: ['team'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
  };
  const attempt = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) toast.success(done);
      refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'That did not go through.');
      return false;
    }
  };

  /** Up or down one place: the whole order rewritten, so equal numbers can never tie. */
  const reorder = (from: number, to: number) => {
    const order = [...active];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    void attempt(() =>
      Promise.all(order.map((d, i) => (d.sortOrder === i ? null : api.departments.update(d.id, { sortOrder: i }))).filter(Boolean)),
    );
  };

  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-subtle" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the departments.'}</ErrorNote>;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Departments"
        description={
          canEdit
            ? 'Everybody is in one department. Rename, reorder, set a head, move people, merge or archive — every screen follows.'
            : 'Everybody is in one department. Only an admin can change them.'
        }
        aside={
          canEdit ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                setAdding(true);
                if (await attempt(() => api.departments.create(newName.trim()), `${newName.trim()} added`)) setNewName('');
                setAdding(false);
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New department"
                aria-label="New department name"
                maxLength={60}
                className="h-8 w-40 rounded-lg border border-border px-2 text-sm outline-none focus:border-primary"
              />
              <Button size="sm" type="submit" icon={Plus} loading={adding} disabled={!newName.trim()}>
                Add
              </Button>
            </form>
          ) : null
        }
        bodyClassName="space-y-3"
      >
        {noHead.length > 0 && (
          <Note tone="warn">
            {andList(noHead)} {noHead.length === 1 ? 'has' : 'have'} no head yet.
            {canEdit && headCandidates.length === 0 ? ` ${HEAD_HINT}` : ''}
          </Note>
        )}
        {leadingNothing.length > 0 && (
          <Note tone="info">
            {andList(leadingNothing)} {leadingNothing.length === 1 ? 'has' : 'have'} Department head access but{' '}
            {leadingNothing.length === 1 ? 'leads' : 'lead'} no department, so still{' '}
            {leadingNothing.length === 1 ? 'sees' : 'see'} everyone.
            {canEdit ? ' Make them the head of their department below, or change their access in Team → Access.' : ''}
          </Note>
        )}
        {canEdit && <p className="text-xs text-secondary">{HEAD_HINT}</p>}
      </SectionCard>

      {/* Anyone not yet placed, until they are. */}
      {unplaced.length > 0 && (
        <section aria-label="No department" className="rounded-card border border-warning/40 bg-warning-tint/40">
          <header className="flex items-center gap-2 border-b border-warning/30 px-4 py-3">
            <h3 className="text-sm font-semibold text-primary">No department</h3>
            <span className="rounded-full bg-white px-1.5 py-px text-micro tabular-nums text-warning-ink">{unplaced.length}</span>
            <span className="text-xs text-secondary">Everybody needs one. Move each person into theirs.</span>
          </header>
          <ul className="divide-y divide-border px-4 py-1">
            {unplaced.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                canEdit={canEdit}
                moveTargets={active}
                onMove={(to) => void attempt(() => api.departments.movePeople([p.id], to), `${p.name} moved`)}
              />
            ))}
          </ul>
        </section>
      )}

      {active.map((d, i) => {
        const others = active.filter((o) => o.id !== d.id).map((o) => ({ id: o.id, name: o.name }));
        return (
          <DepartmentCard
            key={d.id}
            dept={d}
            index={i}
            count={active.length}
            canEdit={canEdit}
            others={others}
            headCandidates={headCandidates}
            onRename={(name) => attempt(() => api.departments.update(d.id, { name }), `Renamed to ${name}`)}
            onHead={(headId) => void attempt(() => api.departments.update(d.id, { headId }), headId ? 'Head set' : 'Head removed')}
            onMoveUp={() => reorder(i, i - 1)}
            onMoveDown={() => reorder(i, i + 1)}
            onMerge={async (intoId) => {
              const into = active.find((o) => o.id === intoId)!;
              const ok = await confirm({
                title: `Merge ${d.name} into ${into.name}?`,
                message: `${d.peopleCount ? `Its ${d.peopleCount} ${d.peopleCount === 1 ? 'person moves' : 'people move'} to ${into.name}, and ` : ''}${d.name} is archived. Its name stays in history.`,
                confirmText: 'Merge',
                variant: 'warning',
              });
              if (ok) void attempt(() => api.departments.merge(d.id, intoId), `Merged into ${into.name}`);
            }}
            onArchive={async () => {
              const ok = await confirm({
                title: `Archive ${d.name}?`,
                message: 'It leaves every picker and filter. Its name stays in history, and it can be restored.',
                confirmText: 'Archive',
                variant: 'warning',
              });
              if (ok) void attempt(() => api.departments.archive(d.id), `${d.name} archived`);
            }}
            onMovePeople={(userIds, to) =>
              void attempt(() => api.departments.movePeople(userIds, to), userIds.length === 1 ? 'Moved' : `${userIds.length} moved`)
            }
          />
        );
      })}

      {canEdit && archived.length > 0 && (
        <SectionCard title="Archived" description="Out of every picker. Their names stay in history." bodyClassName="divide-y divide-border">
          {archived.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-secondary">{d.name}</span>
              <button
                type="button"
                onClick={() => void attempt(() => api.departments.restore(d.id), `${d.name} restored`)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}
