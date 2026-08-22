'use client';

import { useState, useEffect } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field, FieldSelect } from '@/components/ui/field';
import { Note, ErrorNote } from '@/components/ui/empty-state';

/** `occurredAt` defaults to today but is editable — that is the whole point (§3.9). */
export function LogActivityDialog({
  open,
  dealId,
  companyId,
  projectId,
  taskId,
  onClose,
  onLogged,
}: {
  open: boolean;
  dealId?: string;
  companyId?: string;
  projectId?: string;
  taskId?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [type, setType] = useState('CALL');
  const [message, setMessage] = useState('');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType('CALL');
      setMessage('');
      setBody('');
      setOccurredAt(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.activities.log({
        dealId: dealId || undefined,
        companyId: companyId || undefined,
        projectId: projectId || undefined,
        taskId: taskId || undefined,
        type,
        message,
        body: body || null,
        occurredAt,
      });
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save it');
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log something">
      <form onSubmit={submit}>
        <ModalBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect
              label="What was it?"
              value={type}
              onChange={setType}
              options={[
                { value: 'CALL', label: 'A call' },
                { value: 'MEETING', label: 'A meeting' },
                { value: 'EMAIL', label: 'An email' },
                { value: 'NOTE', label: 'A note' },
              ]}
            />
            <Field
              label="When"
              type="date"
              value={occurredAt}
              onChange={setOccurredAt}
              required
              hint="The day it happened."
            />
          </div>

          <Field
            label="In one line"
            value={message}
            onChange={setMessage}
            required
            placeholder="Spoke to Priya about the scope"
          />

          <Field label="Detail" value={body} onChange={setBody} textarea rows={3} />

          {error && <ErrorNote>{error}</ErrorNote>}

          <Note>The timeline cannot be edited afterwards. It is a record of what happened.</Note>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!message}>
            Save it
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
