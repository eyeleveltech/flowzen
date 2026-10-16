'use client';

/**
 * Starting — or editing — a piece of the studio's own work.
 *
 * The same thing Settings manages, offered where the work is actually being
 * looked at. It carries no client, no value and no invoice — see
 * routes/internalProjects.ts on why that is a schema guarantee rather than a
 * convention. Only the name is required; the owner, an owning department, and
 * start and target dates are all optional (Internal work plan). The target
 * date is what "12 days left" and the owner's one reminder count from.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError, type InternalProject } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { useDepartments, useTeamMembers } from '@/hooks/queries';
import { personOptions } from '@/lib/people';

const dayValue = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function NewInternalProjectModal({
  open,
  onClose,
  onCreated,
  project,
}: {
  open: boolean;
  onClose: () => void;
  /** After a create, with the new id; after an edit, with the same one. */
  onCreated: (id: string) => void;
  /** Editing this one, rather than starting a new one. */
  project?: Pick<InternalProject, 'id' | 'name' | 'description' | 'owner' | 'department' | 'startDate' | 'targetDate'> | null;
}) {
  if (!open) return null;
  // Keyed, so opening it on another project (or for a new one) starts from that one's values.
  return <Form key={project?.id ?? 'new'} onClose={onClose} onCreated={onCreated} project={project ?? null} />;
}

function Form({
  onClose,
  onCreated,
  project,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  project: Pick<InternalProject, 'id' | 'name' | 'description' | 'owner' | 'department' | 'startDate' | 'targetDate'> | null;
}) {
  const team = useTeamMembers();
  const { departments } = useDepartments();
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [ownerId, setOwnerId] = useState(project?.owner?.id ?? '');
  const [departmentId, setDepartmentId] = useState(project?.department?.id ?? '');
  const [startDate, setStartDate] = useState(dayValue(project?.startDate));
  const [targetDate, setTargetDate] = useState(dayValue(project?.targetDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetTooEarly = Boolean(startDate && targetDate && targetDate < startDate);
  const canSave = name.trim().length > 0 && !targetTooEarly && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      ownerId: ownerId || null,
      departmentId: departmentId || null,
      startDate: startDate || null,
      targetDate: targetDate || null,
    };
    try {
      if (project) {
        await api.internalProjects.update(project.id, body);
        toast.success('Changes saved');
        onCreated(project.id);
      } else {
        const res = await api.internalProjects.create(body);
        toast.success(`${body.name} added`);
        onCreated(res.project.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : project ? 'Could not save that' : 'Could not create that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={project ? 'Edit internal project' : 'New internal project'}
      description={
        project
          ? undefined
          : "The studio's own work — a hiring round, the website, compliance. No client and no money: it exists to group tasks."
      }
      size="md"
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field
            label="Name"
            value={name}
            onChange={setName}
            required
            disabled={busy}
            placeholder="e.g. Hiring, Studio website, Compliance"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldSelect
              label="Owner"
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Nobody in particular"
              options={personOptions(team)}
              disabled={busy}
              hint="Who is answerable for it."
            />
            <FieldSelect
              label="Department"
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="No department"
              options={[
                ...(departmentId ? [{ value: '', label: 'No department' }] : []),
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
              disabled={busy}
              hint="Which team it belongs to."
            />
            <Field label="Start date" type="date" value={startDate} onChange={setStartDate} disabled={busy} hint="Optional" />
            <Field
              label="Target date"
              type="date"
              value={targetDate}
              onChange={setTargetDate}
              disabled={busy}
              min={startDate || undefined}
              error={targetTooEarly ? "Can't be before the start date" : undefined}
              hint="Optional. Shows the days left; the owner hears once if it passes with work open."
            />
          </div>
          <Field
            label="What it is"
            value={description}
            onChange={setDescription}
            textarea
            rows={3}
            disabled={busy}
            placeholder="Anything whoever picks up a task under this needs to know"
          />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            {project ? 'Save changes' : 'Create'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
