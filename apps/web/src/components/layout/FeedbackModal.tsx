'use client';

/**
 * "Something confusing? Tell us" (Ease Plan 3): one box, sent to Management.
 *
 * Opened from the "?" help panel and from the profile menu. Only the message
 * is asked for; which page, and phone or computer, go with it on their own.
 * The sender's name always goes too — the user chose no anonymous notes, and
 * the box says so rather than leave anybody guessing.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { useIsMobile } from '@/hooks/use-breakpoint';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

/** The same ceiling as the server's. */
export const FEEDBACK_MAX = 2000;

export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await api.feedback.send({
        message: text,
        // The page this was opened on; the server keeps the path and the screen's name, never the query.
        path: `${window.location.pathname}${window.location.search}`,
        device: isMobile ? 'PHONE' : 'DESKTOP',
      });
      setMessage('');
      toast.success('Thank you. Management will read it.');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send it. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const left = FEEDBACK_MAX - message.length;

  return (
    <Modal open={open} onClose={close} title="Something confusing? Tell us" description="It goes to Management, with your name.">
      <form onSubmit={send}>
        <ModalBody>
          <div>
            <Field
              label="What was confusing, or what were you looking for?"
              value={message}
              onChange={(v) => setMessage(v.slice(0, FEEDBACK_MAX))}
              textarea
              rows={5}
              required
              placeholder="Where do I see my leave?"
            />
            <p className={`mt-1.5 text-micro ${left < 100 ? 'text-warning-ink' : 'text-secondary'}`} aria-live="polite">
              {left < 200 ? `${left} characters left` : 'The page you are on is sent with it, so there is no need to say where.'}
            </p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={sending} disabled={!message.trim()}>
            Send
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
