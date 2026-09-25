"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TableRowsSkeleton } from "@/components/ui/skeleton-loaders";
import { plural } from "@/lib/utils";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { api, ApiError, formatMoney, fileUrl } from "@/lib/api-v2";
import { Modal, ModalBody, ModalFooter } from "@/components/ui/modal";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ErrorNote } from "@/components/ui/empty-state";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { AddVersionModal } from "@/components/clients/AddVersionModal";
import { NewProformaModal } from "@/components/clients/NewProformaModal";
import { useConfirmStore } from "@/stores/confirm";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useConfig } from "@/hooks/queries";
import { StatTile, StatRow } from "@/components/ui/stat-tile";
import { STAGE_LABEL, STAGE_ORDER } from "@flowzen/shared";
import { NewProposalModal } from "@/components/clients/NewProposalModal";
import { LoseProposalModal } from "@/components/clients/LoseProposalModal";
import { NewRetainerModal } from "@/components/clients/NewRetainerModal";
import { NewProjectModal } from "@/components/clients/NewProjectModal";

/*
 * The board starts where a number does.
 *
 * There was a TALKING column in front of this, holding an empty proposal that
 * adding a company created by itself -- no version, no value, nothing quoted --
 * which could not be dragged forward and had to be deleted by hand. A company
 * reaches the pipeline now by being sent a proposal, which is what §14 always
 * said: "a proposal only reaches the board at Proposal sent".
 */
/**
 * The last of four copies of this table, kept only until the real one loads.
 *
 * §14 makes these a setting; they now live on the organisation and arrive with
 * /config. This stays as the shape to render before that request comes back —
 * the column headers would otherwise print "undefined% likely" for a moment —
 * and it holds §14's own defaults so a flash of the wrong number is impossible.
 */
const STAGE_PROBABILITY_FALLBACK: Record<string, number> = {
  PROPOSAL_SENT: 30,
  IN_NEGOTIATION: 60,
  PROFORMA_ISSUED: 85,
  VERBAL_YES: 90,
  WON: 100,
};

interface PipelineCard {
  id: string;
  companyId: string;
  companyName: string;
  /** Carried from the lead on promote. Shown where there is no figure yet. */
  companyVertical?: string | null;
  kind: string;
  stage: string;
  owner?: { name: string } | null;
  quotedValue: number;
  daysInStage: number;
  versionCount: number;
  currentVersionId: string | null;
  currentVersionNumber: number;
  probability: number;
  /**
   * The retainer or project built from this deal, once it exists.
   *
   * Winning marks the deal and makes the company a client; it does not create
   * the work. Null on a won card means nobody has set it up yet — which is the
   * thing the board could not say, so a deal could be won on Friday and have
   * nothing running behind it on Monday with nothing anywhere pointing that
   * out.
   */
  work?: { type: "RETAINER" | "PROJECT"; id: string; linked: boolean } | null;
}

/**
 * What dragging a card onto a column actually does — never a bare stage
 * write. Dropping only ever opens the real thing that record needs (§3:
 * "status is derived, never typed"); a rejected drop just explains why and
 * the card stays where the data says it is.
 */
type DropAction =
  | { type: "NOOP" }
  | { type: "INVALID"; reason: string }
  | { type: "CREATE_PROPOSAL" }
  | { type: "ADD_VERSION" }
  | { type: "PROFORMA" }
  | { type: "VERBAL_YES" }
  | { type: "WIN" }
  | { type: "LOSE" };

function getDropAction(fromStage: string, toStage: string): DropAction {
  if (fromStage === toStage) return { type: "NOOP" };
  /*
   * Losing can happen from anywhere, and is the one move that does not go
   * forward — a deal at Prospect can go quiet just as one at Verbal yes can.
   * Checked before the order rule below, which would otherwise refuse every
   * drop onto Lost from a column to its left.
   *
   * Nothing comes back from Lost: quoting them again is a new proposal.
   */
  /*
   * Out of Won, there is one move: to Lost, and only when nothing is running.
   *
   * Dragging Won → Lost used to flip the outcome and move nothing else — the
   * retainer or project the win created stayed live and the company stayed a
   * client, while the deal counted on both sides of the win rate. The server
   * decides now: it allows the correction when the work has already been
   * stopped or cancelled (or was never created), and refuses with the name of
   * what has to be dealt with first. Forward from Won means nothing at all.
   */
  if (fromStage === "WON" && toStage !== "LOST") {
    return {
      type: "INVALID",
      reason: "A won deal has nowhere else to go. Its work lives on the client's page now.",
    };
  }
  if (toStage === "LOST") return { type: "LOSE" };
  if (fromStage === "LOST") {
    return {
      type: "INVALID",
      reason:
        "A lost deal does not come back — quote them again as a new proposal.",
    };
  }
  const fromIdx = STAGE_ORDER.indexOf(fromStage);
  const toIdx = STAGE_ORDER.indexOf(toStage);
  if (toIdx < fromIdx) {
    return {
      type: "INVALID",
      reason:
        "Stage only moves forward, from a real record — dragging it back is not one.",
    };
  }
  if (toStage === "PROPOSAL_SENT") {
    /*
     * The one way into this stage by hand: a promoted lead, which sits at
     * Prospect with nothing quoted. Moving it here IS writing the proposal, so
     * the drop opens the form rather than setting a stage — the value has to
     * come from somewhere, and a stage set without one is the empty deal the
     * board used to be full of.
     */
    if (fromStage === "PROSPECT") return { type: "CREATE_PROPOSAL" };
    return {
      type: "INVALID",
      reason:
        "Nothing sends a proposal back to this stage — it only happens when the proposal is first created.",
    };
  }
  if (toStage === "IN_NEGOTIATION") return { type: "ADD_VERSION" };
  if (toStage === "PROFORMA_ISSUED") return { type: "PROFORMA" };
  if (toStage === "VERBAL_YES") {
    if (fromStage !== "PROFORMA_ISSUED") {
      return {
        type: "INVALID",
        reason:
          "Verbal yes can only be flagged once a proforma has been issued — drop it on Proforma issued first.",
      };
    }
    return { type: "VERBAL_YES" };
  }
  if (toStage === "WON") return { type: "WIN" };
  return { type: "INVALID", reason: "Not a real transition." };
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
  const queryClient = useQueryClient();
  /*
   * §14: the stage probabilities are a setting now. The board reads the same
   * figures the API weights against, so the column header and the card can no
   * longer disagree — and neither can this screen and the Forecast, which used
   * to hold a different table again.
   */
  const { data: config } = useConfig();
  const stageProbability =
    config?.organization?.stageProbabilities ?? STAGE_PROBABILITY_FALLBACK;
  const [overridingCard, setOverridingCard] = useState<PipelineCard | null>(
    null,
  );
  const [addingVersionFor, setAddingVersionFor] = useState<PipelineCard | null>(
    null,
  );
  /*
   * Writing the FIRST proposal for a promoted lead.
   *
   * Separate from adding a version, because it is a different act: the deal has
   * nothing on it yet, so the form has to ask what is being quoted AND whether
   * it is a retainer or a one-off — a decision defaulted at promote, since
   * outreach has no field for it. The version form asks neither; it exists to
   * revise a quote that already went out.
   */
  const [writingProposalFor, setWritingProposalFor] =
    useState<PipelineCard | null>(null);
  const [losingProposalFor, setLosingProposalFor] =
    useState<PipelineCard | null>(null);
  const [raisingProformaFor, setRaisingProformaFor] =
    useState<PipelineCard | null>(null);

  const { data: board, isPending } = useQuery({
    queryKey: ["pipeline", "board"],
    queryFn: () => api.pipeline.getBoard(),
  });

  const { data: funnelData, isPending: loadingFunnel } = useQuery({
    queryKey: ["pipeline", "funnel"],
    queryFn: () => api.pipeline.funnel(),
  });

  const loading = isPending;
  const funnel: FunnelStep[] = funnelData?.success ? funnelData.steps : [];
  const funnelMonths = funnelData?.success ? funnelData.months : 6;

  const columns: ColumnData[] = useMemo(() => {
    if (!board?.success) return [];
    return STAGE_ORDER.map((stage) => {
      // quotedValue arrives over the wire as a string — Decimal fields
      // serialize that way everywhere in this app (api-v2.ts's own
      // header: "Money arrives as a STRING and stays one"). Fine for
      // display, but `+` on two strings concatenates instead of adding,
      // which silently turned every sum below into digit-mashing like
      // "0" + "250000" + "250000" = "0250000250000". Normalized once,
      // here, so every reduce() downstream is real arithmetic.
      const cards: PipelineCard[] = (board.columns[stage] || []).map(
        (c: PipelineCard) => ({
          ...c,
          quotedValue: Number(c.quotedValue) || 0,
        }),
      );
      const totalValue = cards.reduce((s, c) => s + (c.quotedValue || 0), 0);
      // Weighted per card, not per column — a per-deal probability
      // override only means anything if it actually moves this number.
      const weightedValue = cards.reduce(
        (s, c) => s + (c.quotedValue || 0) * (c.probability / 100),
        0,
      );
      return { stage, cards, totalValue, weightedValue };
    });
  }, [board]);

  const stats = useMemo(() => {
    const allCards = columns.flatMap((c) => c.cards);
    const live = allCards.filter((c) => c.stage !== "WON");
    return {
      liveDeals: live.length,
      fullPipeline: live.reduce((s, c) => s + (c.quotedValue || 0), 0),
      weighted: columns
        .filter((c) => c.stage !== "WON")
        .reduce((s, c) => s + c.weightedValue, 0),
      goingStale: live.filter((c) => c.daysInStage > 25).length,
    };
  }, [columns]);

  /** What the drag, override, version and proforma flows call after a change. */
  const load = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["pipeline"] });
  }, [queryClient]);

  const findCard = (id: string): PipelineCard | null => {
    for (const col of columns) {
      const found = col.cards.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  };

  /*
   * Setting the work up, straight after the win.
   *
   * The moment somebody wins a deal is the moment they know what was agreed —
   * the value, when it starts, who runs it. Leaving the board and finding the
   * client's page later is where that gets lost, and a won deal with no
   * retainer behind it is invisible everywhere except the client's own screen.
   */
  const [settingUpWork, setSettingUpWork] = useState<PipelineCard | null>(null);

  const handleMarkWon = async (card: PipelineCard) => {
    if (!card.currentVersionId) {
      toast.error("This proposal has no version to win against.");
      return;
    }
    const ok = await confirm({
      title: "Mark this proposal won?",
      message: `Won on v${card.currentVersionNumber} (${formatMoney(card.quotedValue)}). ${card.companyName} moves to Client and this proposal locks — no more versions.`,
      confirmText: "Mark won",
      variant: "info",
    });
    if (!ok) return;
    try {
      await api.proposals.win(card.id, card.currentVersionId);
      toast.success("Proposal won");
      await load();
      // Asked here rather than assumed: the deal is won either way, and the
      // card keeps asking if this is dismissed.
      setSettingUpWork(card);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not mark this proposal won",
      );
    }
  };

  const handleVerbalYes = async (card: PipelineCard) => {
    const ok = await confirm({
      title: "Flag verbal yes?",
      message:
        "The client has agreed verbally, before anything is signed. This is a manual flag only — winning still needs the actual win step.",
      confirmText: "Flag it",
      variant: "info",
    });
    if (!ok) return;
    try {
      await api.proposals.updateStage(card.id, "VERBAL_YES");
      toast.success("Flagged verbal yes");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not flag verbal yes",
      );
    }
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const action = getDropAction(source.droppableId, destination.droppableId);
    const card = findCard(draggableId);
    if (!card) return;

    switch (action.type) {
      case "NOOP":
        return;
      case "INVALID":
        toast.error(action.reason);
        return;
      case "CREATE_PROPOSAL":
        /*
         * The proposal form, not the version form. Version one IS the proposal
         * for a promoted lead — it carries the value, and the API derives
         * Proposal Sent from its existence rather than from a stage anybody
         * sets — but it is written on the form that asks what is being quoted
         * and whether it is a retainer or a one-off.
         */
        setWritingProposalFor(card);
        return;
      case "ADD_VERSION":
        setAddingVersionFor(card);
        return;
      case "PROFORMA":
        setRaisingProformaFor(card);
        return;
      case "VERBAL_YES":
        void handleVerbalYes(card);
        return;
      case "WIN":
        void handleMarkWon(card);
        return;
      case "LOSE":
        // The reason is asked for before anything moves; recording it is the
        // whole point of the column.
        setLosingProposalFor(card);
        return;
    }
  };

  usePageHeader("Sales pipeline", `${stats.liveDeals} live deals`);

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-8">
        <ExportCsvButton
          href={fileUrl("/proposals?format=csv")}
          label="Export proposals CSV"
        />
        {/*
            "New" said nothing, and led somewhere else: it opens company
            creation on /companies, which reads as the wrong workflow until you
            know that a pipeline starts with a lead and a lead IS a company —
            the new record lands on this board in New Lead. The destination was
            right; the button was the part that never said so.
          */}
      </div>

      <StatRow className="mb-8">
        <StatTile
          label="Live Deals"
          value={stats.liveDeals}
          note="each one a real quote"
        />
        <StatTile
          label="Full Pipeline"
          value={formatMoney(stats.fullPipeline)}
          note="if every one lands"
        />
        <StatTile
          label="Weighted"
          value={formatMoney(stats.weighted)}
          note="by stage likelihood"
          tone="warning"
        />
        <StatTile
          label="Going Stale"
          value={stats.goingStale}
          note="over 25 days, no movement"
        />
      </StatRow>

      {/* Philosophy banner */}
      <div className="border border-border rounded-xl p-4 mb-6 bg-white">
        <p className="text-sm font-semibold text-primary mb-0.5">
          Stage follows the record, not an opinion
        </p>
        <p className="text-sm text-secondary">
          Drag a card and it opens the real step behind that stage — add a
          version, raise a proforma, flag verbal yes, mark won — instead of just
          setting one.{" "}
          <span className="italic text-primary">
            Nobody can make this board look healthier than the business is.
          </span>
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
            {columns.map((col) => (
              <div
                key={col.stage}
                className={`shrink-0 w-50 flex flex-col rounded-xl border overflow-hidden ${
                  col.stage === "WON"
                    ? "bg-success-tint border-success/30"
                    : "bg-subtle border-border"
                }`}
              >
                {/* Column header */}
                <div
                  className={`px-3 py-2.5 border-b ${col.stage === "WON" ? "bg-success-tint border-success/30" : "bg-white border-border"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-semibold text-primary">
                      {STAGE_LABEL[col.stage]}
                    </h3>
                    <span className="text-micro text-secondary">
                      {col.cards.length}
                    </span>
                  </div>
                  {/*
                    Prospect has no money and no probability, and saying so is
                    the point. Printing the total gave it a bold ₹0, and
                    `stageProbability` has no entry for a stage that is not
                    configurable — so the line read "% likely · This month",
                    a missing number followed by the Won column's caption.
                  */}
                  {col.stage === "PROSPECT" ? (
                    <>
                      <p className="text-xs font-semibold text-secondary">
                        Not quoted yet
                      </p>
                      <p className="text-micro text-secondary">
                        Promoted from outreach
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-primary">
                        {formatMoney(col.totalValue)}
                      </p>
                      <p className="text-micro text-secondary">
                        {stageProbability[col.stage]}% likely ·{" "}
                        {col.stage === "PROPOSAL_SENT"
                          ? "Number is with them"
                          : col.stage === "IN_NEGOTIATION"
                            ? "They came back"
                            : col.stage === "PROFORMA_ISSUED"
                              ? "Accounts asked to pay"
                              : col.stage === "VERBAL_YES"
                                ? "Agreed, nothing signed"
                                : "This month"}
                      </p>
                    </>
                  )}
                </div>

                {/* Cards */}
                <Droppable droppableId={col.stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`h-125 overflow-y-auto space-y-2 p-2 transition-colors ${snapshot.isDraggingOver ? "bg-primary/5" : ""}`}
                    >
                      {col.cards.length === 0 && !snapshot.isDraggingOver && (
                        <div className="border border-dashed border-border rounded-xl p-3 text-micro text-secondary text-center">
                          {/*
                            An empty Prospect column is the normal state until
                            somebody promotes a lead — and "Empty" gives no clue
                            that promoting is what fills it. Companies added any
                            other way, imported included, never appear here.
                          */}
                          {col.stage === "PROSPECT"
                            ? "Promote a lead from Outreach"
                            : "Empty"}
                        </div>
                      )}
                      {col.cards.map((card, index) => (
                        <Draggable
                          key={card.id}
                          draggableId={card.id}
                          index={index}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              onClick={() =>
                                router.push(
                                  `/companies/${card.companyId}?tab=PROPOSALS`,
                                )
                              }
                              className={`border border-border bg-white rounded-xl p-3 cursor-pointer hover:border-primary/30 transition-colors ${
                                dragSnapshot.isDragging
                                  ? "shadow-overlay border-primary/40"
                                  : ""
                              }`}
                            >
                              <p className="text-sm font-semibold text-primary mb-1 leading-tight">
                                {card.companyName}
                              </p>
                              {/*
                                A prospect is a company, not a deal worth nothing.
                                Nothing has been quoted yet, so printing ₹0 in bold
                                states a figure that does not exist — and the kind
                                beside it would assert a retainer-or-project
                                decision nobody has made. The industry it came in
                                with is the true thing to show instead.
                              */}
                              {card.stage === "PROSPECT" ? (
                                <p className="text-sm text-secondary mb-2">
                                  Not quoted yet
                                </p>
                              ) : (
                                <p className="text-sm font-bold text-primary mb-2">
                                  {formatMoney(card.quotedValue)}
                                </p>
                              )}
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1">
                                  {card.stage === "PROSPECT" ? (
                                    card.companyVertical && (
                                      <span className="text-micro px-1.5 py-0.5 rounded font-semibold border border-border text-secondary">
                                        {card.companyVertical}
                                      </span>
                                    )
                                  ) : (
                                    <span
                                      className={`text-micro px-1.5 py-0.5 rounded font-semibold border ${
                                        card.kind === "RETAINER"
                                          ? "border-info/30 text-info bg-info-tint"
                                          : "border-info/30 text-info bg-info-tint"
                                      }`}
                                    >
                                      {card.kind === "RETAINER"
                                        ? "Retainer"
                                        : "One time"}
                                    </span>
                                  )}
                                  <span className="text-micro text-secondary">
                                    {card.owner?.name?.split(" ")[0]}
                                  </span>
                                </div>
                                <span
                                  className={`text-micro font-semibold ${card.daysInStage > 25 ? "text-warning-ink" : "text-secondary"}`}
                                >
                                  {card.daysInStage}d
                                </span>
                              </div>
                              {card.stage === "WON" ? (
                                /*
                                  What is still missing.

                                  Winning does not create the retainer or the
                                  project — that is a separate decision, with a
                                  start date and an owner. A won card with
                                  nothing behind it used to look exactly like one
                                  with a retainer running, so work that was sold
                                  and never set up was invisible until somebody
                                  opened the client.
                                */
                                card.work ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(
                                        card.work!.type === "RETAINER"
                                          ? `/retainers/${card.work!.id}`
                                          : `/projects/${card.work!.id}`,
                                      );
                                    }}
                                    className="text-micro font-semibold text-secondary hover:text-primary hover:underline"
                                  >
                                    {card.work.type === "RETAINER" ? "Open retainer" : "Open project"}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSettingUpWork(card);
                                    }}
                                    className="text-micro font-semibold text-warning-ink hover:underline"
                                  >
                                    {card.kind === "RETAINER"
                                      ? "Set up the retainer →"
                                      : "Create the project →"}
                                  </button>
                                )
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOverridingCard(card);
                                  }}
                                  className="text-micro font-semibold text-secondary hover:text-primary hover:underline"
                                  title="Override win probability for this deal"
                                >
                                  {card.probability}% likely
                                </button>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Column footer */}
                {col.stage !== "WON" && col.totalValue > 0 && (
                  <p className="text-micro text-secondary px-3 py-2 border-t border-border">
                    Weighted {formatMoney(col.weightedValue)}
                  </p>
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
          <span className="text-micro text-secondary">
            Last {plural(funnelMonths, "month")}
          </span>
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
              ) : funnel.every((s) => s.in === 0) ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-sm text-secondary"
                  >
                    Not enough proposals in this window yet.
                  </td>
                </tr>
              ) : (
                funnel.map((s) => (
                  <tr key={s.step}>
                    <td className="font-medium text-primary">{s.step}</td>
                    <td className="text-body text-right">{s.in}</td>
                    <td className="text-body text-right">{s.movedOn}</td>
                    <td
                      className={`font-bold text-right ${
                        s.read === "Needs attention"
                          ? "text-danger"
                          : s.read === "Some drop-off"
                            ? "text-warning-ink"
                            : "text-primary"
                      }`}
                    >
                      {s.in > 0 ? `${s.rate}%` : "—"}
                    </td>
                    <td
                      className={`${s.read === "Needs attention" ? "text-danger" : "text-secondary"}`}
                    >
                      {s.read}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-border bg-subtle/30">
          <p className="text-micro text-secondary">
            Each step counts durable facts — a revision, a proforma, a won
            outcome — so a later loss never erases how far a deal got.
          </p>
        </div>
      </div>

      {overridingCard && (
        <ProbabilityOverrideModal
          card={overridingCard}
          onClose={() => setOverridingCard(null)}
          onSaved={() => {
            setOverridingCard(null);
            void load();
          }}
        />
      )}

      {losingProposalFor && (
        <LoseProposalModal
          proposalId={losingProposalFor.id}
          onCancel={() => setLosingProposalFor(null)}
          onConfirm={() => {
            setLosingProposalFor(null);
            void load();
          }}
        />
      )}

      {writingProposalFor && (
        <NewProposalModal
          companyId={writingProposalFor.companyId}
          companyName={writingProposalFor.companyName}
          // Fills this deal in rather than creating a second one beside it.
          proposalId={writingProposalFor.id}
          onCancel={() => setWritingProposalFor(null)}
          onConfirm={() => {
            setWritingProposalFor(null);
            void load();
          }}
        />
      )}

      {/*
        Setting the work up.

        The same two forms the client's page uses, opened with the deal already
        chosen — so the value carries over and the retainer or project is tied
        back to what sold it. Which form depends on what was quoted: a monthly
        retainer or a one-off project.
      */}
      <NewRetainerModal
        open={Boolean(settingUpWork) && settingUpWork?.kind === "RETAINER"}
        onClose={() => setSettingUpWork(null)}
        prefill={
          settingUpWork
            ? {
                companyId: settingUpWork.companyId,
                companyName: settingUpWork.companyName,
                monthlyValue: settingUpWork.quotedValue,
                sourceProposalId: settingUpWork.id,
              }
            : undefined
        }
        onCreated={(id) => {
          setSettingUpWork(null);
          toast.success("Retainer created");
          router.push(`/retainers/${id}`);
        }}
      />

      <NewProjectModal
        open={Boolean(settingUpWork) && settingUpWork?.kind === "PROJECT"}
        onClose={() => setSettingUpWork(null)}
        prefill={
          settingUpWork
            ? {
                companyId: settingUpWork.companyId,
                companyName: settingUpWork.companyName,
                quotedValue: settingUpWork.quotedValue,
                sourceProposalId: settingUpWork.id,
              }
            : undefined
        }
        onCreated={(id) => {
          setSettingUpWork(null);
          toast.success("Project created");
          router.push(`/projects/${id}`);
        }}
      />

      {addingVersionFor && (
        <AddVersionModal
          proposalId={addingVersionFor.id}
          nextVersionNumber={addingVersionFor.versionCount + 1}
          onCancel={() => setAddingVersionFor(null)}
          onConfirm={() => {
            setAddingVersionFor(null);
            void load();
          }}
        />
      )}

      {raisingProformaFor && (
        <NewProformaModal
          companyId={raisingProformaFor.companyId}
          companyName={raisingProformaFor.companyName}
          source={{ type: "PROPOSAL", proposalId: raisingProformaFor.id }}
          defaultAmount={raisingProformaFor.quotedValue}
          onCancel={() => setRaisingProformaFor(null)}
          onConfirm={() => {
            setRaisingProformaFor(null);
            void load();
          }}
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
      toast.success(
        override === null
          ? "Reverted to stage default"
          : "Win probability updated",
      );
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update the probability",
      );
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Win probability"
      description={`${card.companyName} — overrides the stage default just for this deal.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save(parsed);
        }}
      >
        <ModalBody className="space-y-4">
          <Field
            label="Likely to win (%)"
            value={value}
            onChange={setValue}
            type="number"
            required
          />
          {error && <ErrorNote>{error}</ErrorNote>}
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void save(null)}
            loading={saving}
            disabled={saving}
          >
            Clear override
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={!canSave || saving}
          >
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
