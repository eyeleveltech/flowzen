'use client';

/**
 * The people the team table cannot show: invited and not joined yet, and
 * switched off.
 *
 * The table lists active accounts only, so both kinds vanished from the one
 * screen that manages people. An invitation that lapsed after seven days could
 * not be sent again (inviting the same email is refused), and a person who was
 * switched off could not be switched back on — the server always accepted
 * `active: true`; nothing on screen sent it. Settings listed them, read-only,
 * and pointed back here.
 *
 * Admin only (`setup.admin`), the same gate the server puts on both actions.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MailPlus, UserCheck } from 'lucide-react';
import { api, ApiError, type Member } from '@/lib/api-v2';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Note } from '@/components/ui/empty-state';
import { useConfirmStore } from '@/stores/confirm';

type Sent = { person: Member; link: string; emailed: boolean; days: number };

export function NotSignedInPeople() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmStore((s) => s.confirm);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [switchingOn, setSwitchingOn] = useState<string | null>(null);

  // Under 'team', so everything that refreshes the team table refreshes this.
  const { data } = useQuery({ queryKey: ['team', 'accounts'], queryFn: () => api.users.list() });
  const pending = (data ?? []).filter((m) => m.status === 'PENDING');
  const off = (data ?? []).filter((m) => m.status === 'INACTIVE');
  if (pending.length === 0 && off.length === 0) return null;

  const switchOn = async (m: Member) => {
    const ok = await confirmDialog({
      title: `Switch ${m.name} back on?`,
      message: 'They can sign in again with the password they had, and appear on the team, in pickers and on the calendar.',
      confirmText: 'Switch back on',
    });
    if (!ok) return;
    setSwitchingOn(m.id);
    try {
      await api.users.update(m.id, { active: true });
      toast.success(`${m.name} can sign in again`);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not switch them back on');
    } finally {
      setSwitchingOn(null);
    }
  };

  const resend = async (m: Member) => {
    setResendingId(m.id);
    try {
      const res = await api.users.resendInvite(m.id);
      setSent({ person: m, link: res.inviteLink, emailed: res.emailed, days: res.expiresInDays });
      await queryClient.invalidateQueries({ queryKey: ['team', 'accounts'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send the invitation again');
    } finally {
      setResendingId(null);
    }
  };

  const row = (m: Member, action: React.ReactNode, badge?: React.ReactNode) => (
    <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-primary">{m.name}</p>
        <p className="truncate text-micro text-secondary">
          {[m.email, m.department?.name].filter(Boolean).join(' · ')}
        </p>
      </div>
      {badge}
      {action}
    </li>
  );

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-primary">Not signed in</h2>
        <p className="text-micro text-secondary">Invited people who haven’t joined yet, and accounts that were switched off.</p>
      </div>

      {pending.length > 0 && (
        <>
          <p className="eyebrow bg-subtle/60 px-5 py-2">Invited, not joined yet</p>
          <ul className="divide-y divide-border">
            {pending.map((m) =>
              row(
                m,
                <Button size="sm" variant="secondary" loading={resendingId === m.id} onClick={() => void resend(m)}>
                  <MailPlus className="h-3.5 w-3.5" />
                  Resend invite
                </Button>,
                m.inviteExpired ? <Badge tone="warn">Link expired</Badge> : <Badge tone="neutral">Link sent</Badge>,
              ),
            )}
          </ul>
        </>
      )}

      {off.length > 0 && (
        <>
          <p className="eyebrow bg-subtle/60 px-5 py-2">Switched off</p>
          <ul className="divide-y divide-border">
            {off.map((m) =>
              row(
                m,
                <Button
                  size="sm"
                  variant="secondary"
                  loading={switchingOn === m.id}
                  onClick={() => void switchOn(m)}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Switch back on
                </Button>,
              ),
            )}
          </ul>
        </>
      )}

      {sent && <InviteLinkModal sent={sent} onClose={() => setSent(null)} />}
    </div>
  );
}

/** The new link, shown whether or not the mail went out — as ResetLinkModal does. */
function InviteLinkModal({ sent, onClose }: { sent: Sent; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Invitation for ${sent.person.name}`}>
      <ModalBody className="space-y-4">
        <p className="text-sm text-secondary">
          {sent.emailed
            ? `Emailed to ${sent.person.email ?? 'them'}. The copy below is in case it does not arrive.`
            : 'Mail did not go out, so send this to them yourself.'}
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-subtle/40 px-3 py-2.5">
          <code className="flex-1 truncate text-xs text-primary">{sent.link}</code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(sent.link);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Note>It works for {sent.days} days. Any earlier link has stopped working.</Note>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
