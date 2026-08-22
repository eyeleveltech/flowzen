'use client';

import { useState, useEffect } from 'react';
import { api, type Company } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { NewClientModal } from '@/components/clients/NewClientModal';
import { Plus } from 'lucide-react';

type Props = {
  onConfirm: (deal: any) => void;
  onCancel: () => void;
};

export function NewDealModal({ onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [creatingClient, setCreatingClient] = useState(false);

  useEffect(() => {
    api.companies.list()
      .then(setCompanies)
      .catch(e => setError(e.message))
      .finally(() => setLoadingCompanies(false));
  }, []);

  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');

  const handleConfirm = async () => {
    if (!companyId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.deals.create({
        companyId,
        title: title || undefined, // Fallback to server default if empty
        value: value ? parseFloat(value) : null,
        expectedCloseDate: expectedCloseDate || null,
      });
      onConfirm(created);
    } catch (e: any) {
      setError(e.message || 'Failed to create deal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal open={true} title="New Deal" onClose={onCancel}>
      <ModalBody className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium text-body">Client *</label>
            <button 
              type="button" 
              onClick={() => setCreatingClient(true)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> New Company
            </button>
          </div>
          <Select 
            value={companyId}
            onChange={setCompanyId}
            options={companies.map(c => ({ label: c.name, value: c.id }))}
            placeholder="Select a client..."
            disabled={busy}
          />
        </div>

        <Field label="Deal Title" value={title} onChange={setTitle} placeholder="e.g. Website Redesign" disabled={busy} />
        
        <div className="grid grid-cols-2 gap-4">
          <Field label="Value" value={value} onChange={setValue} type="number" placeholder="0.00" disabled={busy} />
          <Field label="Expected Close" value={expectedCloseDate} onChange={setExpectedCloseDate} type="date" disabled={busy} />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={handleConfirm} loading={busy} disabled={!companyId}>
          Create Deal
        </Button>
      </ModalFooter>
    </Modal>
    {creatingClient && (
      <NewClientModal
        onConfirm={(c: any) => {
          setCompanies(prev => [c, ...prev]);
          setCompanyId(c.id);
          setCreatingClient(false);
        }}
        onCancel={() => setCreatingClient(false)}
      />
    )}
    </>
  );
}
