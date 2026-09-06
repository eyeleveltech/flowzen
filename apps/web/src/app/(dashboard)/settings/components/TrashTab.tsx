'use client';

/**
 * §16: "Soft delete only... Nothing is ever hard deleted by a user." Cost,
 * Project, and TaskTemplate all soft-delete now — but without a way back
 * into view, a soft delete was functionally a hard delete from a user's
 * side. This is that way back. setup.admin only, same tier as the delete
 * itself, since it's a recovery action rather than day-to-day use.
 */

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api, formatDate, formatMoney } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import toast from 'react-hot-toast';

type DeletedProject = { id: string; name: string; company: { name: string } | null; deletedAt: string };
type DeletedCost = { id: string; category: string; vendor: string; amount: number | string | null; deletedAt: string; enteredBy: { name: string } | null };
type DeletedTemplate = { id: string; name: string; deletedAt: string };

export function TrashTab() {
  const [projects, setProjects] = useState<DeletedProject[] | null>(null);
  const [costs, setCosts] = useState<DeletedCost[] | null>(null);
  const [templates, setTemplates] = useState<DeletedTemplate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const [p, c, t] = await Promise.all([
      api.projects.trash().catch(() => ({ projects: [] })),
      api.costs.trash().catch(() => ({ costs: [] })),
      api.taskTemplates.trash().catch(() => ({ templates: [] })),
    ]);
    setProjects(p.projects as DeletedProject[]);
    setCosts(c.costs as DeletedCost[]);
    setTemplates(t.templates as DeletedTemplate[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const restore = async (kind: 'project' | 'cost' | 'template', id: string, label: string) => {
    setBusyId(id);
    try {
      if (kind === 'project') await api.projects.restore(id);
      else if (kind === 'cost') await api.costs.restore(id);
      else await api.taskTemplates.restore(id);
      toast.success(`${label} restored.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not restore ${label.toLowerCase()}`);
    } finally {
      setBusyId(null);
    }
  };

  const loading = projects === null || costs === null || templates === null;
  const empty = !loading && projects!.length === 0 && costs!.length === 0 && templates!.length === 0;

  const Row = ({ title, subtitle, deletedAt, onRestore, id }: { title: string; subtitle: string; deletedAt: string; onRestore: () => void; id: string }) => (
    <div className="flex items-center justify-between p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-primary truncate">{title}</p>
        <p className="text-xs text-secondary truncate">{subtitle} · deleted {formatDate(deletedAt)}</p>
      </div>
      <button
        onClick={onRestore}
        disabled={busyId === id}
        className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-subtle hover:text-primary transition-colors disabled:opacity-50"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Restore
      </button>
    </div>
  );

  if (loading) return <p className="text-sm text-secondary">Loading…</p>;

  if (empty) {
    return (
      <Card>
        <EmptyState title="Nothing in the trash" hint="Deleted projects, costs, and task templates show up here for recovery." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {projects!.length > 0 && (
        <Card padding="none">
          <CardHeader><CardTitle>Projects ({projects!.length})</CardTitle></CardHeader>
          <CardBody className="p-0! divide-y divide-border">
            {projects!.map((p) => (
              <Row
                key={p.id}
                id={p.id}
                title={p.name}
                subtitle={p.company?.name ?? 'No company'}
                deletedAt={p.deletedAt}
                onRestore={() => void restore('project', p.id, 'Project')}
              />
            ))}
          </CardBody>
        </Card>
      )}
      {costs!.length > 0 && (
        <Card padding="none">
          <CardHeader><CardTitle>Costs ({costs!.length})</CardTitle></CardHeader>
          <CardBody className="p-0! divide-y divide-border">
            {costs!.map((c) => (
              <Row
                key={c.id}
                id={c.id}
                title={`${c.category} — ${c.vendor}`}
                subtitle={`${c.amount != null ? formatMoney(c.amount, 'INR', 'en-IN') : 'No amount'}${c.enteredBy ? ` · entered by ${c.enteredBy.name}` : ''}`}
                deletedAt={c.deletedAt}
                onRestore={() => void restore('cost', c.id, 'Cost')}
              />
            ))}
          </CardBody>
        </Card>
      )}
      {templates!.length > 0 && (
        <Card padding="none">
          <CardHeader><CardTitle>Task templates ({templates!.length})</CardTitle></CardHeader>
          <CardBody className="p-0! divide-y divide-border">
            {templates!.map((t) => (
              <Row
                key={t.id}
                id={t.id}
                title={t.name}
                subtitle="Task template"
                deletedAt={t.deletedAt}
                onRestore={() => void restore('template', t.id, 'Template')}
              />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
