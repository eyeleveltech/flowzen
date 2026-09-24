'use client';

/** Marking a proposal Lost. Terminal — the server won't allow versions or a win against it after. */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { LOST_REASONS, LOST_REASON_OTHER } from '@flowzen/shared';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  proposalId: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function LoseProposalModal({ proposalId, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * The category, and the words only when the category cannot say it.
   *
   * This was one free-text box, filled in at the moment somebody was giving up
   * on a deal — which is exactly when nobody writes carefully. The column ended
   * up holding "budget", "Budget issue" and "no budget this year": three
   * spellings of one reason, which cannot be counted. A fixed list is what
   * makes "how many did we lose on price" answerable at all.
   */
  const [reason, setReason] = useState<string>('');
  const [otherWords, setOtherWords] = useState('');

  const isOther = reason === LOST_REASON_OTHER;
  /** What gets stored: the category, or the words when it is Other. */
  const stored = isOther ? otherWords.trim() : reason;
  const canSave = Boolean(stored) && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposals.lose(proposalId, stored);
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
          <FieldSelect
            label="Reason for loss"
            value={reason}
            onChange={setReason}
            options={[
              { value: '', label: 'Choose a reason…' },
              ...LOST_REASONS.map((r) => ({ value: r, label: r })),
            ]}
            disabled={busy}
            required
          />
          {/*
            Only when the list cannot say it. A list that cannot express the
            real reason gets the nearest wrong one picked instead, and a wrong
            category is worse than an uncategorised note.
          */}
          {isOther && (
            <Field
              label="What happened?"
              value={otherWords}
              onChange={setOtherWords}
              disabled={busy}
              required
              textarea
              rows={3}
              placeholder="e.g. They merged with the agency we were pitching against"
            />
          )}
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
