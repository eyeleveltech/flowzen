'use client';

/**
 * A way back in for somebody who is locked out.
 *
 * There is no self-service "forgot my password" screen, because a token has to
 * REACH the person and this deployment cannot assume its mail server will. An
 * admin presses this and the link is both emailed and shown here — shown even
 * when the mail went out, because an admin who cannot see it has no way to
 * unblock anybody the first time a server refuses a connection.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';

export function ResetLinkModal({
  person,
  onClose,
}: {
  person: { id: string; name: string };
  onClose: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.users
      .resetLink(person.id)
      .then((res) => {
        if (cancelled) return;
        setLink(res.link);
        setEmailed(res.emailed);
        setMinutes(res.expiresInMinutes);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not create a reset link');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  return (
    <Modal open onClose={onClose} title={`Password link for ${person.name}`}>
      <ModalBody className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        {!error && !link && <p className="text-sm text-secondary">Creating the link…</p>}

        {link && (
          <>
            <p className="text-sm text-secondary">
              {emailed
                ? 'Emailed to them. The copy below is in case it does not arrive.'
                : 'Mail did not go out, so send this to them yourself.'}
            </p>

            <div className="flex items-center gap-2 rounded-xl border border-border bg-subtle/40 px-3 py-2.5">
              <code className="flex-1 truncate text-xs text-primary">{link}</code>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <Note>
              It stops working in {minutes} minutes, and signs them out of every device they are
              already on. Their old password stops working the moment they set a new one.
            </Note>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
