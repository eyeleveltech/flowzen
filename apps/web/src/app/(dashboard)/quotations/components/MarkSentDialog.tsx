'use client';

/**
 * Sending a quotation.
 *
 * Two different acts share this dialog, and keeping them apart is the whole
 * point. Flowzen can SEND the document — and then it knows the message left, to
 * which address, at which moment. Or a person sends it themselves, over WhatsApp
 * or from their own inbox, and ASSERTS afterwards that they did. Both are
 * legitimate; a system that records them identically can never answer "did this
 * actually reach them?" (master plan §3.12).
 *
 * Sending from Flowzen deliberately has no date field. You cannot choose when a
 * message you are sending right now went out.
 */

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import type { QuoteRow } from '../page';

const today = () => new Date().toISOString().slice(0, 10);

const WAYS = [
  { value: 'MANUAL_EMAIL', label: 'Emailed it myself', hint: 'From your own inbox' },
  { value: 'WHATSAPP', label: 'WhatsApp', hint: '' },
  { value: 'IN_PERSON', label: 'Handed over in person', hint: '' },
  { value: 'OTHER', label: 'Some other way', hint: '' },
];

export function MarkSentDialog({
  quote,
  mailConfigured,
  onClose,
  onSent,
}: {
  quote: QuoteRow | null;
  /** Whether this organisation has a mail server. Settings → Email sets it up. */
  mailConfigured: boolean;
  onClose: () => void;
  onSent: (message?: string) => void;
}) {
  // Sending is the default when Flowzen can. Recording is the fallback, not the
  // habit — the habit is what the feature exists to remove.
  const [mode, setMode] = useState<'SEND' | 'RECORD'>('RECORD');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [via, setVia] = useState('MANUAL_EMAIL');
  const [sentAt, setSentAt] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (quote) {
      setMode(mailConfigured ? 'SEND' : 'RECORD');
      setTo('');
      setNote('');
      setVia('MANUAL_EMAIL');
      setSentAt(today());
      setError(null);
    }
  }, [quote, mailConfigured]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'SEND') {
        const result = await api.quotes.send(quote.id, {
          via: 'FLOWZEN_EMAIL',
          // Blank means the client's primary contact, worked out on the server.
          to: to.trim() || null,
          note: note.trim() || null,
        });
        onSent(result.message);
      } else {
        await api.quotes.send(quote.id, { via, sentAt });
        onSent();
      }
    } catch (err) {
      // A refusal to send is an ordinary answer, not a crash: the quotation is
      // untouched and recording it by hand is still right there.
      setError(err instanceof ApiError ? err.message : 'Could not send it');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(quote)}
      onClose={onClose}
      title="Send this quotation"
      description={quote ? `${quote.number} · ${quote.company.name}` : undefined}
    >
      <form onSubmit={submit}>
        <ModalBody>
          {mailConfigured && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <ModeCard
                active={mode === 'SEND'}
                onClick={() => setMode('SEND')}
                title="Send it from Flowzen"
                hint="Goes out now, to the client's main contact"
              />
              <ModeCard
                active={mode === 'RECORD'}
                onClick={() => setMode('RECORD')}
                title="I sent it myself"
                hint="Record that it went out"
              />
            </div>
          )}

          {mode === 'SEND' ? (
            <>
              <Field
                label="To"
                type="email"
                value={to}
                onChange={setTo}
                placeholder="The client's main contact"
                hint="Leave blank to use the primary contact on this client."
              />
              <Field
                label="Anything to add?"
                value={note}
                onChange={setNote}
                placeholder="Optional — appears above the figures"
              />
              <Note>
                The figures go in the message itself, so it reads on a phone
                without downloading anything. It is marked sent only if it leaves.
              </Note>
            </>
          ) : (
            <>
              <div>
                <span className="mb-2 block text-sm font-medium text-body">How did it go out?</span>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {WAYS.map((way) => (
                    <button
                      key={way.value}
                      type="button"
                      onClick={() => setVia(way.value)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        via === way.value ? 'border-primary bg-subtle' : 'border-border hover:bg-subtle'
                      }`}
                    >
                      <span className="block text-sm text-primary">{way.label}</span>
                      {way.hint && <span className="block text-xs text-secondary">{way.hint}</span>}
                    </button>
                  ))}
                </div>
              </div>

              <Field
                label="When"
                type="date"
                value={sentAt}
                onChange={setSentAt}
                required
                hint="The day it actually went out, not the day you are recording it."
              />

              {!mailConfigured && (
                <Note>
                  Flowzen cannot send email yet. An admin can set up a mail server
                  in Settings → Email, and then it can send this for you.
                </Note>
              )}
            </>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {mode === 'SEND' ? 'Send it' : 'Mark sent'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-primary bg-subtle' : 'border-border hover:bg-subtle'
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm text-primary">
        {active && <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {title}
      </span>
      <span className="block text-xs text-secondary">{hint}</span>
    </button>
  );
}
