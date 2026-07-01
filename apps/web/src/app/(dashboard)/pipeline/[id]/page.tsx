'use client';

import { useState, use, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Building2, User, Phone, Mail, Calendar, MapPin, Tag, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Globe } from 'lucide-react';
import { STAGE_FIELDS } from '../lib/stage-config';
import { StageTransitionModal } from '../components/StageTransitionModal';
import { WonCelebrationModal } from '../components/WonCelebrationModal';
import { EditLeadModal } from '../components/EditLeadModal';
import { Pencil, Trash2, FolderPlus } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { IntelligenceTab } from '../components/IntelligenceTab';
import { TimelineTab } from '../components/TimelineTab';
import { ContactsTab } from '../components/ContactsTab';
import { useConfirmStore } from '@/stores';

const PIPELINE_STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED'
];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetStage, setTargetStage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'timeline' | 'contacts'>('details');
  const [wonModalLead, setWonModalLead] = useState<any>(null);
  const confirm = useConfirmStore((s) => s.confirm);
  
  // Safe unwrapping for Next.js 15 async params
  const { id: leadId } = use(params);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => api.get<any>(`/crm/leads/${leadId}`)
  });

  const stageMutation = useMutation({
    mutationFn: (payload: any) => api.post(`/crm/leads/${leadId}/stage`, payload),
    onSuccess: (data: any, variables: any) => {
      queryClient.setQueryData(['lead', leadId], data);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setIsModalOpen(false);
      toast.success('Stage updated successfully');
      if (variables?.stage === 'CONTRACT') {
        setWonModalLead(data || lead);
      }
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

  const holdMutation = useMutation({
    mutationFn: () => api.post(`/crm/leads/${leadId}/hold`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Lead put on hold');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to put on hold'),
  });

  if (isLoading) {
    return <div className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  if (!lead) {
    return <div className="p-8 text-center text-gray-500">Lead not found</div>;
  }

  const currentStageIndex = PIPELINE_STAGES.indexOf(lead.stage);
  const displayName = lead.companyName || lead.contactName || lead.client?.company || lead.client?.name || 'Lead';
  const website = lead.website || lead.client?.website;
  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(', ') || lead.client?.city;

  // Helper to format field labels nicely
  const getFieldLabel = (key: string) => {
    for (const fields of Object.values(STAGE_FIELDS)) {
      const f = fields.find(f => f.key === key);
      if (f) return f.label;
    }
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  };

  return (
    <div className="bg-gray-50/50 min-h-full">

      {/* Header */}
      <div className="bg-white border-b border-border px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <button onClick={() => router.push('/pipeline')} className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Pipeline
          </button>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {lead.stage !== 'NEW_LEAD' && (
              <button
                onClick={() => {
                  const params = new URLSearchParams({ create: 'true' });
                  params.set('prefillName', `${displayName} Project`);
                  const clientId = lead.clientId || lead.client?.id;
                  if (clientId) params.set('prefillClientId', clientId);
                  if (lead.dealValue) params.set('prefillBudget', String(lead.dealValue));
                  if (lead.assignedToId) params.set('prefillOwnerId', lead.assignedToId);
                  router.push(`/projects?${params.toString()}`);
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-[#1F2937] transition-colors"
              >
                <FolderPlus className="w-4 h-4" /> Create Project
              </button>
            )}
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#4B5563] bg-white border border-border rounded-lg hover:bg-[#F9FAFB] transition-colors"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={async () => {
                const isConfirmed = await confirm({
                  title: 'Delete Lead',
                  message: 'This permanently deletes the lead. This action cannot be undone.',
                  confirmText: 'Delete Lead',
                  cancelText: 'Cancel',
                  variant: 'danger',
                  requireText: lead.stage === 'NEW_LEAD' ? undefined : displayName,
                });
                if (isConfirmed) {
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
        
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-5">
          {/* Identity */}
          <div className="flex items-start gap-4 min-w-0">
            <div className={`h-14 w-14 shrink-0 rounded-2xl flex items-center justify-center text-lg font-bold ${getAvatarColor(displayName)}`}>
              {getInitials(displayName)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-primary truncate">{displayName}</h1>
                <span className="px-2.5 py-0.5 rounded-md bg-[#F3F4F6] text-primary text-xs font-medium border border-border">
                  {lead.stage.replace(/_/g, ' ')}
                </span>
                {lead.client?.status === 'ONHOLD' && (
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">On Hold</span>
                )}
              </div>
              {lead.leadId && (
                <p className="mt-1 text-xs font-mono font-medium text-secondary tracking-wide">{lead.leadId}</p>
              )}
              <div className="flex items-center gap-x-5 gap-y-1.5 mt-3 text-sm text-[#4B5563] flex-wrap">
                <span className="flex items-center gap-1.5"><User className="w-4 h-4 text-[#9CA3AF]" /> {lead.contactName || lead.client?.name || '—'}</span>
                {(lead.contactEmail || lead.client?.email) && <a href={`mailto:${lead.contactEmail || lead.client?.email}`} className="flex items-center gap-1.5 hover:text-primary transition-colors"><Mail className="w-4 h-4 text-[#9CA3AF]" /> {lead.contactEmail || lead.client?.email}</a>}
                {(lead.contactPhone || lead.client?.phone) && <a href={`tel:${lead.contactPhone || lead.client?.phone}`} className="flex items-center gap-1.5 hover:text-primary transition-colors"><Phone className="w-4 h-4 text-[#9CA3AF]" /> {lead.contactPhone || lead.client?.phone}</a>}
                {location && <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#9CA3AF]" /> {location}</span>}
              </div>
            </div>
          </div>

          {/* Deal value + actions */}
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-4 shrink-0 w-full lg:w-auto mt-4 lg:mt-0">
            <div className="sm:text-right sm:pr-4 sm:border-r border-border flex flex-col justify-center">
              <p className="text-xs font-medium text-secondary uppercase tracking-wider">Deal Value</p>
              <p className="text-2xl font-bold text-primary">{lead.dealValue ? formatCurrency(lead.dealValue) : '—'}</p>
            </div>
            <div className="flex flex-col gap-2 w-full sm:w-52">
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
              {lead.client?.status !== 'ONHOLD' && !['PROJECT_COMPLETED', 'CHURNED'].includes(lead.stage) && (
                <button
                  onClick={() => holdMutation.mutate()}
                  disabled={holdMutation.isPending}
                  className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  {holdMutation.isPending ? 'Putting on hold…' : 'Put on hold'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stepper Component */}
        <div className="mt-8 flex items-center justify-between overflow-x-auto pb-4 scrollbar-hide">
          {PIPELINE_STAGES.slice(0, 8).map((stage, idx) => {
            const isCompleted = PIPELINE_STAGES.indexOf(lead.stage) >= idx;
            const isCurrent = lead.stage === stage;
            return (
              <div key={stage} className="flex flex-col items-center gap-2 relative min-w-25">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold z-10 transition-colors border ${isCurrent ? 'bg-primary text-white border-primary' : isCompleted ? 'bg-[#F3F4F6] text-primary border-border' : 'bg-white text-[#9CA3AF] border-border'}`}>
                  {idx + 1}
                </div>
                <span className={`text-xs font-medium text-center ${isCurrent ? 'text-primary' : isCompleted ? 'text-[#4B5563]' : 'text-[#9CA3AF]'}`}>
                  {stage.replace(/_/g, ' ')}
                </span>
                {idx < 7 && (
                  <div className={`absolute top-4 left-1/2 w-full h-0.5 z-0 ${isCompleted && !isCurrent ? 'bg-primary' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Follow-up banner (Module F) — shows when followUpDate is today or past */}
      {(() => {
        if (!lead.followUpDate) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const fud = new Date(lead.followUpDate); fud.setHours(0, 0, 0, 0);
        if (fud > today) return null;
        const overdue = fud < today;
        return (
          <div className={`px-8 py-2.5 text-sm font-medium flex items-center gap-2 ${overdue ? 'bg-red-50 text-red-700 border-b border-red-100' : 'bg-amber-50 text-amber-800 border-b border-amber-100'}`}>
            <Clock className="w-4 h-4 shrink-0" /> Follow-up {overdue ? 'overdue since' : 'due'} {format(new Date(lead.followUpDate), 'PP')}. Update the follow-up date to clear this.
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="flex gap-6 border-b border-border bg-white overflow-x-auto whitespace-nowrap custom-scrollbar px-8">
        <div className="max-w-7xl mx-auto flex gap-1 w-full">
          {([['details', 'Details'], ['timeline', 'Timeline'], ['contacts', 'Contacts']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setActiveTab(k)} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === k ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'details' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-border p-6">
              <h2 className="text-base font-semibold text-primary mb-5 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-secondary" /> Lead Details
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                <Detail label="Company" value={lead.companyName || lead.client?.company} />
                <Detail label="Company Size" value={lead.companySize} />
                <Detail label="Industry" value={lead.industry || lead.client?.industry} />
                <Detail label="Website">
                  {website ? (
                    <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1.5 truncate">
                      <Globe className="w-3.5 h-3.5 shrink-0 text-[#9CA3AF]" /> <span className="truncate">{website}</span>
                    </a>
                  ) : <p className="text-sm text-[#9CA3AF]">—</p>}
                </Detail>
                <Detail label="Location" value={location} />
                <Detail label="Source" value={lead.source?.replace(/_/g, ' ')} />
                <Detail label="Assigned To">
                  <div className="flex items-center gap-2">
                    {lead.assignedTo?.avatar ? (
                      <img src={lead.assignedTo.avatar} alt="" className="w-6 h-6 rounded-full" />
                    ) : (
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${lead.assignedTo ? getAvatarColor(lead.assignedTo.name) : 'bg-[#F3F4F6] text-[#9CA3AF] border border-border'}`}>
                        {lead.assignedTo ? getInitials(lead.assignedTo.name) : '?'}
                      </div>
                    )}
                    <span className="text-sm font-medium text-primary truncate">{lead.assignedTo?.name || 'Unassigned'}</span>
                  </div>
                </Detail>
                <Detail label="Expected Close">
                  <p className="text-sm text-primary flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#9CA3AF]" />
                    {lead.expectedCloseDate ? format(new Date(lead.expectedCloseDate), 'PP') : '—'}
                  </p>
                </Detail>
                <Detail label="Created" value={lead.createdAt ? format(new Date(lead.createdAt), 'PP') : null} />
              </div>
            </div>

            {/* LinkedIn Intelligence (Module A) — only renders when a LinkedIn URL is present */}
            <IntelligenceTab
              leadId={leadId}
              linkedinUrl={lead.linkedinUrl}
              dossier={lead.dossierJson}
              onRefetch={() => queryClient.invalidateQueries({ queryKey: ['lead', leadId] })}
            />

            {/* Dynamic Deal Fields Rendering */}
            {lead.dealFields && lead.dealFields.length > 0 && (
              <div className="bg-white rounded-2xl border border-border p-6">
                <h2 className="text-base font-semibold text-primary mb-5 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-secondary" /> Stage Data
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {lead.dealFields.map((field: any) => (
                    <div key={field.id} className="bg-gray-50/70 p-3 rounded-xl border border-gray-100">
                      <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1.5">{getFieldLabel(field.fieldKey)}</p>
                      <p className="text-sm text-primary font-medium wrap-break-word">{field.fieldValue || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {activeTab === 'timeline' && (
            <div className="max-w-4xl"><TimelineTab leadId={leadId} /></div>
          )}

          {activeTab === 'contacts' && (
            <div className="max-w-4xl"><ContactsTab leadId={leadId} lead={lead} /></div>
          )}
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
        {wonModalLead && (
          <WonCelebrationModal lead={wonModalLead} onClose={() => setWonModalLead(null)} />
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

// A compact label / value pair for the details grid.
function Detail({ label, value, children }: { label: string; value?: string | null; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider mb-1">{label}</p>
      {children ?? <p className="text-sm text-primary truncate">{value || '—'}</p>}
    </div>
  );
}
