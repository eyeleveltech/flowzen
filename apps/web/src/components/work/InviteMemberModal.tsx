'use client';

/**
 * Inviting someone new — creates the account, doesn't sign anyone in.
 *
 * The invitation is emailed when a mail server is configured (Settings ->
 * Email), and the link is shown here either way — an admin who cannot see it
 * has no way to invite anybody the first time a server refuses a connection.
 * Once accept-invite is opened and a password set, the account activates
 * itself.
 */

import { useState } from 'react';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

const PRESET_OPTIONS = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'HEAD', label: 'Department head' },
  { value: 'BD', label: 'Business development' },
  { value: 'ACCOUNTS', label: 'Accounts' },
  { value: 'MANAGEMENT', label: 'Management' },
];

export function InviteMemberModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('');
  const [preset, setPreset] = useState('EMPLOYEE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  const canSave = Boolean(name.trim()) && Boolean(email.trim()) && Boolean(dept.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.users.invite({ name: name.trim(), email: email.trim(), dept: dept.trim(), preset });
      setLink(res.data.inviteLink);
      setEmailed(res.data.emailed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invite');
    } finally {
      setSaving(false);
    }
  };

  if (link) {
    return (
      <Modal open onClose={onInvited} title={`${name.trim()} is invited`}>
        <ModalBody className="space-y-4">
          <p className="text-sm text-secondary">
            {emailed
              ? 'Emailed to them. The copy below is in case it does not arrive.'
              : 'Mail did not go out, so send this link to them yourself.'}{' '}
            It signs them in to set their own password.
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-subtle/40 px-3 py-2.5">
            <code className="flex-1 truncate text-xs text-primary">{link}</code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(link)}
            >
              Copy
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={onInvited}>
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Invite someone">
      <form onSubmit={submit}>
        <ModalBody className="space-y-4">
          <Field label="Name" value={name} onChange={setName} required />
          <Field label="Email" value={email} onChange={setEmail} type="email" required />
          <Field label="Department" value={dept} onChange={setDept} required placeholder="e.g. Design" />
          <FieldSelect label="Access preset" value={preset} onChange={setPreset} required options={PRESET_OPTIONS} />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Create invite
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
