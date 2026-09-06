'use client';

/**
 * One field, changed in place.
 *
 * Reassigning a task, moving a due date, setting when you will come back to a
 * client — each of these is a single value, and each of them used to cost opening
 * the record, finding the field, editing, saving, and coming back. The record
 * page is the right place to READ a thing; it is a poor place to change one
 * number about it.
 *
 * Deliberately not a form builder. Two shapes, because those are the two that
 * came up: a date, and a choice from a list. A third shape is a reason to add a
 * third case, not a reason to generalise this into something that can express
 * anything and explains nothing.
 */

import { useEffect, useState } from 'react';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

export type QuickEditSpec = {
  /** Heading — what is being changed. */
  title: string;
  /** Which record, in words. A dialog that does not name its subject gets closed again. */
  subject: string;
  label: string;
  hint?: string;
  initial: string;
  /** Save it. Reject to keep the dialog open with the message shown. */
  onSave: (value: string) => Promise<void>;
} & (
  | { kind: 'date' }
  | { kind: 'select'; options: { value: string; label: string }[] }
);

export function QuickEditDialog({
  spec,
  onClose,
  onSaved,
}: {
  spec: QuickEditSpec | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the subject changes, not only when the dialog mounts — the same
  // dialog is reused for every row in a list, and carrying the previous row's
  // value over is how somebody sets one task's date onto another.
  useEffect(() => {
    if (!spec) return;
    setValue(spec.initial);
    setError(null);
  }, [spec]);

  if (!spec) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await spec.onSave(value);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={spec.title} description={spec.subject} size="sm">
      <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
        {/* The scrolling body, not the plain one: only it carries `flex-1`, and
            without that the footer stops under the field instead of on the
            panel's bottom edge. */}
        <ScrollingModalBody className="space-y-4">
          {spec.kind === 'date' ? (
            <Field
              label={spec.label}
              type="date"
              value={value}
              onChange={setValue}
              hint={spec.hint}
            />
          ) : (
            <div>
              <FieldSelect
                label={spec.label}
                value={value}
                onChange={setValue}
                options={spec.options}
              />
              {/* `FieldSelect` takes no hint of its own, so it is rendered here
                  rather than dropped — the hint is usually the reason the field
                  is worth changing at all. */}
              {spec.hint && <p className="mt-1 text-xs text-secondary">{spec.hint}</p>}
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
