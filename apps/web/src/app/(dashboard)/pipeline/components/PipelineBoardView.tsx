'use client';

import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { StageTransitionModal } from './StageTransitionModal';
import { WonCelebrationModal } from './WonCelebrationModal';

// All 15 pipeline stages in chronological order (used by the per-card stage menu)
const PIPELINE_STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED',
];

const GROUPS = [
  { id: 'New', title: 'New', color: '#7c3aed', stages: ['NEW_LEAD'] },
  { id: 'Outreach', title: 'Outreach', color: '#0891b2', stages: ['OUTREACH'] },
  { id: 'Meeting', title: 'Meeting', color: '#d97706', stages: ['MEETING'] },
  { id: 'Proposal', title: 'Proposal', color: '#2563eb', stages: ['PROPOSAL'] },
  { id: 'Negotiation', title: 'Negotiation', color: '#0369a1', stages: ['NEGOTIATION'] },
  { id: 'Closing', title: 'Closing', color: '#15803d', stages: ['CONTRACT'] },
  { id: 'Active', title: 'Active', color: '#0f766e', stages: ['ACTIVE_RETAINER', 'ACTIVE_PROJECT'] },
  { id: 'Closed', title: 'Closed', color: '#475569', stages: ['PROJECT_COMPLETED', 'CHURNED'] },
];

const STAGE_BADGES: Record<string, { label: string, bg: string, text: string }> = {
  'NEW_LEAD': { label: 'NEW', bg: '#7c3aed', text: '#ffffff' },
  'OUTREACH': { label: 'OUTREACH', bg: '#0891b2', text: '#ffffff' },
  'MEETING': { label: 'MEETING', bg: '#d97706', text: '#ffffff' },
  'PROPOSAL': { label: 'PROPOSAL', bg: '#2563eb', text: '#ffffff' },
  'NEGOTIATION': { label: 'NEGOTIATION', bg: '#0369a1', text: '#ffffff' },
  'CONTRACT': { label: 'CONTRACT', bg: '#15803d', text: '#ffffff' },
  'ACTIVE_RETAINER': { label: 'RETAINER', bg: '#0f766e', text: '#ffffff' },
  'ACTIVE_PROJECT': { label: 'PROJECT', bg: '#1d4ed8', text: '#ffffff' },
  'PROJECT_COMPLETED': { label: 'COMPLETED', bg: '#166534', text: '#ffffff' },
  'CHURNED': { label: 'CHURNED', bg: '#dc2626', text: '#ffffff' },
};

export function PipelineBoardView() {
  const router = useRouter();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  // Lead pending a stage transition (drag target or menu pick). When set, the StageTransitionModal opens.
  const [pendingTransition, setPendingTransition] = useState<{ lead: any; targetStage: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-card stage menu: anchored dropdown to pick an exact stage (e.g. LEAD -> MQL within a group).
  const [stageMenu, setStageMenu] = useState<{ lead: any; x: number; y: number; up: boolean } | null>(null);
  // Won celebration modal + Won/Lost column visibility.
  const [wonModalLead, setWonModalLead] = useState<any>(null);
  const [showWonLost, setShowWonLost] = useState(false);

  const openStageMenu = (e: React.MouseEvent, lead: any) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const up = rect.bottom + 340 > window.innerHeight;
    setStageMenu({ lead, x: rect.right, y: up ? rect.top : rect.bottom, up });
  };

  useEffect(() => {
    setIsMounted(true);
    fetchLeads();
    
    const sse = getSSE();
    if (sse) {
      sse.on('lead:updated', fetchLeads);
      return () => { sse.off('lead:updated', fetchLeads); };
    }
  }, []);

  async function fetchLeads() {
    try {
      const data = await api.get<any[]>('/crm/leads');
      setLeads(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Group leads into the 7 visual columns
  const columns = useMemo(() => {
    const cols: Record<string, any[]> = {};
    GROUPS.forEach(g => cols[g.id] = []);
    
    leads.forEach(lead => {
      const group = GROUPS.find(g => g.stages.includes(lead.stage));
      if (group) {
        cols[group.id].push(lead);
      }
    });

    // Sort each column by contract value descending
    Object.keys(cols).forEach(colId => {
      cols[colId].sort((a, b) => {
        const valA = a.dealValue || 0;
        const valB = b.dealValue || 0;
        return valB - valA;
      });
    });

    return cols;
  }, [leads]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId) return; // Didn't change column

    const lead = leads.find(l => l.id === draggableId);
    if (!lead) return;

    const destGroup = GROUPS.find(g => g.id === destination.droppableId);
    if (!destGroup) return;

    const newStage = destGroup.stages[0]; // Default to first chronological stage in target group
    if (newStage === lead.stage) return;

    // Open the same stage-transition form used on the lead detail page so the
    // user can capture stage-specific details before the move is committed.
    // The card stays in its original column until the form is confirmed.
    setPendingTransition({ lead, targetStage: newStage });
  };

  async function submitStageTransition(payload: any) {
    if (!pendingTransition) return;
    const lead = pendingTransition.lead;
    setIsSubmitting(true);
    try {
      await api.post(`/crm/leads/${lead.id}/stage`, payload);
      toast.success('Stage updated successfully');
      setPendingTransition(null);
      if (payload?.stage === 'CONTRACT') setWonModalLead(lead);
      fetchLeads();
    } catch (err: any) {
      // Re-throw so the modal can surface the error and stay open.
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  // Hide Won/Lost columns by default; the "Show Won/Lost" toggle reveals them.
  const visibleGroups = showWonLost ? GROUPS : GROUPS.filter(g => g.id !== 'Won' && g.id !== 'Lost');

  if (!isMounted || loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-hidden flex flex-col">

      <div className="flex items-center justify-end px-1 pb-2 shrink-0">
        <label className="flex items-center gap-2 text-xs font-medium text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showWonLost}
            onChange={(e) => setShowWonLost(e.target.checked)}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          Show Won/Lost
        </label>
      </div>

      <div className="flex flex-1 w-full overflow-x-auto overflow-y-hidden gap-4 pb-4 px-1 custom-scrollbar">
        <DragDropContext onDragEnd={handleDragEnd}>
          {visibleGroups.map((group) => {
            const columnLeads = columns[group.id] || [];
            
            return (
              <div key={group.id} className="flex flex-col min-w-[280px] w-[280px] h-full shrink-0">
                {/* Column Header */}
                <div 
                  className="px-4 py-3 rounded-t-xl flex items-center justify-between"
                  style={{ backgroundColor: group.color }}
                >
                  <h3 className="text-sm font-semibold text-white tracking-wide">{group.title}</h3>
                  <div className="bg-white/25 px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-sm backdrop-blur-sm">
                    {columnLeads.length}
                  </div>
                </div>

                {/* Droppable Area */}
                <Droppable droppableId={group.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 bg-gray-50/80 border-x border-b border-gray-200 rounded-b-xl p-3 overflow-y-auto space-y-3 transition-colors ${
                        snapshot.isDraggingOver ? 'bg-gray-100' : ''
                      }`}
                    >
                      {columnLeads.map((lead, index) => {
                        const badgeInfo = STAGE_BADGES[lead.stage] || { label: lead.stage, bg: '#ccc', text: '#000' };

                        return (
                          <Draggable key={lead.id} draggableId={lead.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => router.push(`/pipeline/${lead.id}`)}
                                className={`bg-white rounded-xl p-4 border border-gray-200 cursor-pointer group ${
                                  snapshot.isDragging ? 'shadow-2xl shadow-black/10 scale-105 z-50 ring-2 ring-primary' : 'shadow-sm hover:shadow-md hover:border-gray-300'
                                } transition-all relative`}
                              >
                                {/* Stage Badge */}
                                <div 
                                  className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full z-10"
                                  style={{ backgroundColor: badgeInfo.bg, color: badgeInfo.text }}
                                >
                                  {badgeInfo.label}
                                </div>

                                {/* Content */}
                                <div className="pr-16">
                                  <h4 className="text-[15px] font-bold text-primary truncate">
                                    {lead.contactName || lead.companyName || lead.client?.name || 'Unknown'}
                                  </h4>
                                </div>
                                <div className="mt-1">
                                  <p className="text-sm font-medium text-secondary truncate">
                                    {lead.companyName || lead.client?.company || lead.contactEmail || ''}
                                  </p>
                                  {(lead.jobTitle || lead.client?.company) && (
                                    <p className="text-[11px] text-gray-400 truncate mt-0.5">
                                      {lead.jobTitle || lead.client?.company}
                                    </p>
                                  )}
                                </div>

                                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                                  <p className="text-sm font-bold text-primary">
                                    {lead.dealValue ? `${formatCurrency(lead.dealValue)}` : 'TBD'}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={(e) => openStageMenu(e, lead)}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-secondary bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:text-primary transition-colors"
                                  >
                                    Stage <ChevronDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </DragDropContext>
      </div>

      {/* Per-card stage menu — pick any exact stage, including within the same group (LEAD -> MQL) */}
      {stageMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setStageMenu(null)} />
          <div
            className="fixed z-[61] w-56 max-h-80 overflow-y-auto bg-white rounded-xl shadow-2xl border border-border py-1"
            style={{
              top: stageMenu.up ? stageMenu.y - 6 : stageMenu.y + 6,
              left: stageMenu.x,
              transform: stageMenu.up ? 'translate(-100%, -100%)' : 'translateX(-100%)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 py-2 text-[11px] font-semibold text-secondary uppercase tracking-wider">Move to stage</p>
            {PIPELINE_STAGES.map((stage, idx) => {
              const isCurrent = stage === stageMenu.lead.stage;
              return (
                <button
                  key={stage}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => {
                    setPendingTransition({ lead: stageMenu.lead, targetStage: stage });
                    setStageMenu(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    isCurrent ? 'text-gray-300 cursor-default bg-gray-50/50' : 'text-primary hover:bg-gray-50'
                  }`}
                >
                  <span><span className="text-gray-400">{idx + 1}.</span> {stage.replace('_', ' ')}</span>
                  {isCurrent && <Check className="w-4 h-4 text-gray-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Stage Transition Modal — same form used on the lead detail page */}
      <AnimatePresence>
        {pendingTransition && (
          <StageTransitionModal
            currentStage={pendingTransition.lead.stage}
            targetStage={pendingTransition.targetStage}
            onClose={() => setPendingTransition(null)}
            onSubmit={submitStageTransition}
            isLoading={isSubmitting}
          />
        )}
      </AnimatePresence>

      {/* Won celebration after a lead is moved to CONTRACT (deal signed) */}
      <AnimatePresence>
        {wonModalLead && (
          <WonCelebrationModal lead={wonModalLead} onClose={() => setWonModalLead(null)} />
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          height: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 20px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
      `}</style>
    </div>
  );
}
