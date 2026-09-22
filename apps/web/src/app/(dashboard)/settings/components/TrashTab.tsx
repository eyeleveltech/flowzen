'use client';

/**
 * §16: "Soft delete only... Nothing is ever hard deleted by a user." A soft
 * delete with no way back into view is a hard delete with extra rows, so this
 * is that way back.
 *
 * It used to list three of the six things that soft-delete. Proposals,
 * assets and tasks all had a working restore route and nothing that listed
 * what had been deleted — for a task that meant the only way to reach restore
 * was to still have its drawer open from before you deleted it.
 *
 * ─── On permissions ─────────────────────────────────────────────────────────
 *
 * The five routes are not one tier. Projects, costs and assets are
 * setup.admin; proposals are pipeline.write; tasks are your own work. The old
 * version fetched all of them and swallowed every failure into an empty array,
 * so somebody without setup.admin was told "Nothing in the trash" when the
 * truth was "you cannot see it" — the one answer a recovery screen must never
 * give wrongly. Each section is now asked for only when the caller can read
 * it, and the ones left out are named at the bottom rather than pretended
 * empty.
 */

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, formatDate, formatMoney } from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { plural } from '@/lib/utils';
import toast from 'react-hot-toast';

type Deleted = {
  id: string;
  title: string;
  subtitle: string;
  deletedAt: string;
};

/** One kind of deleted thing: what it needs to be read, listed and put back. */
type Section = {
  key: string;
  heading: string;
  /** Empty means everybody — a task's own trash is scoped by the server. */
  permission: string;
  /** Named in the "not shown" line, in the second person. */
  needs: string;
  load: () => Promise<Deleted[]>;
  restore: (id: string) => Promise<unknown>;
  noun: string;
};

const money = (v: number | string | null | undefined) =>
  v != null ? formatMoney(v, 'INR', 'en-IN') : 'No amount';

const SECTIONS: Section[] = [
  {
    key: 'proposals',
    heading: 'Proposals',
    permission: 'pipeline.write',
    needs: 'writing to the pipeline',
    noun: 'Proposal',
    load: async () =>
      (await api.proposals.trash()).proposals.map((p: any) => ({
        id: p.id,
        title: `${p.company?.name ?? 'No company'} — ${p.kind === 'RETAINER' ? 'monthly retainer' : 'one-time project'}`,
        subtitle: [
          p.versions?.[0] ? `v${p.versions[0].n} ${money(p.versions[0].value)}` : 'No version',
          p.owner?.name ?? 'No owner',
        ].join(' · '),
        deletedAt: p.deletedAt,
      })),
    restore: (id) => api.proposals.restore(id),
  },
  {
    key: 'projects',
    heading: 'Projects',
    permission: 'setup.admin',
    needs: 'admin',
    noun: 'Project',
    load: async () =>
      (await api.projects.trash()).projects.map((p: any) => ({
        id: p.id,
        title: p.name,
        subtitle: p.company?.name ?? 'No company',
        deletedAt: p.deletedAt,
      })),
    restore: (id) => api.projects.restore(id),
  },
  {
    key: 'tasks',
    heading: 'Tasks',
    permission: '',
    needs: '',
    noun: 'Task',
    load: async () =>
      (await api.tasks.trash()).tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        subtitle: [t.assignee?.name ?? 'Nobody', t.dueDate ? `due ${formatDate(t.dueDate)}` : null]
          .filter(Boolean)
          .join(' · '),
        deletedAt: t.deletedAt,
      })),
    restore: (id) => api.tasks.restore(id),
  },
  {
    key: 'costs',
    heading: 'Costs',
    permission: 'setup.admin',
    needs: 'admin',
    noun: 'Cost',
    load: async () =>
      (await api.costs.trash()).costs.map((c: any) => ({
        id: c.id,
        title: `${c.category} — ${c.vendor}`,
        subtitle: `${money(c.amount)}${c.enteredBy ? ` · entered by ${c.enteredBy.name}` : ''}`,
        deletedAt: c.deletedAt,
      })),
    restore: (id) => api.costs.restore(id),
  },
  {
    key: 'assets',
    heading: 'Assets',
    permission: 'setup.admin',
    needs: 'admin',
    noun: 'Asset',
    load: async () =>
      (await api.assets.trash()).assets.map((a: any) => ({
        id: a.id,
        title: `${a.tag} — ${a.name}`,
        subtitle: [a.category, a.currentHolder?.name ? `with ${a.currentHolder.name}` : null]
          .filter(Boolean)
          .join(' · '),
        deletedAt: a.deletedAt,
      })),
    restore: (id) => api.assets.restore(id),
  },
];

export function TrashTab() {
  const { data: config } = useConfig();
  const perms = config?.me.permissions ?? [];
  const [rows, setRows] = useState<Record<string, Deleted[]> | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const allowed = SECTIONS.filter((s) => !s.permission || perms.includes(s.permission));
  const withheld = SECTIONS.filter((s) => s.permission && !perms.includes(s.permission));

  const load = useCallback(async () => {
    const broke: string[] = [];
    const entries = await Promise.all(
      allowed.map(async (s) => {
        try {
          return [s.key, await s.load()] as const;
        } catch {
          // A section that genuinely failed is not a section that is empty.
          broke.push(s.heading);
          return [s.key, []] as const;
        }
      }),
    );
    setFailed(broke);
    setRows(Object.fromEntries(entries));
    // `allowed` is derived from permissions, which settle once config lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.join(',')]);

  useEffect(() => {
    if (!config) return;
    void load();
  }, [config, load]);

  const restore = async (section: Section, id: string) => {
    setBusyId(id);
    try {
      await section.restore(id);
      toast.success(`${section.noun} restored.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not restore that ${section.noun.toLowerCase()}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!config || rows === null) return <p className="text-sm text-secondary">Loading…</p>;

  const total = Object.values(rows).reduce((n, list) => n + list.length, 0);

  const NotShown = () =>
    withheld.length === 0 ? null : (
      <p className="text-micro text-secondary">
        {withheld.map((s) => s.heading.toLowerCase()).join(', ')} are not shown here — putting those back needs{' '}
        {withheld[0].needs} access.
      </p>
    );

  return (
    <div className="space-y-4">
      {failed.length > 0 && (
        <p className="text-micro text-danger">
          Could not load {failed.join(', ')}. What is listed below may not be everything.
        </p>
      )}

      {total === 0 ? (
        <Card>
          <EmptyState
            title="Nothing in the trash"
            hint={`Deleted ${allowed.map((s) => s.heading.toLowerCase()).join(', ')} show up here for recovery.`}
          />
        </Card>
      ) : (
        allowed.map((section) => {
          const list = rows[section.key] ?? [];
          if (list.length === 0) return null;
          return (
            <Card key={section.key} padding="none">
              <CardHeader>
                <CardTitle>
                  {section.heading} ({list.length})
                </CardTitle>
              </CardHeader>
              <CardBody className="p-0! divide-y divide-border">
                {list.map((row) => (
                  <div key={row.id} className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{row.title}</p>
                      <p className="text-xs text-secondary truncate">
                        {row.subtitle} · deleted {formatDate(row.deletedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => void restore(section, row.id)}
                      disabled={busyId === row.id}
                      className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </button>
                  </div>
                ))}
              </CardBody>
            </Card>
          );
        })
      )}

      <NotShown />
    </div>
  );
}
