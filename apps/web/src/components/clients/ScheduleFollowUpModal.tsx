'use client';

/**
 * The next time somebody has to chase this client.
 *
 * Follow-ups were already being created in three places — adding a company
 * with a follow-up date, logging a meeting with one, and the scanner when a
 * proposal goes quiet — and every one of them wrote the client's name into a
 * task title and stopped there. So the only way to schedule the NEXT one was
 * to log another meeting, and the only way to see what was outstanding was to
 * go hunting through somebody's My Work.
 *
 * It is an internal task: chasing a client is not work you bill them for. What
 * makes it findable is `companyId`, which is new — the task now says which
 * client it is about rather than merely mentioning them.
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
import { useAuthStore } from '@/stores';

/** A week out — the commonest answer, and a date box that starts empty is a
 *  date box somebody has to think about before they can type anything. */
const inAWeek = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

export function ScheduleFollowUpModal({
  company,
  onClose,
  onScheduled,
}: {
  company: { id: string; name: string; ownerId?: string | null };
  onClose: () => void;
  onScheduled: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const team = useTeamMembers();

  const [dueDate, setDueDate] = useState(inAWeek());
  const [note, setNote] = useState('');
  // Whoever owns the client, because they are the one with the history.
  const [assigneeId, setAssigneeId] = useState(company.ownerId ?? me?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = Boolean(dueDate) && Boolean(assigneeId) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.tasks.create({
        title: `Follow up — ${company.name}`,
        workType: 'INTERNAL',
        companyId: company.id,
        assigneeId,
        assigneeIds: [assigneeId],
        dueDate,
        notes: note.trim() || undefined,
      });
      toast.success('Follow-up scheduled');
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule a follow-up"
      description={`The next time somebody chases ${company.name}.`}
      size="md"
    >
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Follow up on" value={dueDate} onChange={setDueDate} type="date" required disabled={busy} />
            <FieldSelect
              label="Who"
              value={assigneeId}
              onChange={setAssigneeId}
              required
              options={personOptions(team)}
              disabled={busy}
              hint="Defaults to whoever owns this client."
            />
          </div>

          <Field
            label="What about"
            value={note}
            onChange={setNote}
            textarea
            rows={3}
            disabled={busy}
            placeholder="What was left open, what to ask next — whoever picks this up in a fortnight will not remember"
          />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Schedule
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
