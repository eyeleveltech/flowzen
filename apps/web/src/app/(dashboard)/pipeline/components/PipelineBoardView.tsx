'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Plus, ChevronsLeft, ChevronsRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { StageTransitionModal } from './StageTransitionModal';
import { WonCelebrationModal } from './WonCelebrationModal';
import { useQueryClient } from '@tanstack/react-query';
import { LeadModal } from './LeadModal';

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
  { id: 'Closed', title: 'Closed', color: '#475569', stages: ['PROJECT_COMPLETED'] },
  { id: 'Lost', title: 'Lost', color: '#dc2626', stages: ['CHURNED'] },
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
  const queryClient = useQueryClient();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  // Lead pending a stage transition (drag target or menu pick). When set, the StageTransitionModal opens.
  const [pendingTransition, setPendingTransition] = useState<{ lead: any; targetStage: string; previousLeads?: any[] } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-card stage menu: anchored dropdown to pick an exact stage (e.g. LEAD -> MQL within a group).
  const [stageMenu, setStageMenu] = useState<{ lead: any; x: number; y: number; up: boolean } | null>(null);
  // Won celebration modal + Won/Lost column visibility.
  const [wonModalLead, setWonModalLead] = useState<any>(null);
  const [showWonLost, setShowWonLost] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = useState<string[]>([]);

  // Load collapsed columns from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('flowzen:pipeline:collapsed-columns');
      if (saved) {
        setCollapsedColumns(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  const toggleCollapse = (columnId: string) => {
    setCollapsedColumns(prev => {
      const next = prev.includes(columnId)
        ? prev.filter(c => c !== columnId)
        : [...prev, columnId];
      sessionStorage.setItem('flowzen:pipeline:collapsed-columns', JSON.stringify(next));
      return next;
    });
  };

  // Horizontal edge auto-scroll while dragging a card (the dnd lib's built-in auto-scroll
  // doesn't reliably pan the board's horizontal container past nested vertical columns).
  const scrollRef = useRef<HTMLDivElement>(null);
  const edgeScroll = useRef<{ dir: number; raf: number | null; cleanup: (() => void) | null }>({ dir: 0, raf: null, cleanup: null });

  const startAutoScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const EDGE = 90, SPEED = 22; // px from edge that triggers scroll; px/frame
    const onPointer = (clientX: number) => {
      if (el.scrollWidth <= el.clientWidth) { edgeScroll.current.dir = 0; return; }
      const r = el.getBoundingClientRect();
      if (clientX < r.left + EDGE) edgeScroll.current.dir = -1;
      else if (clientX > r.right - EDGE) edgeScroll.current.dir = 1;
      else edgeScroll.current.dir = 0;
    };
    const pm = (e: PointerEvent) => onPointer(e.clientX);
    const tm = (e: TouchEvent) => { if (e.touches[0]) onPointer(e.touches[0].clientX); };
    window.addEventListener('pointermove', pm, { passive: true });
    window.addEventListener('touchmove', tm, { passive: true });
    const tick = () => {
      if (edgeScroll.current.dir !== 0 && scrollRef.current) scrollRef.current.scrollLeft += edgeScroll.current.dir * SPEED;
      edgeScroll.current.raf = requestAnimationFrame(tick);
    };
    edgeScroll.current.raf = requestAnimationFrame(tick);
    edgeScroll.current.cleanup = () => {
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('touchmove', tm);
      if (edgeScroll.current.raf) cancelAnimationFrame(edgeScroll.current.raf);
      edgeScroll.current = { dir: 0, raf: null, cleanup: null };
    };
  };
  const stopAutoScroll = () => edgeScroll.current.cleanup?.();
  useEffect(() => () => stopAutoScroll(), []);

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
    stopAutoScroll();
    if (!result.destination) return;
    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId) return; // Didn't change column

    const lead = leads.find(l => l.id === draggableId);
    if (!lead) return;

    const destGroup = GROUPS.find(g => g.id === destination.droppableId);
    if (!destGroup) return;

    const newStage = destGroup.stages[0]; // Default to first chronological stage in target group
    if (newStage === lead.stage) return;

    const currentIndex = PIPELINE_STAGES.indexOf(lead.stage);
    const targetIndex = PIPELINE_STAGES.indexOf(newStage);

    if (targetIndex < currentIndex) {
      // Optimistic update for backward move to prevent snap-back
      const previousLeads = [...leads];
      setLeads(leads.map(l => l.id === lead.id ? { ...l, stage: newStage } : l));

      setIsSubmitting(true);
      api.post(`/crm/leads/${lead.id}/stage`, { stage: newStage, fields: {} })
        .then((updatedLead: any) => {
          toast.success('Stage updated successfully');
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          queryClient.invalidateQueries({ queryKey: ['clients'] });
          queryClient.setQueryData(['lead', lead.id], updatedLead);
          fetchLeads();
        })
        .catch((err: any) => {
          toast.error(err.message || 'Failed to update stage');
          setLeads(previousLeads); // revert on failure
        })
        .finally(() => {
          setIsSubmitting(false);
        });
    } else {
      // Optimistic update for forward move too
      const previousLeads = [...leads];
      setLeads(leads.map(l => l.id === lead.id ? { ...l, stage: newStage } : l));
      setPendingTransition({ lead, targetStage: newStage, previousLeads });
    }
  };

  async function submitStageTransition(payload: any) {
    if (!pendingTransition) return;
    const lead = pendingTransition.lead;
    setIsSubmitting(true);
    try {
      const updatedLead = await api.post(`/crm/leads/${lead.id}/stage`, payload);
      toast.success('Stage updated successfully');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.setQueryData(['lead', lead.id], updatedLead);
      await fetchLeads(); // Fetch new data before closing modal
      setPendingTransition(null);
      if (payload?.stage === 'CONTRACT') setWonModalLead(lead);
    } catch (err: any) {
      // Re-throw so the modal can surface the error and stay open.
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  // Hide Won/Lost columns by default; the "Show Won/Lost" toggle reveals them.
  const visibleGroups = showWonLost ? GROUPS : GROUPS.filter(g => g.id !== 'Closed' && g.id !== 'Lost');

  if (!isMounted || loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col h-[calc(100vh-185px)] min-h-[550px] overflow-hidden">

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

      <div ref={scrollRef} className="flex flex-1 w-full overflow-x-auto overflow-y-hidden gap-4 pb-2 px-1 custom-scrollbar min-h-0">
        <DragDropContext onDragStart={startAutoScroll} onDragEnd={handleDragEnd}>
          {visibleGroups.map((group) => {
            const columnLeads = columns[group.id] || [];
            const columnValue = columnLeads.reduce((acc, curr) => acc + (curr.dealValue || 0), 0);
            const isCollapsed = collapsedColumns.includes(group.id);

            if (isCollapsed) {
              return (
                <div
                  key={group.id}
                  onClick={() => toggleCollapse(group.id)}
                  className="flex flex-col w-12 h-full shrink-0 border border-gray-200 rounded-xl cursor-pointer py-4 justify-between items-center transition-all select-none group/col shadow-sm hover:shadow"
                  style={{ 
                    borderLeft: `4px solid ${group.color}`,
                    backgroundColor: `${group.color}08` // 3% opacity tint of stage color
                  }}
                >
                  <button
                    type="button"
                    className="p-1 rounded-lg transition-colors"
                    style={{ color: group.color }}
                  >
                    <ChevronsRight className="w-4 h-4 hover:scale-110 transition-transform" />
                  </button>

                  <div className="flex flex-col items-center justify-center flex-1">
                    <span 
                      className="rotate-90 origin-center whitespace-nowrap text-xs font-bold uppercase tracking-wider select-none transform"
                      style={{ color: group.color }}
                    >
                      {group.title}
                    </span>
                  </div>

                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm"
                    style={{ backgroundColor: group.color }}
                  >
                    {columnLeads.length}
                  </div>
                </div>
              );
            }

            return (
              <div key={group.id} className="flex flex-col flex-1 min-w-[260px] max-w-[340px] h-full shrink-0 border border-gray-200 bg-gray-50/80 rounded-xl overflow-hidden shadow-sm">
                {/* Column Header */}
                <div 
                  className="px-4 py-3 flex items-center justify-between shrink-0 animate-fade-in"
                  style={{ backgroundColor: group.color }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(group.id);
                      }}
                      className="p-0.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                      title="Collapse column"
                    >
                      <ChevronsLeft className="w-3.5 h-3.5" />
                    </button>
                    <h3 className="text-sm font-semibold text-white tracking-wide">{group.title}</h3>
                  </div>
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
                      className={`flex-1 p-3 overflow-y-auto space-y-3 transition-colors custom-scrollbar min-h-0 ${
                        snapshot.isDraggingOver ? 'bg-gray-100/50' : 'bg-transparent'
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
                                  {lead.leadId && (
                                    <span className="text-[10px] font-mono text-gray-400 tracking-wide">{lead.leadId}</span>
                                  )}
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

                {/* Column Footer */}
                <div className="px-4 py-2.5 bg-white border-t border-gray-200 flex items-center justify-between shrink-0 select-none">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Total Value</span>
                    <span className="text-xs font-bold text-primary">
                      {formatCurrency(columnValue)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddModalOpen(true);
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-blue-600 transition-colors py-1 px-2 rounded-lg hover:bg-gray-50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            );
          })}
          {/* Edge Spacer */}
          <div className="w-2 shrink-0" />
        </DragDropContext>
      </div>

      {/* Per-card stage menu — pick any exact stage, including within the same group (LEAD -> MQL) */}
      {stageMenu && (
        <>
          <div className="fixed inset-0 z-60" onClick={() => setStageMenu(null)} />
          <div
            className="fixed z-61 w-56 max-h-80 overflow-y-auto bg-white rounded-xl shadow-2xl border border-border py-1"
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
                    const currIdx = PIPELINE_STAGES.indexOf(stageMenu.lead.stage);
                    const targIdx = PIPELINE_STAGES.indexOf(stage);
                    if (targIdx < currIdx) {
                      const prevLeads = [...leads];
                      setLeads(leads.map(l => l.id === stageMenu.lead.id ? { ...l, stage } : l));
                      setStageMenu(null);
                      api.post(`/crm/leads/${stageMenu.lead.id}/stage`, { stage, fields: {} })
                        .then((updatedLead: any) => {
                          toast.success('Stage updated successfully');
                          queryClient.invalidateQueries({ queryKey: ['leads'] });
                          queryClient.invalidateQueries({ queryKey: ['clients'] });
                          queryClient.setQueryData(['lead', stageMenu.lead.id], updatedLead);
                          fetchLeads();
                        })
                        .catch((err: any) => {
                          toast.error(err.message || 'Failed to update stage');
                          setLeads(prevLeads);
                        });
                    } else {
                      const prevLeads = [...leads];
                      setLeads(leads.map(l => l.id === stageMenu.lead.id ? { ...l, stage } : l));
                      setPendingTransition({ lead: stageMenu.lead, targetStage: stage, previousLeads: prevLeads });
                      setStageMenu(null);
                    }
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
            lead={pendingTransition.lead}
            currentStage={pendingTransition.lead.stage}
            targetStage={pendingTransition.targetStage}
            onClose={() => {
              if (pendingTransition.previousLeads) setLeads(pendingTransition.previousLeads);
              setPendingTransition(null);
            }}
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

      {/* Local Add Lead Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <LeadModal
            initialMode="MANUAL"
            onClose={() => setIsAddModalOpen(false)}
            onSuccess={() => {
              setIsAddModalOpen(false);
              fetchLeads();
            }}
          />
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 20px;
          border: 1px solid transparent;
          background-clip: padding-box;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
      `}</style>
    </div>
  );
}
