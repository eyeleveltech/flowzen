'use client';

import { useState, useEffect } from 'react';
import { api, type OrgConfig } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, FieldSelect } from '@/components/ui/field';

type Props = {
  onConfirm: (client: any) => void;
  onCancel: () => void;
};

export function NewClientModal({ onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);

  useEffect(() => {
    api.config.get().then(setConfig).catch(console.error);
  }, []);

  // Company Info
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [state, setState] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('');
  const [companySize, setCompanySize] = useState('');

  // Deal Info
  const [createDeal, setCreateDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [dealStageId, setDealStageId] = useState('');

  // Primary Contact Info
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactDesignation, setContactDesignation] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const handleConfirm = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.companies.create({
        name,
        industry: industry || null,
        email: email || null,
        website: website || null,
        linkedinUrl: linkedinUrl || null,
        twitterUrl: twitterUrl || null,
        instagramUrl: instagramUrl || null,
        sourceId: sourceId || null,
        state: state || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        zip: zip || null,
        country: country || null,
        companySize: companySize || null,
      });

      if (contactName.trim()) {
        try {
          await api.companies.addContact(created.id, {
            name: contactName,
            email: contactEmail || null,
            designation: contactDesignation || null,
            phone: contactPhone || null,
            isPrimary: true,
          });
        } catch (e) {
          console.error('Failed to create primary contact:', e);
        }
      }

      if (createDeal && dealTitle.trim()) {
        try {
          await api.deals.create({
            companyId: created.id,
            title: dealTitle,
            value: dealValue ? Number(dealValue) : null,
            stageId: dealStageId || null,
          });
        } catch (e) {
          console.error('Failed to create deal:', e);
        }
      }

      onConfirm(created);
    } catch (e: any) {
      setError(e.message || 'Failed to create client');
    } finally {
      setBusy(false);
    }
  };

  const sources = config?.sources ?? [];

  return (
    <Modal open={true} title="New Company" onClose={onCancel}>
      <ModalBody className="space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar px-2">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-primary border-b border-border pb-1">Company Details</h3>
          <Field label="Company Name *" value={name} onChange={setName} disabled={busy} />
          
          <div className="grid grid-cols-2 gap-4">
            <Field label="Industry" value={industry} onChange={setIndustry} disabled={busy} />
            <Field label="State/Region" value={state} onChange={setState} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Email" value={email} onChange={setEmail} type="email" disabled={busy} />
            <Field label="Website" value={website} onChange={setWebsite} disabled={busy} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <FieldSelect
                label="Lead Source"
                value={sourceId}
                onChange={setSourceId}
                options={sources.map(s => ({ label: s.name, value: s.id }))}
                placeholder="Select a source..."
                disabled={busy}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Field label="Phone" value={phone} onChange={setPhone} disabled={busy} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Address" value={address} onChange={setAddress} disabled={busy} />
            <Field label="City" value={city} onChange={setCity} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="ZIP/Postal Code" value={zip} onChange={setZip} disabled={busy} />
            <Field label="Country" value={country} onChange={setCountry} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Size" value={companySize} onChange={setCompanySize} disabled={busy} placeholder="e.g. 50-200" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="LinkedIn" value={linkedinUrl} onChange={setLinkedinUrl} disabled={busy} placeholder="https://linkedin.com/company/..." />
            <Field label="Twitter" value={twitterUrl} onChange={setTwitterUrl} disabled={busy} placeholder="https://twitter.com/..." />
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-primary border-b border-border pb-1">Primary Contact</h3>
          <Field label="Contact Name" value={contactName} onChange={setContactName} disabled={busy} placeholder="E.g. Jane Doe" />
          
          <div className="grid grid-cols-2 gap-4">
            <Field label="Designation" value={contactDesignation} onChange={setContactDesignation} disabled={busy} placeholder="CEO" />
            <Field label="Phone" value={contactPhone} onChange={setContactPhone} disabled={busy} />
          </div>
          
          <Field label="Email" value={contactEmail} onChange={setContactEmail} type="email" disabled={busy} />
        </div>

        <div className="space-y-4 pt-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-primary border-b border-border pb-1">
            <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} className="rounded border-gray-300 text-primary focus:ring-primary" disabled={busy} />
            Create an Opportunity (Deal)
          </label>
          
          {createDeal && (
            <div className="space-y-4 pl-6 border-l-2 border-border ml-2 mt-3">
              <Field label="Deal Title" value={dealTitle} onChange={setDealTitle} disabled={busy} placeholder="E.g. Website Redesign" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Deal Value" value={dealValue} onChange={setDealValue} type="number" disabled={busy} placeholder="0" />
                <FieldSelect
                  label="Stage"
                  value={dealStageId}
                  onChange={setDealStageId}
                  options={(config?.stages ?? []).filter(s => s.kind === 'OPEN').map(s => ({ label: s.name, value: s.id }))}
                  placeholder="Select stage..."
                  disabled={busy}
                />
              </div>
            </div>
          )}
        </div>

      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleConfirm} loading={busy} disabled={!name.trim()}>
          Create Company
        </Button>
      </ModalFooter>
    </Modal>
  );
}
