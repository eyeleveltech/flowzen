'use client';

import { useState } from 'react';
import { api, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

type Props = {
  company: Company;
  onConfirm: (updatedCompany: Company) => void;
  onCancel: () => void;
};

export function ExtendedCompanyInfoModal({ company, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companySize, setCompanySize] = useState(company.companySize || '');
  const [gstNumber, setGstNumber] = useState(company.gstNumber || '');
  const [billingAddress, setBillingAddress] = useState(company.billingAddress || '');

  const handleConfirm = async () => {
    if (!gstNumber.trim() || !billingAddress.trim()) {
      setError('GST Number and Billing Address are required for this stage.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await api.companies.update(company.id, {
        companySize: companySize || null,
        gstNumber: gstNumber || null,
        billingAddress: billingAddress || null,
      });
      onConfirm(updated);
    } catch (e: any) {
      setError(e.message || 'Failed to update company info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={true} title="Complete Company Profile" onClose={onCancel}>
      <ModalBody className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        
        <p className="text-sm text-secondary">
          To move this deal forward, we need to collect a few more details about <strong>{company.name}</strong> for billing and quotation purposes.
        </p>

        <Field 
          label="GST Number *" 
          value={gstNumber} 
          onChange={setGstNumber} 
          disabled={busy} 
          placeholder="e.g. 27AADCB2230M1Z2" 
        />
        
        <div>
          <label className="block text-sm font-medium text-body mb-1.5">Billing Address *</label>
          <textarea
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            disabled={busy}
            placeholder="Full billing address..."
            className="w-full min-h-24 rounded-input border border-border bg-white px-3 py-2 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-body mb-1.5">Company Size</label>
          <Select
            value={companySize}
            onChange={setCompanySize}
            options={[
              { label: '1-10 employees', value: '1-10' },
              { label: '11-50 employees', value: '11-50' },
              { label: '51-200 employees', value: '51-200' },
              { label: '201-500 employees', value: '201-500' },
              { label: '500+ employees', value: '500+' },
            ]}
            placeholder="Select company size..."
            disabled={busy}
          />
        </div>

      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleConfirm} loading={busy}>
          Save & Continue
        </Button>
      </ModalFooter>
    </Modal>
  );
}
