'use client';

/**
 * Adding a revised version to a live proposal (brief §11.1 step 8: "Client
 * pushes back. BD creates version 2. Version 1 is untouched.").
 *
 * The server assigns the next version number and moves the stage to In
 * negotiation itself — this only asks for what's actually new.
 */

import toast from 'react-hot-toast';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  proposalId: string;
  nextVersionNumber: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AddVersionModal({ proposalId, nextVersionNumber, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [scopeSummary, setScopeSummary] = useState('');
  const [fileUrl, setFileUrl] = useState('');

  const parsedValue = Number(value);
  const canSave = Number.isFinite(parsedValue) && parsedValue >= 0 && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.proposals.addVersion(proposalId, {
        value: parsedValue,
        scopeSummary: scopeSummary.trim(),
        fileUrl: fileUrl.trim() || undefined,
      });
      toast.success(`Version ${nextVersionNumber} added`);
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the version');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Add version ${nextVersionNumber}`}
      description="Version 1 is untouched. Stage moves to In negotiation."
      onClose={onCancel}
      size="md"
    >
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
            label="Revised value (₹)"
            value={value}
            onChange={setValue}
            type="number"
            disabled={busy}
            hint="Optional — leave blank for not yet quoted."
          />

          <Field
            label="Scope summary"
            value={scopeSummary}
            onChange={setScopeSummary}
            disabled={busy}
            textarea
            rows={3}
            placeholder="Optional — what changed from the last version."
          />

          <Field
            label="Proposal document URL"
            value={fileUrl}
            onChange={setFileUrl}
            disabled={busy}
            placeholder="Optional — link to the revised PDF/deck"
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Add version
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
