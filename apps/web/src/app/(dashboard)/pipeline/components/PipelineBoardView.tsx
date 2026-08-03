'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency, formatCurrencyCompact } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Plus, ChevronsLeft, ChevronsRight, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { StageTransitionModal } from './StageTransitionModal';
import { stageNeedsTransitionInput } from '../lib/stage-config';
import { WonCelebrationModal } from './WonCelebrationModal';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmStore } from '@/stores';
import { LeadModal } from './LeadModal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMembers } from '@/hooks/useQueries';
import { MultiSelect } from '@/components/ui/multi-select';
import { getInitials } from '@/lib/utils';
import { LEAD_STAGES, LEAD_STAGE_GROUPS, LEAD_STAGE_SHORT_LABELS, leadStageLabel } from '@/lib/lead-stage';

// All pipeline stages in chronological order (used by the per-card stage menu).
// Widened to string[]: leads arrive from the API typed loosely, and this list is used for
// index comparisons against those values.
const PIPELINE_STAGES: string[] = [...LEAD_STAGES];

// Probability weights used to compute weighted deal value per column
const STAGE_WEIGHTS: Record<string, number> = {
  NEW_LEAD: 0.10, OUTREACH: 0.20, MEETING: 0.30, PROPOSAL: 0.40, NEGOTIATION: 0.70,
  CONTRACT: 0.90, ACTIVE_RETAINER: 1.00, ACTIVE_PROJECT: 1.00, ON_HOLD: 0.10,
  PROJECT_COMPLETED: 1.00, CHURNED: 0.00,
};

const GROUPS = LEAD_STAGE_GROUPS;

// NOTE: the per-card stage badge was removed (UI audit F-3) — the column the card
// sits in already conveys its stage, so the badge was redundant. Column colours live
// in GROUPS above and are limited to 4 semantic hues (neutral / active / won / lost).

export function PipelineBoardView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<{ lead: any; targetStage: string; previousLeads?: any[]; dropGroupId?: string; dropIndex?: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Per-card stage menu: anchored dropdown to pick an exact stage (e.g. LEAD -> MQL within a group).
  const [stageMenu, setStageMenu] = useState<{ lead: any; x: number; y: number; up: boolean } | null>(null);
  // Won celebration modal + Won/Lost column visibility.
  const [wonModalLead, setWonModalLead] = useState<any>(null);
  const [showWonLost, setShowWonLost] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const debouncedSearch = useDebouncedValue(search, 300);
  const { data: members = [] } = useMembers();

  // Load collapsed columns from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('flowzen:pipeline:collapsed-columns');
      if (saved) {
        setCollapsedColumns(JSON.parse(saved));
      }
    } catch (e) { }
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

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (ownerFilter.length > 0 && !ownerFilter.includes(lead.assignedToId)) {
        return false;
      }
      if (debouncedSearch.trim()) {
        const queryParts = debouncedSearch.toLowerCase().trim().split(/\s+/);
        const haystack = [
          lead.company,
          lead.contactName,
          lead.contactEmail,
          lead.contactPhone,
          lead.client?.name,
          lead.client?.company,
        ].filter(Boolean).join(' ').toLowerCase();

        const matchesSearch = queryParts.every((part) => haystack.includes(part));
        if (!matchesSearch) return false;
      }
      return true;
    });
  }, [leads, ownerFilter, debouncedSearch]);

  // Group leads into the visual columns
  const columns = useMemo(() => {
    const cols: Record<string, any[]> = {};
    GROUPS.forEach(g => cols[g.id] = []);

    filteredLeads.forEach(lead => {
      const group = GROUPS.find(g => g.stages.includes(lead.stage));
      if (group) {
        cols[group.id].push(lead);
      }
    });

    // Sort each column by position ascending (or dealValue descending fallback)
    Object.keys(cols).forEach(colId => {
      cols[colId].sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined && a.position !== b.position) {
          return a.position - b.position;
        }
        const valA = a.dealValue || 0;
        const valB = b.dealValue || 0;
        return valB - valA;
      });
    });

    return cols;
  }, [filteredLeads]);

  const fullColumn = (groupId: string, currentLeads = leads) => {
    const group = GROUPS.find(g => g.id === groupId);
    if (!group) return [];
    const col = currentLeads.filter(l => group.stages.includes(l.stage));
    col.sort((a, b) => {
      if (a.position !== undefined && b.position !== undefined && a.position !== b.position) {
        return a.position - b.position;
      }
      return (b.dealValue || 0) - (a.dealValue || 0);
    });
    return col;
  };

  const applyDropPosition = async (leadId: string, dropGroupId: string, dropIndex: number) => {
    const destGroup = GROUPS.find(g => g.id === dropGroupId);
    if (!destGroup) return;

    setLeads((currentLeads) => {
      const colLeads = currentLeads.filter(l => destGroup.stages.includes(l.stage));
      colLeads.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined && a.position !== b.position) {
          return a.position - b.position;
        }
        return (b.dealValue || 0) - (a.dealValue || 0);
      });

      const targetLead = currentLeads.find(l => l.id === leadId);
      if (!targetLead) return currentLeads;

      const withoutTarget = colLeads.filter(l => l.id !== leadId);
      const clampedIndex = Math.max(0, Math.min(dropIndex, withoutTarget.length));
      withoutTarget.splice(clampedIndex, 0, targetLead);

      const reorderedItems = withoutTarget.map((l, idx) => ({ id: l.id, position: idx }));

      api.patch('/crm/leads/reorder', { items: reorderedItems }).catch(() => {
        fetchLeads();
      });

      return currentLeads.map(l => {
        const item = reorderedItems.find(i => i.id === l.id);
        return item ? { ...l, position: item.position } : l;
      });
    });
  };

  const moveStageBackward = (leadId: string, newStage: string, previousLeads: any[], dropGroupId?: string, dropIndex?: number) => {
    const submit = (reopen: boolean) => {
      setIsSubmitting(true);
      return api.post(`/crm/leads/${leadId}/stage`, { stage: newStage, fields: {}, ...(reopen ? { reopen: true } : {}) })
        .then(async (updatedLead: any) => {
          toast.success(reopen ? 'Confirmed' : 'Stage updated successfully');
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          queryClient.invalidateQueries({ queryKey: ['clients'] });
          queryClient.setQueryData(['lead', leadId], updatedLead);
          if (dropGroupId && dropIndex !== undefined) {
            await applyDropPosition(leadId, dropGroupId, dropIndex);
          }
          fetchLeads();
        })
        .finally(() => setIsSubmitting(false));
    };
    submit(false).catch(async (err: any) => {
      if (err?.code === 'DEAL_CLOSED') {
        // Same guard covers two distinct cases (leadStage.service.ts's stageTransitionError):
        // reopening a closed deal, or unwinding an already-won one — err.message is worded
        // correctly for whichever fired, so the dialog stays generic and just surfaces it.
        const okReopen = await confirm({
          title: 'Confirm stage change',
          message: err.message || 'This move needs confirmation. Continue?',
          confirmText: 'Continue',
          cancelText: 'Cancel',
          variant: 'warning',
        });
        if (okReopen) {
          try { await submit(true); return; }
          catch (e: any) { toast.error(e?.message || 'Failed to update stage'); }
        }
      } else {
        toast.error(err.message || 'Failed to update stage');
      }
      setLeads(previousLeads); // revert: cancelled reopen, failed reopen, or other error
    });
  };

  const handleDragEnd = (result: DropResult) => {
    stopAutoScroll();
    if (!result.destination) return;
    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId) {
      if (source.index === destination.index) return;
      const visibleColLeads = columns[source.droppableId] || [];
      const movedLead = visibleColLeads[source.index];
      if (!movedLead) return;

      const destVisibleLead = visibleColLeads[destination.index];
      const fullColLeads = fullColumn(source.droppableId);
      const withoutMoved = fullColLeads.filter(l => l.id !== movedLead.id);

      let newIndex = 0;
      if (destVisibleLead) {
        const destFullIdx = withoutMoved.findIndex(l => l.id === destVisibleLead.id);
        newIndex = destFullIdx !== -1 ? destFullIdx : destination.index;
      } else {
        newIndex = withoutMoved.length;
      }

      withoutMoved.splice(newIndex, 0, movedLead);
      const reorderedItems = withoutMoved.map((l, idx) => ({ id: l.id, position: idx }));

      setLeads(prev => prev.map(l => {
        const item = reorderedItems.find(i => i.id === l.id);
        return item ? { ...l, position: item.position } : l;
      }));

      api.patch('/crm/leads/reorder', { items: reorderedItems }).catch(() => {
        fetchLeads();
      });
      return;
    }

    const lead = leads.find(l => l.id === draggableId);
    if (!lead) return;

    const destGroup = GROUPS.find(g => g.id === destination.droppableId);
    if (!destGroup) return;

    const newStage = destGroup.stages[0]; // Default to first chronological stage in target group
    if (newStage === lead.stage) return;

    const currentIndex = PIPELINE_STAGES.indexOf(lead.stage);
    const targetIndex = PIPELINE_STAGES.indexOf(newStage);

    const dropGroupId = destination.droppableId;
    const dropIndex = destination.index;

    if (targetIndex < currentIndex) {
      // Optimistic update for backward move to prevent snap-back
      const previousLeads = [...leads];
      setLeads(leads.map(l => l.id === lead.id ? { ...l, stage: newStage } : l));
      moveStageBackward(lead.id, newStage, previousLeads, dropGroupId, dropIndex);
    } else {
      // Optimistic update for forward move too
      const previousLeads = [...leads];
      setLeads(leads.map(l => l.id === lead.id ? { ...l, stage: newStage } : l));
      if (stageNeedsTransitionInput(newStage)) {
        setPendingTransition({ lead, targetStage: newStage, previousLeads, dropGroupId, dropIndex });
      } else {
        // §3.4: stages with nothing to ask (e.g. → Outreach) commit instantly — no modal toll gate.
        quickMoveForward(lead, newStage, previousLeads, dropGroupId, dropIndex);
      }
    }
  };

  // Direct forward move for stages that require no input: the drag itself is the confirmation.
  async function quickMoveForward(lead: any, newStage: string, previousLeads: any[], dropGroupId?: string, dropIndex?: number) {
    try {
      const updatedLead = await api.post(`/crm/leads/${lead.id}/stage`, { stage: newStage });
      toast.success('Stage updated');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.setQueryData(['lead', lead.id], updatedLead);
      if (dropGroupId && dropIndex !== undefined) {
        await applyDropPosition(lead.id, dropGroupId, dropIndex);
      }
      fetchLeads();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update stage');
      setLeads(previousLeads); // revert the optimistic move
    }
  }

  async function submitStageTransition(payload: any) {
    if (!pendingTransition) return;
    const { lead, dropGroupId, dropIndex } = pendingTransition;
    setIsSubmitting(true);
    try {
      const updatedLead = await api.post(`/crm/leads/${lead.id}/stage`, payload);
      toast.success('Stage updated successfully');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.setQueryData(['lead', lead.id], updatedLead);
      if (dropGroupId && dropIndex !== undefined) {
        await applyDropPosition(lead.id, dropGroupId, dropIndex);
      }
      await fetchLeads(); // Fetch new data before closing modal
      setPendingTransition(null);
      if (payload?.stage === 'CONTRACT') setWonModalLead(updatedLead || { ...lead, ...payload });
    } catch (err: any) {
      // Re-throw so the modal can surface the error and stay open.
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  // Hide Won/Lost/Completed columns by default; the toggle reveals them.
  const visibleGroups = showWonLost ? GROUPS : GROUPS.filter(g => g.id !== 'Completed' && g.id !== 'Lost');

  if (!isMounted || loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col h-[calc(100vh-185px)] min-h-137.5 overflow-hidden">

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
            <input
              type="text"
              placeholder="Search leads…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-white pl-9 pr-8 py-1.5 text-sm outline-none focus:border-primary transition-all placeholder:text-secondary"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="w-44">
            <MultiSelect
              value={ownerFilter}
              onChange={setOwnerFilter}
              placeholder="Owners"
              options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
            />
          </div>

          {(search || ownerFilter.length > 0) && (
            <button
              onClick={() => { setSearch(''); setOwnerFilter([]); }}
              className="text-xs font-medium text-secondary hover:text-primary underline px-1 py-1"
            >
              Clear filters
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-secondary cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showWonLost}
            onChange={(e) => setShowWonLost(e.target.checked)}
            className="rounded border-gray-300 text-primary focus:ring-primary"
          />
          Show Won/Lost
        </label>
      </div>

      {(debouncedSearch || ownerFilter.length > 0) && filteredLeads.length === 0 && (
        <div className="py-6 text-center text-sm text-secondary bg-white rounded-2xl border border-border mb-3 shrink-0">
          No leads match your active search or owner filters.
        </div>
      )}

      <div ref={scrollRef} className="flex flex-1 w-full overflow-x-auto overflow-y-hidden gap-4 pb-2 px-1 custom-scrollbar min-h-0">
        <DragDropContext onDragStart={startAutoScroll} onDragEnd={handleDragEnd}>
          {visibleGroups.map((group) => {
            const columnLeads = columns[group.id] || [];
            // dealValue arrives as a string (Decimal serialized over JSON) — coerce with
            // Number() before summing, or `+` concatenates instead of adding (FZ-020).
            const columnValue = columnLeads.reduce((acc, curr) => acc + Number(curr.dealValue || 0), 0);
            // Weighted value = sum of (dealValue × stage probability weight) per card
            const columnWeightedValue = columnLeads.reduce((acc, curr) => {
              const weight = STAGE_WEIGHTS[curr.stage] ?? 0.5;
              return acc + Number(curr.dealValue || 0) * weight;
            }, 0);
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
              <div key={group.id} className="flex flex-col flex-1 min-w-65 max-w-85 h-full shrink-0 border border-gray-200 bg-gray-50/80 rounded-xl overflow-hidden shadow-sm">
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
                      className={`flex-1 p-3 overflow-y-auto space-y-3 transition-colors custom-scrollbar min-h-0 ${snapshot.isDraggingOver ? 'bg-gray-100/50' : 'bg-transparent'
                        }`}
                    >
                      {columnLeads.map((lead, index) => {
                        return (
                          <Draggable key={lead.id} draggableId={lead.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => router.push(`/pipeline/${lead.id}`)}
                                className={`bg-white rounded-xl p-4 border border-gray-200 cursor-pointer group ${snapshot.isDragging ? 'shadow-2xl shadow-black/10 scale-105 z-50 ring-2 ring-primary' : 'shadow-sm hover:shadow-md hover:border-gray-300'
                                  } transition-all relative`}
                              >
                                {/* Top Header: ID & Stage Badge */}
                                <div className="flex items-center justify-between gap-2 mb-3 select-none">
                                  {lead.leadId ? (
                                    <span className="text-[10px] font-mono text-gray-400 tracking-wide">{lead.leadId}</span>
                                  ) : (
                                    <span />
                                  )}
                                  {/* Distinctive active stage badges for Retainer vs. Project */}
                                  {(lead.stage === 'ACTIVE_RETAINER' || lead.stage === 'ACTIVE_PROJECT') && (
                                    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border uppercase tracking-wider ${lead.stage === 'ACTIVE_RETAINER'
                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                        : 'bg-green-50 text-green-700 border-green-200'
                                      }`}>
                                      {LEAD_STAGE_SHORT_LABELS[lead.stage] || leadStageLabel(lead.stage)}
                                    </span>
                                  )}
                                </div>

                                {/* Content */}
                                {(() => {
                                  const displayTitle = lead.companyName || lead.client?.company || lead.contactName || lead.client?.name || 'Unknown';
                                  const hasCompany = !!(lead.companyName || lead.client?.company);
                                  const displaySubtitle = hasCompany
                                    ? (lead.contactName || lead.client?.name || lead.contactEmail || '')
                                    : (lead.contactEmail || '');
                                  return (
                                    <>
                                      <div>
                                        <h4 className="text-[15px] font-bold text-primary truncate" title={displayTitle}>
                                          {displayTitle}
                                        </h4>
                                      </div>
                                      <div className="mt-1">
                                        {displaySubtitle && (
                                          <p className="text-sm font-medium text-secondary truncate" title={displaySubtitle}>
                                            {displaySubtitle}
                                          </p>
                                        )}
                                        {lead.jobTitle && (
                                          <p className="text-[11px] text-gray-400 truncate mt-0.5" title={lead.jobTitle}>
                                            {lead.jobTitle}
                                          </p>
                                        )}
                                      </div>
                                    </>
                                  );
                                })()}

                                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 min-w-0">
                                  <p className="text-sm font-bold text-primary truncate" title={lead.dealValue ? formatCurrency(lead.dealValue) : ''}>
                                    {lead.dealValue ? formatCurrencyCompact(lead.dealValue) : 'TBD'}
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

                {/* Column Footer — fixed, shows total + weighted deal values */}
                <div className="px-3 py-2.5 bg-white border-t border-gray-200 flex items-center justify-between shrink-0 select-none">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0">
                        <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider block">Total</span>
                        <span className="text-xs font-bold text-primary truncate block max-w-37.5" title={formatCurrency(columnValue)}>
                          {formatCurrencyCompact(columnValue)}
                        </span>
                      </div>
                      <div className="border-l border-gray-100 pl-3 min-w-0">
                        <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider block">Weighted</span>
                        <span className="text-xs font-bold text-emerald-600 truncate block max-w-37.5" title={formatCurrency(columnWeightedValue)}>
                          {formatCurrencyCompact(columnWeightedValue)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsAddModalOpen(true);
                    }}
                    className="flex items-center justify-center text-primary hover:text-blue-600 transition-colors p-1.5 rounded-lg hover:bg-gray-50 border border-gray-200"
                    title="Add Lead"
                  >
                    <Plus className="w-3.5 h-3.5" />
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
                      const leadId = stageMenu.lead.id;
                      setLeads(leads.map(l => l.id === leadId ? { ...l, stage } : l));
                      setStageMenu(null);
                      moveStageBackward(leadId, stage, prevLeads);
                    } else {
                      const prevLeads = [...leads];
                      setLeads(leads.map(l => l.id === stageMenu.lead.id ? { ...l, stage } : l));
                      if (stageNeedsTransitionInput(stage)) {
                        setPendingTransition({ lead: stageMenu.lead, targetStage: stage, previousLeads: prevLeads });
                      } else {
                        quickMoveForward(stageMenu.lead, stage, prevLeads);
                      }
                      setStageMenu(null);
                    }
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${isCurrent ? 'text-gray-300 cursor-default bg-gray-50/50' : 'text-primary hover:bg-gray-50'
                    }`}
                >
                  <span><span className="text-gray-400">{idx + 1}.</span> {leadStageLabel(stage)}</span>
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
