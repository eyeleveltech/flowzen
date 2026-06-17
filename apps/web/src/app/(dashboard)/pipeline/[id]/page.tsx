'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Building2, User, Phone, Mail, Calendar, MapPin, IndianRupee, Tag, Activity as ActivityIcon } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { STAGE_FIELDS } from '../lib/stage-config';
import { StageTransitionModal } from '../components/StageTransitionModal';
import { EditLeadModal } from '../components/EditLeadModal';
import { Pencil, Trash2, Send } from 'lucide-react';
import { Select } from '@/components/ui/select';

const PIPELINE_STAGES = [
  'LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION', 
  'PROPOSAL', 'NEGOTIATION', 'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 
  'ACTIVE_PROJECT', 'WON_CLOSED', 'LOST_CLOSED'
];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetStage, setTargetStage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  
  // Safe unwrapping for Next.js 15 async params
  const { id: leadId } = use(params);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => api.get<any>(`/crm/leads/${leadId}`)
  });

  const stageMutation = useMutation({
    mutationFn: (payload: any) => api.post(`/crm/leads/${leadId}/stage`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setIsModalOpen(false);
      toast.success('Stage updated successfully');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/crm/leads/${leadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead deleted successfully');
      router.push('/pipeline');
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: (note: string) => api.post(`/crm/leads/${leadId}/notes`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      setNoteText('');
      toast.success('Note added');
    }
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  if (!lead) {
    return <div className="p-8 text-center text-gray-500">Lead not found</div>;
  }

  const currentStageIndex = PIPELINE_STAGES.indexOf(lead.stage);

  // Helper to format field labels nicely
  const getFieldLabel = (key: string) => {
    for (const fields of Object.values(STAGE_FIELDS)) {
      const f = fields.find(f => f.key === key);
      if (f) return f.label;
    }
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-(--spacing(16)))] bg-gray-50/50 overflow-hidden">
      
      {/* Header */}
      <div className="bg-white border-b border-border px-8 py-6 z-10 shrink-0">
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => router.push('/pipeline')} className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Pipeline
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#4B5563] bg-white border border-border rounded-lg hover:bg-[#F9FAFB] transition-colors"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-primary flex items-center gap-3">
              {lead.client.company || lead.client.name}
              <span className="px-2.5 py-0.5 rounded-md bg-[#F3F4F6] text-primary text-xs font-medium border border-border">
                {lead.stage.replace('_', ' ')}
              </span>
            </h1>
            <div className="flex items-center gap-6 mt-3 text-sm text-[#4B5563]">
              <span className="flex items-center gap-1.5"><User className="w-4 h-4 text-[#9CA3AF]" /> {lead.client.name}</span>
              {lead.client.email && <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-[#9CA3AF]" /> {lead.client.email}</span>}
              {lead.client.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-[#9CA3AF]" /> {lead.client.phone}</span>}
              {lead.client.city && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#9CA3AF]" /> {lead.client.city}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-secondary">Deal Value</p>
              <p className="text-2xl font-bold text-primary">₹{lead.dealValue?.toLocaleString() || '0'}</p>
            </div>
            
            <div className="flex gap-2 w-55">
              <Select
                value=""
                onChange={(val) => {
                  if (val) {
                    setTargetStage(val);
                    setIsModalOpen(true);
                  }
                }}
                placeholder="Move Stage To..."
                options={PIPELINE_STAGES.filter(s => s !== lead.stage).map(s => ({
                  label: `${PIPELINE_STAGES.indexOf(s) + 1}. ${s.replace('_', ' ')}`,
                  value: s
                }))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Stepper Component */}
        <div className="mt-8 flex items-center justify-between overflow-x-auto pb-4 scrollbar-hide">
          {PIPELINE_STAGES.slice(0, 11).map((stage, idx) => {
            const isCompleted = PIPELINE_STAGES.indexOf(lead.stage) >= idx;
            const isCurrent = lead.stage === stage;
            return (
              <div key={stage} className="flex flex-col items-center gap-2 relative min-w-25">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold z-10 transition-colors border ${isCurrent ? 'bg-primary text-white border-primary' : isCompleted ? 'bg-[#F3F4F6] text-primary border-border' : 'bg-white text-[#9CA3AF] border-border'}`}>
                  {idx + 1}
                </div>
                <span className={`text-xs font-medium text-center ${isCurrent ? 'text-primary' : isCompleted ? 'text-[#4B5563]' : 'text-[#9CA3AF]'}`}>
                  {stage.replace('_', ' ')}
                </span>
                {idx < 10 && (
                  <div className={`absolute top-4 left-1/2 w-full h-0.5 z-0 ${isCompleted && !isCurrent ? 'bg-primary' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto grid grid-cols-3 gap-8">
          
          {/* Left Column: Details & Deal Fields */}
          <div className="col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-border p-6">
              <h2 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-secondary" /> Lead Intelligence
              </h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-1">Industry</p>
                  <p className="text-sm text-primary">{lead.client.industry || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-1">Source</p>
                  <p className="text-sm text-primary">{lead.source}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-1">Assigned To</p>
                  <div className="flex items-center gap-2 mt-1">
                    {lead.assignedTo?.avatar ? (
                      <img src={lead.assignedTo.avatar} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#F3F4F6] border border-border flex items-center justify-center text-primary text-[10px] font-bold">
                        {lead.assignedTo?.name.charAt(0) || '?'}
                      </div>
                    )}
                    <span className="text-sm font-medium text-primary">{lead.assignedTo?.name || 'Unassigned'}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-secondary uppercase tracking-wider mb-1">Expected Close</p>
                  <p className="text-sm text-primary flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" /> 
                    {lead.expectedCloseDate ? format(new Date(lead.expectedCloseDate), 'PP') : '-'}
                  </p>
                </div>
              </div>
            </div>

            {/* Dynamic Deal Fields Rendering */}
            {lead.dealFields && lead.dealFields.length > 0 && (
              <div className="bg-white rounded-2xl border border-border p-6">
                <h2 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Tag className="w-5 h-5 text-secondary" /> Stage Data Attributes
                </h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                  {lead.dealFields.map((field: any) => (
                    <div key={field.id} className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-xs font-semibold text-secondary mb-1.5">{getFieldLabel(field.fieldKey)}</p>
                      <p className="text-sm text-primary font-medium wrap-break-word">{field.fieldValue || '-'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Activity Timeline */}
          <div className="col-span-1">
            <div className="bg-white rounded-2xl border border-border p-6 h-full">
              <h2 className="text-lg font-semibold text-primary mb-6 flex items-center gap-2">
                <ActivityIcon className="w-5 h-5 text-secondary" /> Activity Timeline
              </h2>
              
              <div className="mb-6 flex gap-2">
                <input
                  type="text"
                  placeholder="Type a note..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteText.trim() && !addNoteMutation.isPending) {
                      addNoteMutation.mutate(noteText);
                    }
                  }}
                  className="flex-1 rounded-xl border border-border bg-gray-50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-all"
                />
                <button
                  onClick={() => addNoteMutation.mutate(noteText)}
                  disabled={!noteText.trim() || addNoteMutation.isPending}
                  className="flex items-center justify-center p-2.5 bg-primary text-white rounded-xl hover:bg-[#1F2937] transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              <div className="relative border-l-2 border-gray-100 ml-3 space-y-8 pb-4">
                {/* Stage History */}
                {lead.stageHistory.map((history: any) => (
                  <div key={history.id} className="relative pl-6">
                    <div className="absolute w-3 h-3 bg-primary rounded-full -left-[7px] top-1.5 ring-4 ring-white" />
                    <p className="text-xs text-secondary mb-1 font-medium">{format(new Date(history.changedAt), 'PPp')}</p>
                    <p className="text-sm text-primary">
                      Moved to <span className="font-semibold text-primary">{history.toStage.replace('_', ' ')}</span>
                    </p>
                    <p className="text-xs text-secondary mt-0.5">by {history.changedBy.name}</p>
                    {history.notes && (
                      <div className="mt-2 p-3 bg-gray-50 rounded-xl text-sm text-[#4B5563] border border-gray-100 italic">
                        "{history.notes}"
                      </div>
                    )}
                  </div>
                ))}

                {/* Activities */}
                {lead.activities.map((activity: any) => {
                  const notes = activity.metadata?.notes;
                  return (
                  <div key={activity.id} className="relative pl-6">
                    <div className="absolute w-2.5 h-2.5 bg-gray-300 rounded-full -left-[6px] top-1.5 ring-4 ring-white" />
                    <p className="text-xs text-secondary mb-1">{format(new Date(activity.createdAt), 'PPp')}</p>
                    <p className="text-sm text-primary">{activity.user.name} <span className="text-[#4B5563]">{activity.message}</span></p>
                    {notes && (
                      <div className="mt-2 p-3 bg-gray-50 rounded-xl text-sm text-[#4B5563] border border-gray-100 whitespace-pre-wrap">
                        {notes}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Stage Transition Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <StageTransitionModal
            currentStage={lead.stage}
            targetStage={targetStage}
            onClose={() => setIsModalOpen(false)}
            onSubmit={async (payload) => {
              await stageMutation.mutateAsync(payload);
            }}
            isLoading={stageMutation.isPending}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditModalOpen && (
          <EditLeadModal
            lead={lead}
            onClose={() => setIsEditModalOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
              queryClient.invalidateQueries({ queryKey: ['leads'] });
              setIsEditModalOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
