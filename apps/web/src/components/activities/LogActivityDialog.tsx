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
  subjectName,
  defaultType,
  onClose,
  onLogged,
}: {
  open: boolean;
  dealId?: string;
  companyId?: string;
  projectId?: string;
  taskId?: string;
  /**
   * Who or what this is being logged against, in words.
   *
   * The dialog has always taken the subject's ID and never its NAME, which was
   * fine while it could only be opened from that record's own page — the answer
   * was the page you were on. Opened from a list row, or from a command bar, the
   * page is no longer the answer, and a dialog that does not say whose call it is
   * about is one people close again to go and check.
   */
  subjectName?: string;
  /**
   * What kind of contact this was, when the caller already knows.
   *
   * The command bar knows, because the person typed it: "meeting acme" is not a
   * call. Without this every entry the bar wrote would say CALL, and a timeline
   * where everything is a call is one nobody can read a negotiation out of.
   */
  defaultType?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [type, setType] = useState(defaultType ?? 'CALL');
  const [message, setMessage] = useState('');
  const [body, setBody] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [followUpDate, setFollowUpDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultFollowUp = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  };

  useEffect(() => {
    if (open) {
      setType(defaultType ?? 'CALL');
      setMessage('');
      setBody('');
      setDirection('OUT');
      setOccurredAt(new Date().toISOString().slice(0, 10));
      setFollowUpDate(defaultFollowUp());
      setError(null);
    }
  }, [open, defaultType]);

  /**
   * Who reached out.
   *
   * The API has accepted `direction` since the timeline was built and nothing
   * ever asked for it. It is what turns a list of contacts into a readable
   * negotiation — "we chased twice, they came back once" is a different story
   * from the same four rows with no arrows on them (§3.12). A note has no
   * direction; nobody sent it anywhere.
   */
  const directional = type !== 'NOTE';
  // A meeting is the one type that logs a next step, not just a record of
  // what happened (§11.1 step 5) — the system raises the follow-up task,
  // nobody has to remember to go create one.
  const isMeeting = type === 'MEETING';

  const entityType = companyId ? 'Company' : dealId ? 'Proposal' : projectId ? 'Project' : taskId ? 'Task' : null;
  const entityId = companyId || dealId || projectId || taskId || null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityType || !entityId) return;
    setSaving(true);
    setError(null);
    try {
      await api.activities.log({
        entityType,
        entityId,
        verb: `${type.toLowerCase()}_logged`,
        payload: {
          message,
          body: body || null,
          direction: directional ? direction : null,
          occurredAt,
          followUpDate: isMeeting && followUpDate ? followUpDate : undefined,
        },
      });
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save it');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log something"
      description={subjectName ? `Against ${subjectName}` : undefined}
    >
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
                { value: 'WHATSAPP', label: 'WhatsApp' },
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

          {directional && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-body">Which way?</span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(
                  [
                    { value: 'OUT', label: 'We reached out' },
                    { value: 'IN', label: 'They came to us' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDirection(option.value)}
                    className={`rounded-xl border p-2.5 text-left text-sm transition-colors ${
                      direction === option.value
                        ? 'border-primary bg-subtle text-primary'
                        : 'border-border text-body hover:bg-subtle'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field
            label="In one line"
            value={message}
            onChange={setMessage}
            required
            placeholder="Spoke to Priya about the scope"
          />

          <Field label="Detail" value={body} onChange={setBody} textarea rows={3} />

          {isMeeting && (
            <Field
              label="Follow up on"
              type="date"
              value={followUpDate}
              onChange={setFollowUpDate}
              hint="A task lands on the owner for this date. Leave it and it defaults to 3 days out."
            />
          )}

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
