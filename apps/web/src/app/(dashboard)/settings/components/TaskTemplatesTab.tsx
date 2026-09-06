'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type TaskTemplate, type TaskTemplateItem } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Draft = { key: string; id: string | null; name: string; items: TaskTemplateItem[]; retainerCount: number };

let draftSeq = 0;
const toDraft = (t: TaskTemplate): Draft => ({
  key: t.id,
  id: t.id,
  name: t.name,
  items: t.items.length ? t.items : [{ title: '' }],
  retainerCount: t._count?.retainers ?? 0,
});
const blankDraft = (): Draft => ({
  key: `new-${++draftSeq}`,
  id: null,
  name: '',
  items: [{ title: '' }],
  retainerCount: 0,
});

const inputClasses =
  'rounded-md border border-border bg-transparent px-3 py-1.5 text-sm placeholder:text-secondary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export function TaskTemplatesTab({
  templates,
  canEdit,
  onChanged,
}: {
  templates: TaskTemplate[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => templates.map(toDraft));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(templates.map(toDraft));
  }, [templates]);

  const updateDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const updateItem = (key: string, idx: number, patch: Partial<TaskTemplateItem>) =>
    setDrafts((prev) =>
      prev.map((d) => (d.key !== key ? d : { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) })),
    );

  const addItem = (key: string) =>
    setDrafts((prev) => prev.map((d) => (d.key !== key ? d : { ...d, items: [...d.items, { title: '' }] })));

  const removeItem = (key: string, idx: number) =>
    setDrafts((prev) => prev.map((d) => (d.key !== key ? d : { ...d, items: d.items.filter((_, i) => i !== idx) })));

  const addTemplate = () => setDrafts((prev) => [...prev, blankDraft()]);
  const discardNew = (key: string) => setDrafts((prev) => prev.filter((d) => d.key !== key));

  const save = async (draft: Draft) => {
    const name = draft.name.trim();
    const items = draft.items
      .map((it) => ({ title: it.title.trim(), dayOfMonth: it.dayOfMonth }))
      .filter((it) => it.title);

    if (!name) {
      setErrorKey((e) => ({ ...e, [draft.key]: 'Name is required' }));
      return;
    }
    if (items.length === 0) {
      setErrorKey((e) => ({ ...e, [draft.key]: 'Add at least one task' }));
      return;
    }

    setBusyKey(draft.key);
    setErrorKey((e) => ({ ...e, [draft.key]: '' }));
    try {
      if (draft.id) {
        await api.taskTemplates.update(draft.id, { name, items });
      } else {
        await api.taskTemplates.create({ name, items });
      }
      onChanged();
    } catch (err) {
      setErrorKey((e) => ({ ...e, [draft.key]: err instanceof ApiError ? err.message : 'Could not save' }));
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (draft: Draft) => {
    if (!draft.id) return;
    if (!confirm(`Delete "${draft.name}"? This can't be undone.`)) return;
    setBusyKey(draft.key);
    try {
      await api.taskTemplates.remove(draft.id);
      onChanged();
    } catch (err) {
      setErrorKey((e) => ({ ...e, [draft.key]: err instanceof ApiError ? err.message : 'Could not delete' }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card padding="none">
      <CardHeader>
        <CardTitle>Retainer task templates</CardTitle>
        {canEdit && (
          <Button type="button" size="sm" onClick={addTemplate}>
            <Plus className="mr-1 h-4 w-4" /> New template
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-secondary">
          When a retainer&apos;s month card is created on the 1st, every task below is spawned
          automatically for that month, due on its day of the month.
        </p>

        {drafts.length === 0 && <p className="text-sm text-secondary">No templates yet.</p>}

        {drafts.map((draft) => (
          <div key={draft.key} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Field
                  label="Template name"
                  value={draft.name}
                  onChange={(v) => updateDraft(draft.key, { name: v })}
                  placeholder="e.g. Standard monthly retainer"
                  disabled={!canEdit}
                />
              </div>
              {draft.retainerCount > 0 && (
                <span className="mt-6 shrink-0 text-xs text-secondary">
                  Used by {draft.retainerCount} retainer{draft.retainerCount === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="space-y-2">
              {draft.items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    className={`flex-1 ${inputClasses}`}
                    value={item.title}
                    onChange={(e) => updateItem(draft.key, idx, { title: e.target.value })}
                    placeholder="Task title"
                    aria-label={`Task ${idx + 1} title`}
                    disabled={!canEdit}
                  />
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className={`w-28 ${inputClasses}`}
                    value={item.dayOfMonth ?? ''}
                    onChange={(e) =>
                      updateItem(draft.key, idx, { dayOfMonth: e.target.value ? Number(e.target.value) : undefined })
                    }
                    placeholder="Due day"
                    aria-label={`Task ${idx + 1} due day of the month`}
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeItem(draft.key, idx)}
                      className="rounded p-1.5 text-secondary hover:bg-subtle hover:text-danger"
                      title="Remove task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <div className="flex items-center justify-between pt-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => addItem(draft.key)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add task
                </Button>
                <div className="flex items-center gap-2">
                  {draft.id ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(draft)}
                      disabled={busyKey === draft.key || draft.retainerCount > 0}
                      title={draft.retainerCount > 0 ? 'Move its retainers to a different template first' : undefined}
                    >
                      Delete
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => discardNew(draft.key)}
                      disabled={busyKey === draft.key}
                    >
                      Discard
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={busyKey === draft.key}
                    onClick={() => void save(draft)}
                  >
                    Save
                  </Button>
                </div>
              </div>
            )}

            {errorKey[draft.key] && <ErrorNote>{errorKey[draft.key]}</ErrorNote>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
