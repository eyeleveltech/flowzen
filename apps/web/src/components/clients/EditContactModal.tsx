'use client';

/**
 * Correcting a contact.
 *
 * The client page could add a contact and show one, and nothing could change
 * it. A name typed with a typo, somebody who moved from being the contact to
 * being the approver, a phone number that changed — all of it stayed wrong, and
 * the only way round was adding a second person for the same human and leaving
 * the first sitting there. `PATCH /companies/:id/people/:personId` has existed
 * the whole time with nothing calling it.
 *
 * The role matters more than it looks: APPROVER is who signs off the work and
 * PAYER is who the invoice chases, and a proforma reads them. Getting it wrong
 * is a document sent to the wrong person.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';

export type Contact = {
  id: string;
  name: string;
  role: 'APPROVER' | 'PAYER' | 'CONTACT';
  email?: string | null;
  phone?: string | null;
};

const ROLE_OPTIONS = [
  { value: 'CONTACT', label: 'Contact — the person you deal with' },
  { value: 'APPROVER', label: 'Approver — signs the work off' },
  { value: 'PAYER', label: 'Payer — who the invoice goes to' },
];

export function EditContactModal({
  companyId,
  contact,
  onClose,
  onSaved,
}: {
  companyId: string;
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(contact.name ?? '');
  const [role, setRole] = useState<string>(contact.role ?? 'CONTACT');
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same check the add form makes, so a bad address is caught here rather
  // than coming back as a 400 with the modal still open.
  const emailLooksWrong = email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSave = name.trim().length > 0 && !emailLooksWrong && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await api.companies.updateContact(companyId, contact.id, {
        name: name.trim(),
        role,
        // Cleared deliberately rather than left behind: an empty box means "we
        // do not have this", which is a different fact from the old value.
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      toast.success(`${name.trim()} updated`);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save this contact');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Edit ${contact.name}`} description="Who they are at the client, and how to reach them." onClose={onClose} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <ModalBody className="space-y-4">
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

          <Field label="Full name" value={name} onChange={setName} required disabled={busy} />
          <FieldSelect
            label="Role"
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
            required
            disabled={busy}
            hint="A proforma reads these — the approver signs off, the payer is chased."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              disabled={busy}
              error={emailLooksWrong ? 'That does not look like an email address' : undefined}
            />
            <Field label="Phone" type="tel" value={phone} onChange={setPhone} disabled={busy} />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
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
