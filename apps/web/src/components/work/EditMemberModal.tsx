'use client';

/**
 * Editing a team member's own details.
 *
 * Nothing could change them. The member list offered access, kit, a password
 * link and switching the account off — so a misspelled name, or somebody who
 * changed theirs, stayed wrong for ever, and a department typed once as
 * "Video & Production" could never become "Video / Production" without an
 * admin going to the database.
 *
 * Access and permissions stay in their own modal. They are a different
 * decision, made by different people at different times, and putting a role
 * dropdown beside a name field invites changing one while meaning the other.
 *
 * The email is the login. A typo locks somebody out, so the server checks it
 * against every other account and answers with the name of whoever already
 * has it rather than a constraint error.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { useDepartments } from '@/hooks/queries';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

type Member = { id: string; name: string; email?: string | null; departmentId?: string | null };

export function EditMemberModal({
  member,
  onConfirm,
  onCancel,
}: {
  member: Member;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member.name ?? '');
  const [email, setEmail] = useState(member.email ?? '');
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? '');
  // The department records, by id — a rename in Settings shows here at once.
  const { departments } = useDepartments();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Required: everybody is in a department. Somebody not yet placed starts on
   * "Choose a department…" and cannot be saved until they are.
   */
  const options = departments.map((d) => ({ value: d.id, label: d.name }));

  const canSave = Boolean(name.trim()) && Boolean(email.trim()) && Boolean(departmentId) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.users.update(member.id, {
        name: name.trim(),
        email: email.trim(),
        departmentId,
      } as never);
      toast.success(`${name.trim()} updated`);
      onConfirm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save these changes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Edit ${member.name}`} description="Their own details — access is set separately." onClose={onCancel} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field label="Name" value={name} onChange={setName} disabled={busy} required />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            disabled={busy}
            required
            hint="This is how they sign in."
          />
          <FieldSelect
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={[{ value: '', label: 'Choose a department…' }, ...options]}
            disabled={busy}
            required
          />
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canSave}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
