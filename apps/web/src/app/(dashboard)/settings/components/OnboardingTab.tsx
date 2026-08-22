'use client';

import { useState } from 'react';
import { Plus, GripVertical, Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { api, type OrgConfig } from '@/lib/api-v2';

export function OnboardingTab({ config, onSaved }: { config: any; onSaved: () => void }) {
  const [tasks, setTasks] = useState<{ title: string; description: string }[]>(
    config.organization.settings?.defaultOnboardingTasks ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (newTasks: typeof tasks) => {
    setSaving(true);
    setError(null);
    try {
      await api.config.update({
        settings: {
          ...config.organization.settings,
          defaultOnboardingTasks: newTasks,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save tasks');
    } finally {
      setSaving(false);
    }
  };

  const updateTask = (index: number, key: 'title' | 'description', value: string) => {
    const next = [...tasks];
    next[index] = { ...next[index], [key]: value };
    setTasks(next);
  };

  const addTask = () => {
    const next = [...tasks, { title: '', description: '' }];
    setTasks(next);
  };

  const removeTask = (index: number) => {
    const next = tasks.filter((_, i) => i !== index);
    setTasks(next);
    void save(next);
  };

  const handleSave = () => {
    // filter out empty
    const filtered = tasks.filter((t) => t.title.trim());
    setTasks(filtered);
    void save(filtered);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deal Won Checklist</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-secondary">
          When a deal is won, these tasks are automatically created and assigned to the deal owner.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="space-y-3">
          {tasks.map((task, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border p-3 bg-subtle/30">
              <div className="mt-2 text-secondary">
                <GripVertical className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-3">
                <Field
                  label="Task Title"
                  value={task.title}
                  onChange={(v) => updateTask(i, 'title', v)}
                  placeholder="e.g. Schedule Kickoff Call"
                />
                <Field
                  label="Description (Optional)"
                  value={task.description}
                  onChange={(v) => updateTask(i, 'description', v)}
                  placeholder="e.g. Review contract and setup meeting"
                />
              </div>
              <button
                onClick={() => removeTask(i)}
                className="mt-8 rounded p-1.5 text-secondary hover:bg-white hover:text-red-600"
                title="Remove task"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={addTask}>
            <Plus className="mr-2 h-4 w-4" /> Add Task
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Checklist'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
