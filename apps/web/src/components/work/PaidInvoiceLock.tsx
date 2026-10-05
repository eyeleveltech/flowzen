'use client';

/**
 * A paid invoice is locked.
 *
 * Its number, dates and document are what the client was sent and paid
 * against. Only an admin (`setup.admin`, which Management holds) may change
 * them, and only by saying why — the server keeps the reason with the edit.
 * Everybody else is told it is locked rather than handed a form the server
 * will refuse.
 */

import { Field } from '@/components/ui/field';
import { Note } from '@/components/ui/empty-state';
import { useAuthStore } from '@/stores';

/** Mirrors `hasPermission(user, 'setup.admin')` on the server: the permission, or Management. */
export function useIsAdmin(): boolean {
  const user = useAuthStore((st) => st.user);
  return Boolean(user && (user.preset === 'MANAGEMENT' || (user.permissions ?? []).includes('setup.admin')));
}

/** Whether this person may edit an invoice in this status at all. */
export function useMayEditInvoice(status: string | null | undefined): boolean {
  const admin = useIsAdmin();
  return status !== 'PAID' || admin;
}

/** A reason long enough for the server to take. */
export const reasonGiven = (reason: string) => reason.trim().length >= 3;

export function PaidInvoiceLock({
  admin,
  reason,
  onReason,
  disabled,
}: {
  admin: boolean;
  reason: string;
  onReason: (v: string) => void;
  disabled?: boolean;
}) {
  if (!admin) {
    return (
      <Note tone="warn">
        This invoice is paid, so it is locked. Ask an admin if it really needs to change.
      </Note>
    );
  }
  return (
    <div className="space-y-2">
      <Note tone="warn">
        This invoice is paid. Changing it changes what the client was sent and paid against.
      </Note>
      <Field
        label="Why does it need to change?"
        value={reason}
        onChange={onReason}
        required
        disabled={disabled}
        placeholder="e.g. Tally number was typed wrong"
        hint="Kept on the record with the change."
      />
    </div>
  );
}
