'use client';

/**
 * Recording the client's answer.
 *
 * The answer arrives OUTSIDE Flowzen, so somebody types it in. Two consequences
 * are built into this form (master plan §3.12):
 *
 * ① The date is asked for, and defaults to today only as a convenience. Someone
 *    who agreed on Tuesday and was written up on Friday agreed on TUESDAY —
 *    store the typing date and every sales-cycle figure is wrong by however long
 *    people take to get round to it.
 *
 * ② A decline needs a reason. It is the only thing that makes "why do we lose?"
 *    answerable a year later, so the server refuses without one.
 */

import { useEffect, useState } from 'react';
import { api, ApiError, type WinTerms } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import type { QuoteRow } from '../page';

const today = () => new Date().toISOString().slice(0, 10);

const VIA = [
  { value: 'EMAIL', label: 'By email' },
  { value: 'CALL', label: 'On a call' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'IN_PERSON', label: 'In person' },
  { value: 'SIGNED_DOCUMENT', label: 'Signed document' },
  { value: 'OTHER', label: 'Some other way' },
];

export function RecordAnswerDialog({
  quote,
  onClose,
  onRecorded,
}: {
  quote: QuoteRow | null;
  onClose: () => void;
  /** Called with the win terms to offer when the answer was yes. */
  onRecorded: (winDefaults: Partial<WinTerms> | null) => void;
}) {
  const [answer, setAnswer] = useState<'ACCEPTED' | 'DECLINED' | null>(null);
  const [on, setOn] = useState(today());
  const [via, setVia] = useState('EMAIL');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (quote) {
      setAnswer(null);
      setOn(today());
      setVia('EMAIL');
      setNote('');
      setReason('');
      setError(null);
    }
  }, [quote]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer || !quote) return;
    setSaving(true);
    setError(null);
    try {
      if (answer === 'ACCEPTED') {
        const result = await api.quotes.accept(quote.id, {
          via,
          acceptedAt: on,
          note: note || undefined,
        });
        // Accepting offers the win, pre-filled from this quotation — it does not
        // perform it. Winning needs a start date this person may not have.
        onRecorded(result.promptWin ? (result.winDefaults ?? {}) : null);
      } else {
        await api.quotes.decline(quote.id, reason, on);
        onRecorded(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the answer');
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(quote)}
      onClose={onClose}
      title="What did they say?"
      description={quote ? `${quote.number} · ${quote.company.name}` : undefined}
    >
      <form onSubmit={submit}>
        <ModalBody>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setAnswer('ACCEPTED')}
              className={`rounded-xl border p-3 text-left transition-colors ${
                answer === 'ACCEPTED'
                  ? 'border-green-400 bg-green-50'
                  : 'border-border hover:bg-subtle'
              }`}
            >
              <span className="block text-sm font-semibold text-primary">They accepted</span>
              <span className="mt-0.5 block text-xs text-secondary">
                Then win the deal to start billing
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAnswer('DECLINED')}
              className={`rounded-xl border p-3 text-left transition-colors ${
                answer === 'DECLINED' ? 'border-red-300 bg-red-50' : 'border-border hover:bg-subtle'
              }`}
            >
              <span className="block text-sm font-semibold text-primary">They declined</span>
              <span className="mt-0.5 block text-xs text-secondary">Needs a reason</span>
            </button>
          </div>

          {answer && (
            <>
              {/* The whole reason this field exists rather than defaulting silently. */}
              <Field
                label="When did they say it?"
                type="date"
                value={on}
                onChange={setOn}
                required
                hint="The day they answered — not the day you are typing this in."
              />

              {answer === 'ACCEPTED' ? (
                <>
                  <FieldSelect label="How?" value={via} onChange={setVia} options={VIA} />

                  <Field
                    label="Note"
                    value={note}
                    onChange={setNote}
                    textarea
                    rows={2}
                    placeholder="Anything they said along with it"
                  />

                  {/*
                    Accepting a later version declines the earlier ones — a deal
                    with two live prices is one whose engagement could be built
                    from the wrong one (§3.12).
                  */}
                  <Note>Any other open quotation on this deal will be marked as superseded.</Note>
                </>
              ) : (
                <Field
                  label="Why?"
                  value={reason}
                  onChange={setReason}
                  textarea
                  rows={3}
                  required
                  placeholder="Too expensive, went with someone else, budget pulled…"
                  hint="This is what makes “why do we lose?” answerable next year."
                />
              )}
            </>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!answer || (answer === 'DECLINED' && reason.trim() === '')}
          >
            Record it
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
