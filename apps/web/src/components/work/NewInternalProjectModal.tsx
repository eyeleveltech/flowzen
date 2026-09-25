'use client';

/**
 * Starting a piece of the studio's own work.
 *
 * The same thing Settings manages, offered where the work is actually being
 * looked at. It carries no client, no value and no invoice — see
 * routes/internalProjects.ts on why that is a schema guarantee rather than a
 * convention — so this form has two fields and there is nothing else to ask.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { useTeamMembers } from '@/hooks/queries';
import { personOptions } from '@/lib/people';

export function NewInternalProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const team = useTeamMembers();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.internalProjects.create({
        name: name.trim(),
        description: description.trim() || null,
        ownerId: ownerId || null,
      });
      toast.success(`${name.trim()} added`);
      setName('');
      setDescription('');
      setOwnerId('');
      onCreated(res.project.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="New internal project"
      description="The studio's own work — a hiring round, the website, compliance. No client and no money: it exists to group tasks."
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
          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            placeholder="Nobody in particular"
            options={personOptions(team)}
            disabled={busy}
            hint="Who is answerable for it. Useful, not required."
          />
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
            Create
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
