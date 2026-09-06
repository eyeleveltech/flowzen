'use client';

/**
 * Switching somebody off, and the equipment question it raises.
 *
 * ─── Why this exists at all ─────────────────────────────────────────────────
 *
 * The asset register's offboarding gate had nothing to gate. `PATCH /users/:id`
 * refuses to deactivate anybody still holding company kit — but there was no
 * way to deactivate anybody from the app, so the rule could never fire. An API
 * guard with no trigger is not a safeguard, it is dead code that reads like one.
 *
 * ─── Why it is a soft gate ──────────────────────────────────────────────────
 *
 * The first attempt is sent WITHOUT `force`, so the server answers with the
 * list of what they are holding rather than a yes. That list is the whole
 * point: nobody thinks about the MacBook on the day somebody's account is
 * switched off, and this is the last moment anybody will.
 *
 * Then it goes through anyway on the second press. People genuinely do leave
 * with a laptop, and a register that refuses to record that is a register that
 * disagrees with the office. The kit stays logged out to them and the scanner
 * raises ASSET_HELD_BY_INACTIVE_USER, which is a true statement about a real
 * problem — better than a false statement about a tidy one.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { rupees } from '@/lib/assets';

type Person = { id: string; name: string };
type Held = { id: string; tag: string; name: string };

export function DeactivateModal({
  person,
  onClose,
  onDone,
}: {
  person: Person;
  onClose: () => void;
  onDone: () => void;
}) {
  const [held, setHeld] = useState<Held[] | null>(null);
  const [bookValue, setBookValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deactivate = async (force: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await api.users.update(person.id, { active: false, ...(force ? { force: true } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ASSETS_STILL_HELD') {
        const data = err.data as { assets?: Held[]; totalBookValue?: number } | undefined;
        setHeld(data?.assets ?? []);
        setBookValue(data?.totalBookValue ?? null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not switch this account off');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Switch off ${person.name}`}
      description="They stop being able to sign in. Their work and history stay exactly where they are."
    >
      <ModalBody className="space-y-4">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        {held === null ? (
          <Note>
            Nothing is deleted. Their tasks, the work they closed and everything they entered stay on
            the record — this only stops the account signing in.
          </Note>
        ) : held.length === 0 ? (
          <Note>They are not holding any company equipment.</Note>
        ) : (
          <div className="rounded-xl border border-warning/30 bg-warning-tint p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-warning-ink">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} />
              Still holding {held.length} item{held.length === 1 ? '' : 's'}
              {bookValue ? ` worth ${rupees(bookValue)}` : ''}
            </p>
            <ul className="mt-2 space-y-1">
              {held.map((a) => (
                <li key={a.id} className="text-xs text-warning-ink">
                  <span className="font-mono">{a.tag}</span> — {a.name}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-warning-ink">
              Check these back in first if you can. Switching them off anyway records the truth — the
              kit stays logged out to them and gets flagged until somebody brings it back.
            </p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={saving}
          onClick={() => void deactivate(held !== null)}
        >
          {held && held.length > 0 ? 'Switch off anyway' : 'Switch off'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
