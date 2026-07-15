'use client';

import { useState, use, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, Building2, User, Phone, Mail, Calendar, MapPin, Tag, Clock, Globe, Pencil, Trash2, FolderPlus, Briefcase, Receipt, StickyNote, History } from 'lucide-react';
import { api } from '@/lib/api';
import { getInitials, getAvatarColor, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { STAGE_FIELDS } from '../lib/stage-config';
import { StageTransitionModal } from '../components/StageTransitionModal';
import { WonCelebrationModal } from '../components/WonCelebrationModal';
import { EditLeadModal } from '../components/EditLeadModal';
import { PipelineDetailsModal } from '../components/PipelineDetailsModal';
import { Select } from '@/components/ui/select';
import { IntelligenceTab } from '../components/IntelligenceTab';
import { TimelineTab } from '../components/TimelineTab';
import { ContactsTab } from '../components/ContactsTab';
import { OverflowMarquee } from '@/components/ui/overflow-marquee';
import { useConfirmStore } from '@/stores';

function SocialLink({ platform, input }: { platform: 'linkedin' | 'instagram' | 'facebook', input?: string | null }) {
  if (!input) return <span className="text-sm font-medium text-gray-400">—</span>;

  let cleanInput = input.trim();
  let handle = cleanInput;

  try {
    if (cleanInput.startsWith('http') || cleanInput.includes('.com/')) {
      const urlString = cleanInput.startsWith('http') ? cleanInput : `https://${cleanInput}`;
      const url = new URL(urlString);
      const parts = url.pathname.replace(/\/$/, '').split('/');
      handle = parts[parts.length - 1];
    }
  } catch (e) { }

  handle = handle.replace(/^@/, '');

  let href = '';
  let display = '';

  if (platform === 'linkedin') {
    href = `https://www.linkedin.com/in/${handle}`;
    display = `in/${handle}`;
  } else if (platform === 'instagram') {
    href = `https://www.instagram.com/${handle}`;
    display = `@${handle}`;
  } else if (platform === 'facebook') {
    href = `https://www.facebook.com/${handle}`;
    display = `@${handle}`;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 transition-colors"
    >
      {display}
    </a>
  );
}

const PIPELINE_STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'CONTRACT', 'PROJECT_COMPLETED', 'CHURNED'
];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetStage, setTargetStage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPipelineDetailsModalOpen, setIsPipelineDetailsModalOpen] = useState(false);
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

  const handleDelete = async () => {
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
  };

  return (
    <div className="bg-gray-50/50 min-h-full">

      {/* Top Banner / Actions */}
      <div className="bg-white border-b border-border px-5 py-6 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <Link href="/pipeline" className="flex items-center gap-2 text-sm font-medium text-secondary hover:text-primary transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to Pipeline
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
                  className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-[#1F2937] transition-colors"
                >
                  <FolderPlus className="w-4 h-4" /> <span className="hidden sm:inline">Create Project</span>
                </button>
              )}
              <button
                onClick={() => setIsPipelineDetailsModalOpen(true)}
                className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-[#4B5563] bg-white border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Tag className="w-4 h-4" /> <span className="hidden sm:inline">Stage Data</span>
              </button>
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-[#4B5563] bg-white border border-border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">{deleteMutation.isPending ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mt-2">
            {/* Avatar & Identity */}
            <div className="flex items-start gap-4 md:gap-5 min-w-0">
              <div className={`w-16 h-16 shrink-0 rounded-2xl flex items-center justify-center text-2xl font-bold border ${getAvatarColor(displayName)}`}>
                {getInitials(displayName)}
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                  <OverflowMarquee className="w-full sm:w-auto sm:max-w-md">
                    <h1 className="text-2xl font-bold text-primary leading-none truncate">{displayName}</h1>
                  </OverflowMarquee>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 text-[10px] font-bold tracking-wider uppercase border border-purple-200 whitespace-nowrap">
                      {lead.stage.replace(/_/g, ' ')}
                    </span>
                    {lead.client?.status === 'ONHOLD' && (
                      <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold tracking-wider uppercase border border-amber-200 whitespace-nowrap">
                        On Hold
                      </span>
                    )}
                    {lead.priority && (
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase border whitespace-nowrap ${lead.priority === 'HIGH' ? 'bg-red-50 text-red-700 border-red-200' : lead.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                        {lead.priority} Priority
                      </span>
                    )}
                  </div>
                </div>
                {lead.leadId && (
                  <p className="text-sm font-medium text-secondary/80 font-mono">{lead.leadId}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 sm:gap-5 mt-1.5">
                  {lead.contactName && (
                    <span className="flex items-center gap-1.5 text-sm text-secondary font-medium">
                      <User className="w-4 h-4 text-gray-400" /> {lead.contactName}
                    </span>
                  )}
                  {(lead.contactEmail || lead.client?.email) && (
                    <a href={`mailto:${lead.contactEmail || lead.client?.email}`} className="flex items-center gap-1.5 text-sm text-secondary font-medium hover:text-primary transition-colors">
                      <Mail className="w-4 h-4 text-gray-400" /> {lead.contactEmail || lead.client?.email}
                    </a>
                  )}
                  {(lead.contactPhone || lead.client?.phone) && (
                    <a href={`tel:${lead.contactPhone || lead.client?.phone}`} className="flex items-center gap-1.5 text-sm text-secondary font-medium hover:text-primary transition-colors">
                      <Phone className="w-4 h-4 text-gray-400" /> {lead.contactPhone || lead.client?.phone}
                    </a>
                  )}
                  {location && (
                    <span className="flex items-center gap-1.5 text-sm text-secondary font-medium">
                      <MapPin className="w-4 h-4 text-gray-400" /> {location}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Deal Value */}
            <div className="flex flex-col sm:flex-row sm:items-center lg:items-stretch gap-4 sm:gap-6 bg-gray-50/80 p-4 rounded-xl border border-border shrink-0 w-full lg:w-auto">
              <div className="flex flex-col sm:items-end justify-center">
                <span className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">Deal Value</span>
                <span className="text-2xl font-bold text-primary leading-none">{lead.dealValue ? formatCurrency(lead.dealValue) : '—'}</span>
              </div>
              <div className="w-px bg-border hidden sm:block"></div>
              <div className="flex flex-col sm:items-end justify-center">
                <span className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">Next Follow-up Date</span>
                <span className="text-sm font-bold text-primary leading-none">
                  {lead.followUpDate ? format(new Date(lead.followUpDate), 'PP') : '—'}
                </span>
              </div>
              <div className="w-px bg-border hidden sm:block"></div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-2">Stage Action</span>
                <div className="flex items-center gap-2">
                  <Select
                    value={lead.stage}
                    onChange={(val) => {
                      if (val && val !== lead.stage) {
                        setTargetStage(val);
                        setIsModalOpen(true);
                      }
                    }}
                    options={PIPELINE_STAGES.map(s => ({
                      label: `${PIPELINE_STAGES.indexOf(s) + 1}. ${s.replace(/_/g, ' ')}`,
                      value: s
                    }))}
                    className="w-40 sm:w-48 text-sm"
                  />
                  {lead.client?.status !== 'ONHOLD' && !['PROJECT_COMPLETED', 'CHURNED'].includes(lead.stage) && (
                    <button onClick={() => holdMutation.mutate()} disabled={holdMutation.isPending} className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap">
                      Hold
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stepper Component (Refined) */}
          <div className="mt-2 flex items-center justify-between overflow-x-auto scrollbar-hide py-2">
            {PIPELINE_STAGES.slice(0, 8).map((stage, idx) => {
              const isCompleted = PIPELINE_STAGES.indexOf(lead.stage) >= idx;
              const isCurrent = lead.stage === stage;
              return (
                <div key={stage} className="flex flex-col items-center gap-2.5 relative min-w-[120px] shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold z-10 transition-colors ${isCurrent ? 'bg-primary text-white ring-4 ring-primary/10' : isCompleted ? 'bg-blue-50 text-blue-600 ring-4 ring-white' : 'bg-gray-50 text-gray-400 ring-4 ring-white border border-border'}`}>
                    {idx + 1}
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider text-center ${isCurrent ? 'text-primary' : isCompleted ? 'text-secondary' : 'text-gray-400'}`}>
                    {stage.replace(/_/g, ' ')}
                  </span>
                  {idx < 7 && (
                    <div className={`absolute top-3.5 left-1/2 w-full h-[2px] z-0 ${isCompleted && !isCurrent ? 'bg-blue-100' : 'bg-gray-100'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Follow-up banner */}
      {(() => {
        if (!lead.followUpDate) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const fud = new Date(lead.followUpDate); fud.setHours(0, 0, 0, 0);
        if (fud > today) return null;
        const overdue = fud < today;
        return (
          <div className={`px-5 md:px-8 py-3 text-sm font-medium flex items-center gap-2 ${overdue ? 'bg-red-50 text-red-700 border-b border-red-100' : 'bg-amber-50 text-amber-800 border-b border-amber-100'}`}>
            <Clock className="w-4 h-4 shrink-0" /> Follow-up {overdue ? 'overdue since' : 'due'} {format(new Date(lead.followUpDate), 'PP')}. Update the follow-up date to clear this.
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="border-b border-border bg-white px-5 md:px-8 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex gap-8 overflow-x-auto scrollbar-hide">
          {([['details', 'Details'], ['timeline', 'Timeline'], ['contacts', 'Contacts']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setActiveTab(k)} className={`py-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${activeTab === k ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 md:p-8">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'details' && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col lg:flex-row gap-6 items-start">

                {/* LEFT COLUMN */}
                <div className="w-full lg:w-7/12 flex flex-col gap-6">

                  {/* Lead Details Card */}
                  <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                    <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                      <Building2 className="w-4 h-4" /> Lead Details
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                      <Detail label="Company Name" value={lead.companyName || lead.client?.company} />
                      <Detail label="Industry" value={lead.industry || lead.client?.industry} />
                      <Detail label="Company Size" value={lead.companySize} />
                      <Detail label="Website">
                        {website ? (
                          <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline flex items-center gap-1.5 truncate">
                            <Globe className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{website}</span>
                          </a>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </Detail>
                      <Detail label="Source" value={lead.source?.replace(/_/g, ' ')} />
                      <Detail label="Assigned User">
                        <div className="flex items-center gap-2">
                          {lead.assignedTo?.avatar ? (
                            <img src={lead.assignedTo.avatar} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${lead.assignedTo ? getAvatarColor(lead.assignedTo.name) : 'bg-gray-100 text-gray-400'}`}>
                              {lead.assignedTo ? getInitials(lead.assignedTo.name) : '?'}
                            </div>
                          )}
                          <span className="text-sm font-medium text-primary">{lead.assignedTo?.name || 'Unassigned'}</span>
                        </div>
                      </Detail>
                      <Detail label="Expected Close">
                        <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          {lead.expectedCloseDate ? format(new Date(lead.expectedCloseDate), 'PP') : '—'}
                        </p>
                      </Detail>
                      <Detail label="Next Follow-up Date">
                        <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          {lead.followUpDate ? format(new Date(lead.followUpDate), 'PP') : '—'}
                        </p>
                      </Detail>
                      <Detail label="Last Contacted Date">
                        <p className="text-sm font-medium text-primary flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          {lead.lastContactedDate ? format(new Date(lead.lastContactedDate), 'PP') : '—'}
                        </p>
                      </Detail>
                      <Detail label="Created" value={lead.createdAt ? format(new Date(lead.createdAt), 'PP') : null} />
                    </div>
                  </div>

                  {/* Company Information Card */}
                  {(lead.billingAddress || lead.gstNumber || location) && (
                    <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                      <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                        <Receipt className="w-4 h-4" /> Company Information
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4">
                        <Detail label="Billing Address" value={lead.billingAddress} />
                        <Detail label="GST Number" value={lead.gstNumber} />
                        <Detail label="Location" value={location} />
                      </div>
                    </div>
                  )}

                  {/* Social Presence Card */}
                  <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                    <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                      <Globe className="w-4 h-4" /> Social Presence
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-6 gap-x-4">
                      <Detail label="LinkedIn">
                        <div className="flex flex-col gap-1">
                          <SocialLink platform="linkedin" input={lead.linkedinUrl} />
                          <div className="flex items-center gap-1.5 mt-1">
                            <Globe className={`w-3.5 h-3.5 ${lead.linkedinChecked ? 'text-blue-600' : 'text-gray-300'}`} />
                            <span className="text-[10px] text-secondary font-medium uppercase tracking-wider">{lead.linkedinChecked ? (lead.linkedinFound ? 'Found' : 'Not Found') : 'Not Checked'}</span>
                          </div>
                        </div>
                      </Detail>
                      <Detail label="Instagram">
                        <SocialLink platform="instagram" input={lead.instagramHandle} />
                      </Detail>
                      <Detail label="Facebook">
                        <SocialLink platform="facebook" input={lead.facebookPage} />
                      </Detail>
                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN */}
                <div className="w-full lg:w-5/12 flex flex-col gap-6">

                  {/* Deal Summary Card */}
                  <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                    <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                      <Briefcase className="w-4 h-4" /> Deal Summary
                    </h2>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                        <span className="text-sm text-secondary font-medium">Deal Value</span>
                        <span className="text-sm font-bold text-primary">{lead.dealValue ? formatCurrency(lead.dealValue) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                        <span className="text-sm text-secondary font-medium">Expected Revenue</span>
                        <span className="text-sm font-bold text-primary">{lead.expectedRevenue ? formatCurrency(lead.expectedRevenue) : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                        <span className="text-sm text-secondary font-medium">Current Stage</span>
                        <span className="text-sm font-bold text-primary">{lead.stage.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                        <span className="text-sm text-secondary font-medium">Expected Close</span>
                        <span className="text-sm font-bold text-primary">{lead.expectedCloseDate ? format(new Date(lead.expectedCloseDate), 'PP') : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between py-2.5">
                        <span className="text-sm text-secondary font-medium">Priority</span>
                        {lead.priority ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase border ${lead.priority === 'HIGH' ? 'bg-red-50 text-red-700 border-red-200' : lead.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                            {lead.priority}
                          </span>
                        ) : <span className="text-sm font-bold text-primary">—</span>}
                      </div>
                    </div>
                  </div>

                  {/* Pipeline History Card */}
                  {lead.stageHistory && lead.stageHistory.length > 0 && (
                    <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                      <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                        <History className="w-4 h-4" /> Pipeline History
                      </h2>
                      <div className="relative border-l-2 border-gray-100 ml-2 space-y-6">
                        {lead.stageHistory.map((history: any, index: number) => (
                          <div key={history.id || index} className="relative pl-5">
                            <div className="absolute left-[-9px] top-1.5 w-4 h-4 rounded-full bg-blue-50 border-2 border-blue-500 ring-2 ring-white"></div>
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-primary">{history.toStage.replace(/_/g, ' ')}</span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] font-medium text-secondary">{format(new Date(history.changedAt), 'PPp')}</span>
                                <span className="text-[11px] text-gray-300">•</span>
                                <span className="text-[11px] font-medium text-secondary">by {history.changedBy?.name || 'System'}</span>
                              </div>
                              {history.notes && (
                                <p className="mt-2.5 text-sm text-[#4B5563] bg-gray-50/80 p-3 rounded-lg border border-gray-100 whitespace-pre-wrap leading-relaxed">{history.notes}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes Card */}
                  {lead.notes && lead.notes.length > 0 && (
                    <div className="bg-white rounded-2xl border border-border p-6 shadow-sm max-h-[500px] overflow-y-auto">
                      <h2 className="text-xs font-bold text-secondary flex items-center gap-2 mb-6 uppercase tracking-wider">
                        <StickyNote className="w-4 h-4" /> Notes
                      </h2>
                      <div className="flex flex-col gap-4">
                        {lead.notes.map((note: any) => (
                          <div key={note.id} className="bg-amber-50/50 p-4 rounded-xl border border-amber-100/50 relative">
                            <div className="flex items-center gap-2 mb-3">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${note.author ? getAvatarColor(note.author.name) : 'bg-gray-100 text-gray-400'}`}>
                                {note.author ? getInitials(note.author.name) : 'S'}
                              </div>
                              <span className="text-xs font-bold text-primary">{note.author?.name || 'System'}</span>
                              <span className="text-[10px] text-secondary font-medium ml-auto">{format(new Date(note.createdAt), 'MMM d, yyyy')}</span>
                            </div>
                            <p className="text-sm text-primary whitespace-pre-wrap leading-relaxed">{note.body || note.content || '—'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* FULL WIDTH SECTION */}
              <div className="flex flex-col gap-6">
                {/* Intelligence Tab */}
                <IntelligenceTab
                  leadId={leadId}
                  linkedinUrl={lead.linkedinUrl}
                  dossier={lead.dossierJson}
                  onRefetch={() => queryClient.invalidateQueries({ queryKey: ['lead', leadId] })}
                />

                {/* Dynamic Deal Fields Rendering */}
                {lead.dealFields && lead.dealFields.length > 0 && (
                  <div className="bg-white rounded-2xl border border-border p-6 shadow-sm">
                    <h2 className="text-xs font-bold text-secondary mb-6 flex items-center gap-2 uppercase tracking-wider">
                      <Tag className="w-4 h-4" /> Stage Data
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {lead.dealFields.map((field: any) => (
                        <div key={field.id} className="bg-gray-50/80 p-4 rounded-xl border border-gray-100">
                          <p className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1.5">{getFieldLabel(field.fieldKey)}</p>
                          <p className="text-sm text-primary font-medium">{field.fieldValue || '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="max-w-7xl">
              <TimelineTab leadId={leadId} />
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="w-full">
              <ContactsTab leadId={leadId} lead={lead} />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {isModalOpen && (
          <StageTransitionModal
            lead={lead}
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

      <AnimatePresence>
        {isPipelineDetailsModalOpen && (
          <PipelineDetailsModal
            lead={lead}
            onClose={() => setIsPipelineDetailsModalOpen(false)}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
              queryClient.invalidateQueries({ queryKey: ['leads'] });
              setIsPipelineDetailsModalOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ label, value, children }: { label: string; value?: string | null; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-secondary uppercase tracking-wider mb-1.5">{label}</p>
      {children ?? <p className="text-sm font-medium text-primary truncate">{value || '—'}</p>}
    </div>
  );
}
