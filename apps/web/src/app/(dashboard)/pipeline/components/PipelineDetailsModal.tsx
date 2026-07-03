'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Save } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { STAGE_FIELDS, StageField } from '../lib/stage-config';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

const PIPELINE_STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED'
];

interface PipelineDetailsModalProps {
  lead: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function PipelineDetailsModal({ lead, onClose, onSuccess }: PipelineDetailsModalProps) {
  const currentIndex = PIPELINE_STAGES.indexOf(lead.stage) >= 0 ? PIPELINE_STAGES.indexOf(lead.stage) : 0;
  
  // Gather all fields up to the current stage
  const combinedFields: StageField[] = [];
  for (let i = 0; i <= currentIndex; i++) {
    const stageName = PIPELINE_STAGES[i];
    const stageFields = STAGE_FIELDS[stageName] || [];
    for (const f of stageFields) {
      if (!combinedFields.find(cf => cf.key === f.key)) {
        combinedFields.push(f);
      }
    }
  }

  // Pre-fill form data from existing deal fields
  const initialFormData: Record<string, any> = {};
  if (lead.dealFields && Array.isArray(lead.dealFields)) {
    lead.dealFields.forEach((df: any) => {
      // Find field type to properly parse checklists
      const fieldConfig = combinedFields.find(f => f.key === df.fieldKey);
      if (fieldConfig && fieldConfig.type === 'checklist') {
        initialFormData[df.fieldKey] = df.fieldValue ? df.fieldValue.split(', ') : [];
      } else {
        initialFormData[df.fieldKey] = df.fieldValue || '';
      }
    });
  }

  const [formData, setFormData] = useState<Record<string, any>>(initialFormData);
  const [submitting, setSubmitting] = useState(false);

  // Core deal fields not in STAGE_FIELDS
  const requiresDealValue = currentIndex >= PIPELINE_STAGES.indexOf('NEGOTIATION') && lead.stage !== 'CHURNED';
  const showsContractType = currentIndex >= PIPELINE_STAGES.indexOf('CONTRACT') && lead.stage !== 'CHURNED';
  const isChurned = lead.stage === 'CHURNED';

  const [dealValue, setDealValue] = useState(lead.dealValue ? String(lead.dealValue) : '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(lead.expectedCloseDate ? String(lead.expectedCloseDate).substring(0, 10) : '');
  const [contractType, setContractType] = useState(lead.contractType || 'RETAINER');
  const [lostReason, setLostReason] = useState(lead.lostReason || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload: any = {
        fields: formData,
      };

      if (requiresDealValue) {
        payload.dealValue = dealValue ? parseFloat(dealValue) : null;
        payload.expectedCloseDate = expectedCloseDate ? new Date(expectedCloseDate).toISOString() : null;
      }
      if (showsContractType) {
        payload.contractType = contractType;
      }
      if (isChurned) {
        payload.lostReason = lostReason;
      }

      await api.patch(`/crm/leads/${lead.id}`, payload);
      toast.success('Pipeline details updated');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update details');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleChecklistChange = (key: string, option: string, checked: boolean) => {
    setFormData(prev => {
      const currentList = prev[key] || [];
      if (checked) {
        return { ...prev, [key]: [...currentList, option] };
      } else {
        return { ...prev, [key]: currentList.filter((item: string) => item !== option) };
      }
    });
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-xl border border-border flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-primary">Update Pipeline Details</h2>
            <p className="text-sm text-secondary mt-0.5">Missing info for {lead.contactName || lead.companyName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="pipeline-details-form" onSubmit={handleSubmit} className="space-y-5">
            
            {combinedFields.length === 0 && !requiresDealValue && !isChurned ? (
              <p className="text-sm text-secondary text-center py-4">No pipeline details required for the current stage.</p>
            ) : (
              <>
                {requiresDealValue && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-border">
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Deal Value (₹)</label>
                      <input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} required className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#374151] mb-1.5">Expected Close Date</label>
                      <input type="date" value={expectedCloseDate} onChange={e => setExpectedCloseDate(e.target.value)} required className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                  </div>
                )}
                {showsContractType && (
                  <div className="pb-4 border-b border-border">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Contract Type</label>
                    <Select
                      value={contractType}
                      onChange={(v) => setContractType(v)}
                      options={[{ label: 'Retainer', value: 'RETAINER' }, { label: 'Project', value: 'PROJECT' }, { label: 'Hybrid', value: 'HYBRID' }]}
                    />
                  </div>
                )}
                {isChurned && (
                  <div className="pb-4 border-b border-border">
                    <label className="block text-sm font-medium text-[#374151] mb-1.5">Reason for Loss <span className="text-red-500">*</span></label>
                    <Select
                      value={lostReason}
                      onChange={(v) => setLostReason(v)}
                      options={[
                        { label: 'Lost to Competitor', value: 'COMPETITOR' },
                        { label: 'Price too high', value: 'PRICE' },
                        { label: 'Lack of features', value: 'FEATURES' },
                        { label: 'Timing / Ghosted', value: 'TIMING' },
                        { label: 'Other', value: 'OTHER' }
                      ]}
                    />
                  </div>
                )}
                {combinedFields.map((field: StageField) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">
                    {field.label}
                  </label>
                  
                  {field.type === 'text' || field.type === 'number' || field.type === 'date' ? (
                    <input
                      type={field.type}
                      value={formData[field.key] || ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary"
                    />
                  ) : field.type === 'textarea' ? (
                    <textarea
                      value={formData[field.key] || ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary min-h-[80px]"
                    />
                  ) : field.type === 'select' ? (
                    <Select
                      value={formData[field.key] || ''}
                      onChange={(v) => handleFieldChange(field.key, v)}
                      options={[{ label: 'Select...', value: '' }, ...(field.options || []).map(opt => ({ label: opt, value: opt }))]}
                    />
                  ) : field.type === 'checklist' ? (
                    <div className="space-y-2">
                      {(field.options || []).map(opt => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(formData[field.key] || []).includes(opt)}
                            onChange={(e) => handleChecklistChange(field.key, opt, e.target.checked)}
                            className="rounded border-[#D1D5DB] text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-[#374151]">{opt}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              </>
            )}
            
          </form>
        </div>

        <div className="p-4 border-t border-border bg-gray-50 flex gap-3 rounded-b-2xl">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="pipeline-details-form"
            disabled={submitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? 'Saving...' : (
              <>
                <Save className="w-4 h-4" />
                Save Details
              </>
            )}
          </button>
        </div>
      </motion.div>
    </>
  );
}
