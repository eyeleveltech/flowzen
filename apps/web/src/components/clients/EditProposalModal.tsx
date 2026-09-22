'use client';

/**
 * Correcting a proposal after it has been raised.
 *
 * Deliberately two fields. Almost everything about a proposal is either a
 * record of what happened to it or a number that belongs to a version, and
 * neither is something to overwrite in place:
 *
 *   · the money is a version, and a re-price is v(N+1) — "Add a version" on
 *     the card behind this one. Editing the figure here would rewrite what was
 *     sent to the client, and lose the trail of what was given away.
 *   · the company is not editable at all. Moving a proposal shifts its value
 *     between two clients' pipelines, and a won one has already turned the
 *     first company into a client. Raise it against the right one instead.
 *   · the stage follows the record (§10) — it is the board's job, not a field.
 *
 * What is left is the two things that really are properties of the deal: who
 * owns it, and whether it is a retainer or one-time work.
 */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { useTeamMembers } from '@/hooks/queries';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Proposal = {
  id: string;
  kind: 'RETAINER' | 'PROJECT';
  outcome: 'WON' | 'LOST' | null;
  owner?: { id: string; name: string } | null;
  ownerId?: string | null;
};

type Props = {
  proposal: Proposal;
  companyName: string;
  onSaved: () => void;
  onClose: () => void;
};

export function EditProposalModal({ proposal, companyName, onSaved, onClose }: Props) {
  const team = useTeamMembers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const originalOwner = proposal.owner?.id ?? proposal.ownerId ?? '';
  const [ownerId, setOwnerId] = useState(originalOwner);
  const [kind, setKind] = useState<'RETAINER' | 'PROJECT'>(proposal.kind);

  // Winning is what built the retainer or the project behind it. Relabelling a
  // closed deal would describe work that was never done, and the server
  // refuses it — so the control says so rather than letting someone find out
  // by being turned down.
  const closed = proposal.outcome !== null;
  const changed = ownerId !== originalOwner || kind !== proposal.kind;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposals.update(proposal.id, {
        ...(ownerId !== originalOwner ? { ownerId } : {}),
        ...(kind !== proposal.kind ? { kind } : {}),
      });
      toast.success('Proposal updated');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this proposal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit proposal"
      description={`${companyName} — who owns it and what kind of work it is. The figures belong to a version.`}
    >
      <form className="flex h-full flex-col" onSubmit={submit}>
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <FieldSelect
            label="Owner"
            value={ownerId}
            onChange={setOwnerId}
            options={team.map((m) => ({ value: m.id, label: m.name }))}
            placeholder="Nobody in particular"
            disabled={busy}
          />

          <div>
            <FieldSelect
              label="Kind of work"
              value={kind}
              onChange={(v) => setKind(v as 'RETAINER' | 'PROJECT')}
              options={[
                { value: 'RETAINER', label: 'Monthly retainer' },
                { value: 'PROJECT', label: 'One-time project' },
              ]}
              disabled={busy || closed}
            />
            <p className="mt-1 text-micro text-secondary">
              {closed
                ? 'Settled when this proposal closed — it decided whether a retainer or a project was built.'
                : 'Decides what winning this creates.'}
            </p>
          </div>

          <p className="text-micro text-secondary">
            To change the value or the scope, add a version instead. Every version is kept, which is what makes
            &ldquo;given away in negotiation&rdquo; a real number.
          </p>
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!changed || busy}>
            Save changes
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
