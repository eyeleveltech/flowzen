'use client';

/**
 * CR-02 §10 — "emailable".
 *
 * One form for both documents, opened from a proforma or an invoice, sending
 * the same PDF the Download link produces with a covering note attached to it.
 *
 * The note is a draft. It arrives filled in — what the document is, what it
 * comes to, when it is due — and the person sending it can rewrite every word
 * before it goes. Nothing here sends anything a human has not read.
 */

import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { api, ApiError, type DocumentEmailDefaults } from '@/lib/api-v2';
import { Modal, ScrollingModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Props = {
  kind: 'PROFORMA' | 'INVOICE';
  id: string;
  onClose: () => void;
  onSent?: () => void;
};

export function SendDocumentModal({ kind, id, onClose, onSent }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<DocumentEmailDefaults | null>(null);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = kind === 'PROFORMA' ? api.proformas.emailDefaults : api.invoices.emailDefaults;
    void load(id)
      .then((d) => {
        if (cancelled) return;
        setDefaults(d);
        setTo(d.to ?? '');
        setSubject(d.subject);
        setMessage(d.message);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not prepare this email');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const ccList = cc
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const canSend = /.+@.+\..+/.test(to.trim()) && subject.trim().length > 0 && !busy && !loading;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const call = kind === 'PROFORMA' ? api.proformas.email : api.invoices.email;
      const res = await call(id, {
        to: to.trim(),
        cc: ccList.length ? ccList : undefined,
        subject: subject.trim(),
        message: message.trim(),
      });
      toast.success(`Sent to ${res.to}`);
      onSent?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send this email');
    } finally {
      setBusy(false);
    }
  };

  const what = kind === 'PROFORMA' ? 'proforma' : 'invoice';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={defaults ? `Send ${defaults.number}` : `Send this ${what}`}
      description="The document goes as a PDF attachment. Read the note before you send it."
    >
      <form className="flex h-full flex-col" onSubmit={send}>
        <ScrollingModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field label="To" value={to} onChange={setTo} type="email" required disabled={busy || loading} />

          {/*
            Everyone on the client record who has an email, payer first — so the
            common case is one click rather than remembering an address.
          */}
          {defaults && defaults.recipients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-micro text-secondary">On file:</span>
              {defaults.recipients.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  onClick={() => setTo(p.email)}
                  disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-micro text-body transition-colors hover:bg-subtle"
                >
                  {p.name} · {p.email}
                </button>
              ))}
            </div>
          )}
          {defaults && defaults.recipients.length === 0 && (
            <p className="text-micro text-secondary">
              No contact on this client has an email address. Add one on the client record and it will be offered here.
            </p>
          )}

          <Field
            label="Cc"
            value={cc}
            onChange={setCc}
            disabled={busy || loading}
            placeholder="accounts@client.com, someone@client.com"
            hint="Optional. Separate several with commas."
          />

          <Field label="Subject" value={subject} onChange={setSubject} required disabled={busy || loading} />

          <Field
            label="Note"
            value={message}
            onChange={setMessage}
            disabled={busy || loading}
            textarea
            rows={9}
            hint="Sent as the body of the email. The document itself is attached."
          />
        </ScrollingModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSend}>
            Send with the PDF
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
