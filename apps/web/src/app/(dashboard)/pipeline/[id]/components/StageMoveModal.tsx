'use client';

import { useState } from 'react';
import { api, ApiError, type Stage } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  dealId: string;
  stage: Stage;
  currentFieldValues: { fieldId: string; key: string; label: string; type: string; value: unknown }[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function StageMoveModal({ dealId, stage, currentFieldValues, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We only show fields configured for this stage
  const stageFields = stage.fields || [];

  // Initialize values with existing data if present
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const acc: Record<string, unknown> = {};
    for (const sf of stageFields) {
      const existing = currentFieldValues.find((v) => v.fieldId === sf.field.id);
      acc[sf.field.id] = existing?.value ?? '';
    }
    return acc;
  });

  const isFieldRequired = (sf: { required?: boolean; isRequired?: boolean }) =>
    Boolean(sf.required ?? sf.isRequired);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deals.moveStage(dealId, stage.id, stageFields.length > 0 ? values : undefined);
      onConfirm();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        setError(e.fieldErrors.map((f) => f.message).join(' '));
      } else {
        setError(e instanceof Error ? e.message : 'Failed to move deal');
      }
    } finally {
      setBusy(false);
    }
  };

  const missingRequired = stageFields.some((sf) => {
    if (!isFieldRequired(sf)) return false;
    const v = values[sf.field.id];
    return v === undefined || v === null || v === '';
  });

  return (
    <Modal open={true} title={`Move to ${stage.name}`} onClose={onCancel}>
      <ModalBody className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {stageFields.length > 0 ? (
          <>
            <p className="text-sm text-secondary">
              This stage requires some additional details before moving.
            </p>
            {stageFields.map((sf) => {
              const req = isFieldRequired(sf);
              return (
                <Field
                  key={sf.field.id}
                  label={sf.field.label + (req ? ' *' : '')}
                  value={String(values[sf.field.id] ?? '')}
                  onChange={(v) => setValues((prev) => ({ ...prev, [sf.field.id]: v }))}
                  required={req}
                  disabled={busy}
                />
              );
            })}
          </>
        ) : (
          <p className="text-sm text-secondary">
            Are you sure you want to move this deal to {stage.name}?
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          loading={busy}
          disabled={missingRequired}
        >
          Move Deal
        </Button>
      </ModalFooter>
    </Modal>
  );
}
