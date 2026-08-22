'use client';

import { useState } from 'react';
import { api } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

type Props = {
  companyId: string;
  onConfirm: (contact: any) => void;
  onCancel: () => void;
};

export function NewContactModal({ companyId, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  const handleConfirm = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.companies.addContact(companyId, {
        name,
        email: email || null,
        phone: phone || null,
        designation: designation || null,
        linkedinUrl: linkedinUrl || null,
        isPrimary,
      });
      onConfirm(created);
    } catch (e: any) {
      setError(e.message || 'Failed to create contact');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={true} title="New Contact" onClose={onCancel}>
      <ModalBody className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        
        <Field label="Name *" value={name} onChange={setName} disabled={busy} />
        
        <div className="grid grid-cols-2 gap-4">
          <Field label="Designation" value={designation} onChange={setDesignation} disabled={busy} placeholder="e.g. CTO" />
          <Field label="Phone" value={phone} onChange={setPhone} disabled={busy} />
        </div>
        
        <Field label="Email" value={email} onChange={setEmail} type="email" disabled={busy} />
        <Field label="LinkedIn URL" value={linkedinUrl} onChange={setLinkedinUrl} disabled={busy} />
        
        <label className="flex items-center gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            disabled={busy}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-primary">Mark as Primary Contact</span>
        </label>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleConfirm} loading={busy} disabled={!name.trim()}>
          Add Contact
        </Button>
      </ModalFooter>
    </Modal>
  );
}
