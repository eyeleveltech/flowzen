'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';

type Props = {
  client: any;
  onConfirm: () => void;
  onCancel: () => void;
};

export function EditClientModal({ client, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);

  // Form state
  const [name, setName] = useState(client.name ?? '');
  const [industry, setIndustry] = useState(client.industry ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [website, setWebsite] = useState(client.website ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(client.linkedinUrl ?? '');
  const [gstNumber, setGstNumber] = useState(client.gstNumber ?? '');
  const [state, setState] = useState(client.state ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [city, setCity] = useState(client.city ?? '');
  const [zip, setZip] = useState(client.zip ?? '');
  const [country, setCountry] = useState(client.country ?? '');
  const [companySize, setCompanySize] = useState(client.companySize ?? '');
  const [ownerId, setOwnerId] = useState(client.owner?.id ?? client.ownerId ?? '');

  useEffect(() => {
    void api.users
      .list()
      .then((list) =>
        setTeam(list.filter((u) => u.status === 'ACTIVE').map((u) => ({ value: u.id, label: u.name })))
      )
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.companies.update(client.id, {
        name,
        industry: industry || null,
        email: email || null,
        phone: phone || null,
        website: website || null,
        linkedinUrl: linkedinUrl || null,
        gstNumber: gstNumber || null,
        state: state || null,
        address: address || null,
        city: city || null,
        zip: zip || null,
        country: country || null,
        companySize: companySize || null,
        ownerId: ownerId || null,
      });
      onConfirm();
    } catch (e: any) {
      setError(e.message || 'Failed to update client details');
    } finally {
      setBusy(false);
    }
  };

  const NONE = { value: '', label: '— None —' };

  return (
    <Modal open={true} title="Edit Client Information" onClose={onCancel}>
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        <ModalBody className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">{error}</div>}

          <Field label="Company Name *" value={name} onChange={setName} disabled={busy} required />

          <div className="grid grid-cols-2 gap-4">
            <Field label="Industry" value={industry} onChange={setIndustry} disabled={busy} placeholder="e.g. Technology, Retail" />
            <FieldSelect label="Account Owner" value={ownerId} onChange={setOwnerId} options={[NONE, ...team]} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value={email} onChange={setEmail} type="email" disabled={busy} />
            <Field label="Phone" value={phone} onChange={setPhone} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Website" value={website} onChange={setWebsite} disabled={busy} placeholder="https://example.com" />
            <Field label="GST / Tax ID" value={gstNumber} onChange={setGstNumber} disabled={busy} placeholder="GSTIN / Tax ID" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="State / Region" value={state} onChange={setState} disabled={busy} />
            <Field label="Company Size" value={companySize} onChange={setCompanySize} disabled={busy} placeholder="e.g. 10-50 employees" />
          </div>

          <Field label="Address" value={address} onChange={setAddress} disabled={busy} />

          <div className="grid grid-cols-3 gap-3">
            <Field label="City" value={city} onChange={setCity} disabled={busy} />
            <Field label="Zip Code" value={zip} onChange={setZip} disabled={busy} />
            <Field label="Country" value={country} onChange={setCountry} disabled={busy} />
          </div>

          <Field label="LinkedIn URL" value={linkedinUrl} onChange={setLinkedinUrl} disabled={busy} />
        </ModalBody>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} loading={busy} disabled={!name.trim()}>
          Save Changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
