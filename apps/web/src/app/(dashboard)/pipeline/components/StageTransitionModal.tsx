'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowRight, AlertTriangle } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { STAGE_FIELDS, StageField } from '../lib/stage-config';
import toast from 'react-hot-toast';

const PIPELINE_STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'CONTRACT', 'ON_HOLD', 'PROJECT_COMPLETED', 'CHURNED'
];

const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: 'New Lead',
  OUTREACH: 'Outreach',
  MEETING: 'Meeting',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  CONTRACT: 'Won & Closed',
  ACTIVE_RETAINER: 'Active (Retainer)',
  ACTIVE_PROJECT: 'Active (Project)',
  ON_HOLD: 'On Hold',
  PROJECT_COMPLETED: 'Project Completed',
  CHURNED: 'Lost & Closed',
};

// The exact Lost Reason options per §3.6
const LOST_REASONS = [
  { label: 'Quotation too high', value: 'BUDGET' },
  { label: 'Client got a better offer', value: 'COMPETITOR' },
  { label: "Unknown — client doesn't want to proceed", value: 'NO_BUDGET' },
  { label: 'On hold', value: 'TIMING' },
  { label: 'Not responsive — client not answering calls', value: 'UNRESPONSIVE' },
];

interface StageTransitionModalProps {
  lead: any;
  currentStage: string;
  targetStage: string;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  isLoading: boolean;
}

export function StageTransitionModal({ lead, currentStage, targetStage, onClose, onSubmit, isLoading }: StageTransitionModalProps) {
  const currentIndex = PIPELINE_STAGES.indexOf(currentStage);
  const targetIndex = PIPELINE_STAGES.indexOf(targetStage);
  
  let combinedFields: StageField[] = [];
  // For forward transitions, accumulate fields from all intermediate stages
  if (targetIndex > currentIndex && targetStage !== 'CHURNED' && targetStage !== 'ON_HOLD') {
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

  // Pre-fill form data from existing deal fields
  const initialFormData: Record<string, any> = {};
  if (lead && lead.dealFields && Array.isArray(lead.dealFields)) {
    lead.dealFields.forEach((df: any) => {
      const fieldConfig = combinedFields.find(f => f.key === df.fieldKey);
      if (fieldConfig && fieldConfig.type === 'checklist') {
        initialFormData[df.fieldKey] = df.fieldValue ? df.fieldValue.split(', ') : [];
      } else {
        initialFormData[df.fieldKey] = df.fieldValue || '';
      }
    });
  }

  const [formData, setFormData] = useState<Record<string, any>>(initialFormData);
  
  // Deal value + expected close date shown when entering NEGOTIATION / CONTRACT
  const requiresDealValue = ['NEGOTIATION', 'CONTRACT'].includes(targetStage);
  // Contract type shown when entering CONTRACT or Active
  const showsContractType = ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage);
  // Hard gate: entering Active requires a confirmed signed contract
  const isActivationGate = ['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage);

  const [dealValue, setDealValue] = useState(lead?.dealValue ? String(lead.dealValue) : '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(lead?.expectedCloseDate ? String(lead.expectedCloseDate).substring(0, 10) : '');
  const [contractType, setContractType] = useState(lead?.contractType || 'RETAINER');
  const [lostReason, setLostReason] = useState(LOST_REASONS[0].value);
  const [followUpDate, setFollowUpDate] = useState(lead?.followUpDate ? String(lead.followUpDate).substring(0, 10) : '');
  const [lastContactedDate, setLastContactedDate] = useState(lead?.lastContactedDate ? String(lead.lastContactedDate).substring(0, 10) : '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Note: auditFindings and auditReportLink have been removed as per §3.4

    const payload: any = {
      stage: targetStage,
      fields: formData,
    };

    if (requiresDealValue && dealValue) payload.dealValue = parseFloat(dealValue);
    if (requiresDealValue && expectedCloseDate) payload.expectedCloseDate = expectedCloseDate;

    if (showsContractType) {
      payload.contractType = contractType;
    }

    // §3.6 Lost & Closed: send only the mandatory lost reason
    if (targetStage === 'CHURNED') {
      payload.lostReason = lostReason;
    }

    if (!['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage)) {
      payload.followUpDate = followUpDate || null;
      payload.lastContactedDate = lastContactedDate || null;
    } else {
      payload.followUpDate = null;
      payload.lastContactedDate = null;
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

  const fromLabel = STAGE_LABELS[currentStage] ?? currentStage.replace(/_/g, ' ');
  const toLabel = STAGE_LABELS[targetStage] ?? targetStage.replace(/_/g, ' ');

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
            <h2 className="text-lg font-semibold text-primary">Move to {toLabel}</h2>
            <p className="text-xs text-secondary flex items-center gap-2 mt-1">
              {fromLabel} <ArrowRight className="w-3 h-3" /> {toLabel}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6] transition-colors">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="stage-form" onSubmit={handleSubmit} className="space-y-5">
            
            {/* §3.5 Alert banner for Active gate */}
            {isActivationGate && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>The signed contract must be uploaded below before this deal can be activated.</span>
              </div>
            )}

            {requiresDealValue && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-border">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Deal Value (₹)</label>
                  <input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Expected Close Date</label>
                  <input type="date" value={expectedCloseDate} onChange={e => setExpectedCloseDate(e.target.value)} className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary" />
                </div>
              </div>
            )}

            {showsContractType && (
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Contract Type</label>
                <Select value={contractType} onChange={setContractType} options={[{ label: 'Retainer', value: 'RETAINER' }, { label: 'One-Time Project', value: 'ONE_TIME' }]} />
              </div>
            )}

            {/* §3.6 Lost & Closed: ONLY the Lost Reason dropdown */}
            {targetStage === 'CHURNED' && (
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">
                  Reason for Loss <span className="text-red-500">*</span>
                </label>
                <Select
                  value={lostReason}
                  onChange={setLostReason}
                  options={LOST_REASONS}
                />
              </div>
            )}

            {!['ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(targetStage) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Next Follow-up Date</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1.5">Last Contacted Date</label>
                  <input
                    type="date"
                    value={lastContactedDate}
                    onChange={e => setLastContactedDate(e.target.value)}
                    className="w-full rounded-xl border border-border px-4 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            {/* Dynamic stage fields */}
            {fields.map((field: StageField) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                
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
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {(field.options || []).map(opt => (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer rounded-lg border border-border px-3 py-2 hover:bg-gray-50 transition-colors">
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
