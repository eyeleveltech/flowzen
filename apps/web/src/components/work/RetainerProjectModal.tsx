'use client';

/**
 * A project inside a retainer.
 *
 * Deliberately short. It asks for a name, dates and an owner, and nothing else,
 * because there is nothing else: the retainer is already billed monthly through
 * its month cards, so this carries no value, no milestones and no invoice. A
 * form that offered a figure here would be inviting somebody to bill the same
 * work twice.
 *
 * The end date can be left empty. That is not a missing answer — it is what an
 * always-on stream looks like, as against a campaign that finishes.
 */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError, type RetainerProject } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  retainerId: string;
  /** Present when editing; absent when adding. */
  project?: RetainerProject;
  onSaved: () => void;
  onClose: () => void;
};

export function RetainerProjectModal({ retainerId, project, onSaved, onClose }: Props) {
  const team = useTeamMembers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(project?.name ?? '');
  const [startDate, setStartDate] = useState(project?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(project?.endDate?.slice(0, 10) ?? '');
  const [ownerId, setOwnerId] = useState(project?.owner?.id ?? '');
  const [description, setDescription] = useState(project?.description ?? '');

  const datesWrongWayRound = Boolean(startDate && endDate && endDate < startDate);
  const canSave = name.trim().length > 0 && !datesWrongWayRound && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      startDate: startDate || null,
      endDate: endDate || null,
      ownerId: ownerId || null,
      description: description.trim() || null,
    };
    try {
      if (project) {
        await api.retainers.updateProject(retainerId, project.id, body);
        toast.success('Project updated');
      } else {
        await api.retainers.createProject(retainerId, body);
        toast.success('Project added');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={project ? `Edit ${project.name}` : 'Add a project'}
      description="A named piece of work inside this retainer. The monthly fee already covers it, so it carries no value of its own."
    >
      <form className="flex h-full flex-col" onSubmit={submit}>
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field
            label="Name"
            value={name}
            onChange={setName}
            required
            disabled={busy}
            placeholder="e.g. Diwali Campaign"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" value={startDate} onChange={setStartDate} type="date" disabled={busy} />
            <Field
              label="Ends"
              value={endDate}
              onChange={setEndDate}
              type="date"
              disabled={busy}
              hint="Leave empty if it runs on with no end."
              error={datesWrongWayRound ? 'That is before the start date.' : undefined}
            />
          </div>

          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            options={team.map((m) => ({ value: m.id, label: m.name }))}
            placeholder="Nobody in particular"
            disabled={busy}
          />

          <Field
            label="What it covers"
            value={description}
            onChange={setDescription}
            disabled={busy}
            textarea
            rows={3}
            hint="Optional. For anyone picking this up who wasn't in the room."
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            {project ? 'Save changes' : 'Add project'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
