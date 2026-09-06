'use client';

/** Marking a proposal Lost. Terminal — the server won't allow versions or a win against it after. */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  proposalId: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LoseProposalModal({ proposalId, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const canSave = Boolean(reason.trim()) && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposals.lose(proposalId, reason.trim());
      toast.success('Proposal marked lost');
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not mark this proposal lost');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Mark this proposal lost" onClose={onCancel} size="md">
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void handleSave();
        }}
      >
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Field
            label="Reason"
            value={reason}
            onChange={setReason}
            disabled={busy}
            required
            textarea
            rows={3}
            placeholder="e.g. Went with a cheaper vendor"
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!canSave}>
            Mark lost
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
