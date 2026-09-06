'use client';

import { useState, useEffect, useCallback } from 'react';
import { TableRowsSkeleton } from '@/components/ui/skeleton-loaders';
import { plural } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { api, ApiError, formatMoney, fileUrl } from '@/lib/api-v2';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { AddVersionModal } from '@/components/clients/AddVersionModal';
import { NewProformaModal } from '@/components/clients/NewProformaModal';
import { useConfirmStore } from '@/stores/confirm';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StatTile, StatRow } from '@/components/ui/stat-tile';

const STAGE_ORDER = ['TALKING', 'PROPOSAL_SENT', 'IN_NEGOTIATION', 'PROFORMA_ISSUED', 'VERBAL_YES', 'WON'];
const STAGE_LABEL: Record<string, string> = {
  TALKING: 'Talking',
  PROPOSAL_SENT: 'Proposal sent',
  IN_NEGOTIATION: 'In negotiation',
  PROFORMA_ISSUED: 'Proforma issued',
  VERBAL_YES: 'Verbal yes',
  WON: 'Won',
};
// Matches the per-proposal default in routes/proposals.ts's pipeline
// endpoint — shown as the column's "likely" label. A card can still carry
// its own probabilityOverride, which is what the weighted totals actually
// use (see weightedValue below), not this flat per-stage number.
const STAGE_PROBABILITY: Record<string, number> = {
  TALKING: 20,
  PROPOSAL_SENT: 40,
  IN_NEGOTIATION: 60,
  PROFORMA_ISSUED: 80,
  VERBAL_YES: 95,
  WON: 100,
};

interface PipelineCard {
  id: string;
  companyId: string;
  companyName: string;
  kind: string;
  stage: string;
  owner?: { name: string } | null;
  quotedValue: number;
  daysInStage: number;
  versionCount: number;
  currentVersionId: string | null;
  currentVersionNumber: number;
  probability: number;
}

/**
 * What dragging a card onto a column actually does — never a bare stage
 * write. Dropping only ever opens the real thing that record needs (§3:
 * "status is derived, never typed"); a rejected drop just explains why and
 * the card stays where the data says it is.
 */
type DropAction =
  | { type: 'NOOP' }
  | { type: 'INVALID'; reason: string }
  | { type: 'ADD_VERSION' }
  | { type: 'PROFORMA' }
  | { type: 'VERBAL_YES' }
  | { type: 'WIN' };

function getDropAction(fromStage: string, toStage: string): DropAction {
  if (fromStage === toStage) return { type: 'NOOP' };
  const fromIdx = STAGE_ORDER.indexOf(fromStage);
  const toIdx = STAGE_ORDER.indexOf(toStage);
  if (toIdx < fromIdx) {
    return { type: 'INVALID', reason: 'Stage only moves forward, from a real record — dragging it back is not one.' };
  }
  if (toStage === 'TALKING' || toStage === 'PROPOSAL_SENT') {
    return { type: 'INVALID', reason: 'Nothing sends a proposal back to this stage — it only happens when the proposal is first created.' };
  }
  if (toStage === 'IN_NEGOTIATION') return { type: 'ADD_VERSION' };
  if (toStage === 'PROFORMA_ISSUED') return { type: 'PROFORMA' };
  if (toStage === 'VERBAL_YES') {
    if (fromStage !== 'PROFORMA_ISSUED') {
      return { type: 'INVALID', reason: 'Verbal yes can only be flagged once a proforma has been issued — drop it on Proforma issued first.' };
    }
    return { type: 'VERBAL_YES' };
  }
  if (toStage === 'WON') return { type: 'WIN' };
  return { type: 'INVALID', reason: 'Not a real transition.' };
}

interface ColumnData {
  stage: string;
  cards: PipelineCard[];
  totalValue: number;
  weightedValue: number;
}

interface FunnelStep {
  step: string;
  in: number;
  movedOn: number;
  rate: number;
  read: string;
}

export default function PipelinePage() {
  const router = useRouter();
  const { confirm } = useConfirmStore();
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ liveDeals: 0, notYetQuoted: 0, fullPipeline: 0, weighted: 0, goingStale: 0 });
  const [overridingCard, setOverridingCard] = useState<PipelineCard | null>(null);
  const [addingVersionFor, setAddingVersionFor] = useState<PipelineCard | null>(null);
  const [raisingProformaFor, setRaisingProformaFor] = useState<PipelineCard | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [funnelMonths, setFunnelMonths] = useState(6);
  const [loadingFunnel, setLoadingFunnel] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.pipeline.getBoard();
      if (res.success) {
        const cols: ColumnData[] = STAGE_ORDER.map(stage => {
          // quotedValue arrives over the wire as a string — Decimal fields
          // serialize that way everywhere in this app (api-v2.ts's own
          // header: "Money arrives as a STRING and stays one"). Fine for
          // display, but `+` on two strings concatenates instead of adding,
          // which silently turned every sum below into digit-mashing like
          // "0" + "250000" + "250000" = "0250000250000". Normalized once,
          // here, so every reduce() downstream is real arithmetic.
          const cards: PipelineCard[] = (res.columns[stage] || []).map((c: PipelineCard) => ({
            ...c,
            quotedValue: Number(c.quotedValue) || 0,
          }));
          const totalValue = cards.reduce((s, c) => s + (c.quotedValue || 0), 0);
          // Weighted per card, not per column — a per-deal probability
          // override only means anything if it actually moves this number.
          const weightedValue = cards.reduce((s, c) => s + (c.quotedValue || 0) * (c.probability / 100), 0);
          return { stage, cards, totalValue, weightedValue };
        });
        setColumns(cols);

        const allCards = cols.flatMap(c => c.cards);
        const live = allCards.filter(c => c.stage !== 'WON');
        const fullPipeline = live.reduce((s, c) => s + (c.quotedValue || 0), 0);
        const weighted = cols
          .filter(c => c.stage !== 'WON')
          .reduce((s, c) => s + c.weightedValue, 0);
        const stale = live.filter(c => c.daysInStage > 25).length;

        setStats({
          liveDeals: live.length,
          notYetQuoted: live.filter(c => c.stage === 'TALKING').length,
          fullPipeline,
          weighted,
          goingStale: stale,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFunnel = useCallback(async () => {
    setLoadingFunnel(true);
    try {
      const res = await api.pipeline.funnel();
      if (res.success) {
        setFunnel(res.steps);
        setFunnelMonths(res.months);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFunnel(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFunnel(); }, [loadFunnel]);


  const findCard = (id: string): PipelineCard | null => {
    for (const col of columns) {
      const found = col.cards.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  };

  const handleMarkWon = async (card: PipelineCard) => {
    if (!card.currentVersionId) {
      toast.error('This proposal has no version to win against.');
      return;
    }
    const ok = await confirm({
      title: 'Mark this proposal won?',
      message: `Won on v${card.currentVersionNumber} (${formatMoney(card.quotedValue)}). ${card.companyName} moves to Client and this proposal locks — no more versions.`,
      confirmText: 'Mark won',
      variant: 'info',
    });
    if (!ok) return;
    try {
      await api.proposals.win(card.id, card.currentVersionId);
      toast.success('Proposal won');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not mark this proposal won');
    }
  };

  const handleVerbalYes = async (card: PipelineCard) => {
    const ok = await confirm({
      title: 'Flag verbal yes?',
      message: 'The client has agreed verbally, before anything is signed. This is a manual flag only — winning still needs the actual win step.',
      confirmText: 'Flag it',
      variant: 'info',
    });
    if (!ok) return;
    try {
      await api.proposals.updateStage(card.id, 'VERBAL_YES');
      toast.success('Flagged verbal yes');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not flag verbal yes');
    }
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const action = getDropAction(source.droppableId, destination.droppableId);
    const card = findCard(draggableId);
    if (!card) return;

    switch (action.type) {
      case 'NOOP':
        return;
      case 'INVALID':
        toast.error(action.reason);
        return;
      case 'ADD_VERSION':
        setAddingVersionFor(card);
        return;
      case 'PROFORMA':
        setRaisingProformaFor(card);
        return;
      case 'VERBAL_YES':
        void handleVerbalYes(card);
        return;
      case 'WIN':
        void handleMarkWon(card);
        return;
    }
  };

  usePageHeader('Sales pipeline', `${stats.liveDeals} live deals`);

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
          <ExportCsvButton href={fileUrl('/proposals?format=csv')} label="Export proposals CSV" />
          {/*
            "New" said nothing, and led somewhere else: it opens company
            creation on /companies, which reads as the wrong workflow until you
            know that a pipeline starts with a lead and a lead IS a company —
            the new record lands on this board in New Lead. The destination was
            right; the button was the part that never said so.
          */}
          <Button icon={Plus} onClick={() => router.push('/companies?create=true')}>
            New lead
          </Button>
      </div>

      <StatRow className="mb-8">
        <StatTile label="Live Deals" value={stats.liveDeals} note={`${stats.notYetQuoted} not yet quoted`} />
        <StatTile label="Full Pipeline" value={formatMoney(stats.fullPipeline)} note="if every one lands" />
        <StatTile
          label="Weighted"
          value={formatMoney(stats.weighted)}
          note="by stage likelihood"
          tone="warning"
        />
        <StatTile label="Going Stale" value={stats.goingStale} note="over 25 days, no movement" />
      </StatRow>

      {/* Philosophy banner */}
      <div className="border border-border rounded-xl p-4 mb-6 bg-white">
        <p className="text-sm font-semibold text-primary mb-0.5">Stage follows the record, not an opinion</p>
        <p className="text-sm text-secondary">
          Drag a card and it opens the real step behind that stage — add a version, raise a proforma, flag verbal yes, mark won — instead of just setting one. <span className="italic text-primary">Nobody can make this board look healthier than the business is.</span>
        </p>
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="text-sm text-secondary py-8">Loading pipeline…</div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          {/*
            The board scrolls sideways in its own container, so the shell's
            mobile bottom padding sits outside it and the last card's value ran
            under the fixed tab bar. This is the only screen in the app where
            that happened; the padding belongs on the scroller itself.
          */}
          <div className="flex gap-4 overflow-x-auto pb-4 md:pb-4 max-md:pb-24">
            {columns.map(col => (
              <div
                key={col.stage}
                className={`shrink-0 w-50 flex flex-col rounded-xl border overflow-hidden ${
                  col.stage === 'WON' ? 'bg-success-tint border-success/30' : 'bg-subtle border-border'
                }`}
              >
                {/* Column header */}
                <div className={`px-3 py-2.5 border-b ${col.stage === 'WON' ? 'bg-success-tint border-success/30' : 'bg-white border-border'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-semibold text-primary">{STAGE_LABEL[col.stage]}</h3>
                    <span className="text-micro text-secondary">{col.cards.length}</span>
                  </div>
                  <p className="text-xs font-semibold text-primary">{formatMoney(col.totalValue)}</p>
                  <p className="text-micro text-secondary">{STAGE_PROBABILITY[col.stage]}% likely · {
                    col.stage === 'TALKING' ? 'No proposal yet' :
                    col.stage === 'PROPOSAL_SENT' ? 'Number is with them' :
                    col.stage === 'IN_NEGOTIATION' ? 'They came back' :
                    col.stage === 'PROFORMA_ISSUED' ? 'Accounts asked to pay' :
                    col.stage === 'VERBAL_YES' ? 'Agreed, nothing signed' :
                    'This month'
                  }</p>
                </div>

                {/* Cards */}
                <Droppable droppableId={col.stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`h-125 overflow-y-auto space-y-2 p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5' : ''}`}
                    >
                      {col.cards.length === 0 && !snapshot.isDraggingOver && (
                        <div className="border border-dashed border-border rounded-xl p-3 text-micro text-secondary text-center">Empty</div>
                      )}
                      {col.cards.map((card, index) => (
                        <Draggable key={card.id} draggableId={card.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              onClick={() => router.push(`/companies/${card.companyId}?tab=PROPOSALS`)}
                              className={`border border-border bg-white rounded-xl p-3 cursor-pointer hover:border-primary/30 transition-colors ${
                                dragSnapshot.isDragging ? 'shadow-overlay border-primary/40' : ''
                              }`}
                            >
                              <p className="text-sm font-semibold text-primary mb-1 leading-tight">{card.companyName}</p>
                              <p className="text-sm font-bold text-primary mb-2">{formatMoney(card.quotedValue)}</p>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1">
                                  <span className={`text-micro px-1.5 py-0.5 rounded font-semibold border ${
                                    card.kind === 'RETAINER'
                                      ? 'border-info/30 text-info bg-info-tint'
                                      : 'border-info/30 text-info bg-info-tint'
                                  }`}>{card.kind === 'RETAINER' ? 'Retainer' : 'One time'}</span>
                                  <span className="text-micro text-secondary">{card.owner?.name?.split(' ')[0]}</span>
                                </div>
                                <span className={`text-micro font-semibold ${card.daysInStage > 25 ? 'text-warning-ink' : 'text-secondary'}`}>
                                  {card.daysInStage}d
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setOverridingCard(card); }}
                                className="text-micro font-semibold text-secondary hover:text-primary hover:underline"
                                title="Override win probability for this deal"
                              >
                                {card.probability}% likely
                              </button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Column footer */}
                {col.stage !== 'WON' && col.totalValue > 0 && (
                  <p className="text-micro text-secondary px-3 py-2 border-t border-border">Weighted {formatMoney(col.weightedValue)}</p>
                )}
              </div>
            ))}
          </div>
        </DragDropContext>
      )}

      {/* Stage-to-stage conversion */}
      <div className="border border-border rounded-xl overflow-hidden mt-6">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-white">
          <h3 className="text-sm font-semibold text-primary">Stage to stage</h3>
          <span className="text-micro text-secondary">Last {plural(funnelMonths, 'month')}</span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full data-table">
          <thead>
            <tr className="border-b border-border">
              <th className="eyebrow text-left">Step</th>
              <th className="eyebrow text-right">In</th>
              <th className="eyebrow text-right">Moved on</th>
              <th className="eyebrow text-right">Rate</th>
              <th className="eyebrow text-left">Read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loadingFunnel ? (
              <TableRowsSkeleton cols={5} />
            ) : funnel.every(s => s.in === 0) ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-secondary">Not enough proposals in this window yet.</td></tr>
            ) : funnel.map(s => (
              <tr key={s.step}>
                <td className="font-medium text-primary">{s.step}</td>
                <td className="text-body text-right">{s.in}</td>
                <td className="text-body text-right">{s.movedOn}</td>
                <td className={`font-bold text-right ${
                  s.read === 'Needs attention' ? 'text-danger' : s.read === 'Some drop-off' ? 'text-warning-ink' : 'text-primary'
                }`}>
                  {s.in > 0 ? `${s.rate}%` : '—'}
                </td>
                <td className={`${s.read === 'Needs attention' ? 'text-danger' : 'text-secondary'}`}>{s.read}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-subtle/30">
          <p className="text-micro text-secondary">
            Each step counts durable facts — a revision, a proforma, a won outcome — so a later loss never erases how far a deal got.
          </p>
        </div>
      </div>

      {overridingCard && (
        <ProbabilityOverrideModal
          card={overridingCard}
          onClose={() => setOverridingCard(null)}
          onSaved={() => { setOverridingCard(null); void load(); }}
        />
      )}

      {addingVersionFor && (
        <AddVersionModal
          proposalId={addingVersionFor.id}
          nextVersionNumber={addingVersionFor.versionCount + 1}
          onCancel={() => setAddingVersionFor(null)}
          onConfirm={() => { setAddingVersionFor(null); void load(); }}
        />
      )}

      {raisingProformaFor && (
        <NewProformaModal
          companyId={raisingProformaFor.companyId}
          companyName={raisingProformaFor.companyName}
          source={{ type: 'PROPOSAL', proposalId: raisingProformaFor.id }}
          defaultAmount={raisingProformaFor.quotedValue}
          onCancel={() => setRaisingProformaFor(null)}
          onConfirm={() => { setRaisingProformaFor(null); void load(); }}
        />
      )}
    </div>
  );
}

function ProbabilityOverrideModal({
  card,
  onClose,
  onSaved,
}: {
  card: PipelineCard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(String(card.probability));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(value);
  const canSave = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;

  const save = async (override: number | null) => {
    setSaving(true);
    setError(null);
    try {
      await api.proposals.setProbability(card.id, override);
      toast.success(override === null ? 'Reverted to stage default' : 'Win probability updated');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the probability');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Win probability" description={`${card.companyName} — overrides the stage default just for this deal.`}>
      <form onSubmit={(e) => { e.preventDefault(); if (canSave) void save(parsed); }}>
        <ModalBody className="space-y-4">
          <Field label="Likely to win (%)" value={value} onChange={setValue} type="number" required />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={() => void save(null)} loading={saving} disabled={saving}>
            Clear override
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave || saving}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
