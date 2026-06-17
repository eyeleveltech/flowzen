'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { STAGE_FIELDS, StageField } from '../lib/stage-config';
import toast from 'react-hot-toast';

const PIPELINE_STAGES = [
  'LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION', 
  'PROPOSAL', 'NEGOTIATION', 'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 
  'ACTIVE_PROJECT', 'WON_CLOSED', 'LOST_CLOSED'
];

interface StageTransitionModalProps {
  currentStage: string;
  targetStage: string;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  isLoading: boolean;
}

export function StageTransitionModal({ currentStage, targetStage, onClose, onSubmit, isLoading }: StageTransitionModalProps) {
  const currentIndex = PIPELINE_STAGES.indexOf(currentStage);
  const targetIndex = PIPELINE_STAGES.indexOf(targetStage);
  
  let combinedFields: StageField[] = [];
  if (targetIndex > currentIndex) {
    for (let i = currentIndex + 1; i <= targetIndex; i++) {
      const stageName = PIPELINE_STAGES[i];
      const stageFields = STAGE_FIELDS[stageName] || [];
      for (const f of stageFields) {
        if (!combinedFields.find(cf => cf.key === f.key)) {
          combinedFields.push(f);
        }
      }
    }
  } else {
    combinedFields = STAGE_FIELDS[targetStage] || [];
  }
  
  const fields = combinedFields;
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // Also collect deal value and expected close date if it's SQL or later
  const requiresDealValue = ['SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION', 'PROPOSAL', 'NEGOTIATION', 'FINALIZATION'].includes(targetStage);
  
  // Specific required fields based on the brief
  const [dealValue, setDealValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [contractType, setContractType] = useState('RETAINER');
  const [lostReason, setLostReason] = useState('BUDGET');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const payload: any = {
      stage: targetStage,
      fields: formData,
      notes: notes || undefined,
    };

    if (requiresDealValue && dealValue) payload.dealValue = parseFloat(dealValue);
    if (requiresDealValue && expectedCloseDate) payload.expectedCloseDate = expectedCloseDate;
    
    if (targetStage === 'CONTRACT' || targetStage === 'ACTIVE_RETAINER' || targetStage === 'ACTIVE_PROJECT') {
      payload.contractType = contractType;
    }
    
    if (targetStage === 'LOST_CLOSED') {
      payload.lostReason = lostReason;
    }

    try {
      await onSubmit(payload);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update stage');
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
            <h2 className="text-lg font-semibold text-primary">Move to {targetStage.replace('_', ' ')}</h2>
            <p className="text-xs text-secondary flex items-center gap-2 mt-1">
              {currentStage.replace('_', ' ')} <ArrowRight className="w-3 h-3" /> {targetStage.replace('_', ' ')}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="stage-form" onSubmit={handleSubmit} className="space-y-5">
            
            {requiresDealValue && (
              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-border">
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

            {targetStage === 'CONTRACT' && (
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Contract Type</label>
                <Select value={contractType} onChange={setContractType} options={[{ label: 'Retainer', value: 'RETAINER' }, { label: 'One-Time Project', value: 'ONE_TIME' }]} />
              </div>
            )}

            {targetStage === 'LOST_CLOSED' && (
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Lost Reason</label>
                <Select value={lostReason} onChange={setLostReason} options={['BUDGET', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'UNRESPONSIVE', 'SCOPE_MISMATCH', 'INTERNAL_CHANGE', 'OTHER'].map(r => ({ label: r.replace('_', ' '), value: r }))} />
              </div>
            )}

            {fields.map((field: StageField) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">{field.label}</label>
                
                {field.type === 'text' || field.type === 'number' || field.type === 'date' ? (
                  <input
                    type={field.type}
                    required={field.required}
                    value={formData[field.key] || ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary"
                  />
                ) : field.type === 'textarea' ? (
                  <textarea
                    required={field.required}
                    value={formData[field.key] || ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary min-h-[80px]"
                  />
                ) : field.type === 'select' ? (
                  <Select
                    value={formData[field.key] || ''}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    options={(field.options || []).map(opt => ({ label: opt, value: opt }))}
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

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Stage Change Notes (Optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary min-h-[60px]"
                placeholder="Log any context for this stage change..."
              />
            </div>
            
          </form>
        </div>

        <div className="p-4 border-t border-border bg-gray-50 flex gap-3 rounded-b-2xl">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-[#374151] bg-white border border-[#D1D5DB] rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit" form="stage-form" disabled={isLoading} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-xl hover:bg-[#1F2937] transition-colors disabled:opacity-50">
            {isLoading ? 'Saving...' : 'Confirm Stage Change'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
