'use client';

/**
 * The pipeline board.
 *
 * One column per stage, read from the database rather than a constant — so
 * renaming or reordering a stage changes the board without a deploy (§3.4).
 *
 * The Active column is gone. It mapped to two stages and the drop handler always
 * picked the first, which is how a one-off project ended up billing monthly
 * forever (§1.3 ①). Winning now goes through a dialog that asks, and a server
 * that refuses without an answer.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Clock, Pause } from 'lucide-react';
import {
  api,
  ApiError,
  formatMoney,
  type BoardColumn,
  type BoardDeal,
  type OrgConfig,
} from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { getInitials, getAvatarColor } from '@/lib/utils';
import { WinDealDialog } from './components/WinDealDialog';
import { ExtendedCompanyInfoModal } from '@/components/clients/ExtendedCompanyInfoModal';
import { NewDealModal } from './components/NewDealModal';
import { Button } from '@/components/ui/button';

export default function PipelinePage() {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BoardDeal | null>(null);
  const [winning, setWinning] = useState<BoardDeal | null>(null);
  const [needsInfo, setNeedsInfo] = useState<{ deal: BoardDeal; columnId: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [board, cfg] = await Promise.all([api.deals.board(), api.config.get()]);
      setColumns(board.columns);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const drop = async (deal: BoardDeal, column: BoardColumn) => {
    setDragging(null);

    // Winning is not a drag. It creates billing and needs terms the board does
    // not carry, so the drop opens the dialog instead of guessing.
    if (column.kind === 'WON') {
      setWinning(deal);
      return;
    }

    if (column.kind === 'LOST') {
      // Losing needs a reason, or "why do we lose?" is unanswerable.
      const reason = config?.lostReasons[0];
      if (!reason) return;
      window.location.href = `/pipeline/${deal.id}?lose=1`;
      return;
    }

    if (column.requiresForecast) {
      if (!deal.company.gstNumber || !deal.company.billingAddress) {
        setNeedsInfo({ deal, columnId: column.id });
        return;
      }
    }

    try {
      await api.deals.moveStage(deal.id, column.id);
      await load();
    } catch (e) {
      // The server reports every missing field at once, so the person is told
      // everything they need rather than one thing per attempt.
      if (e instanceof ApiError && e.fieldErrors.length) {
        setError(e.fieldErrors.map((f) => f.message).join(' '));
      } else {
        setError(e instanceof Error ? e.message : 'Could not move the deal');
      }
      await load();
    }
  };

  if (loading) return <PageSkeleton />;

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';

  const openDeals = columns
    .filter((c) => c.kind === 'OPEN')
    .reduce((n, c) => n + c.deals.length, 0);

  return (
    <>
      <PageHeader 
        title="Pipeline" 
        subtitle={`${openDeals} open deals`} 
        action={<Button variant="primary" onClick={() => setCreating(true)}>New Deal</Button>}
      />

      {/*
        A refused move is a rule, not a failure — the server names every missing
        field at once so the person is told everything they need.
      */}
      {error && (
        <div className="mb-4">
          <Note tone="warn">
            {error}{' '}
            <button onClick={() => setError(null)} className="font-medium underline">
              Dismiss
            </button>
          </Note>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {columns.map((column) => (
          <div
            key={column.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragging && drop(dragging, column)}
            className="flex w-72 shrink-0 flex-col rounded-card border border-border bg-surface max-h-[calc(100vh-220px)]"
          >
            <div className="border-b border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">{column.name}</span>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs tabular-nums text-secondary">
                  {column.deals.length}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-secondary">
                <span className="tabular-nums">{formatMoney(column.total, currency, locale)}</span>
                {column.requiresForecast && (
                  <span title="A deal needs a value and a close date to enter this stage">
                    · needs a forecast
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-2 overflow-y-auto">
              {column.deals.map((deal) => (
                <article
                  key={deal.id}
                  draggable
                  onDragStart={() => setDragging(deal)}
                  onDragEnd={() => setDragging(null)}
                  className={`cursor-grab rounded-xl border bg-white p-3 hover:border-primary transition-colors active:cursor-grabbing ${
                    deal.isRotting ? 'border-amber-300' : 'border-border'
                  }`}
                >
                  <Link href={`/pipeline/${deal.id}`} className="block">
                    <p className="inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[13px] font-semibold text-blue-700 border border-blue-100 mb-1">{deal.company.name}</p>
                    <p className="mt-0.5 text-xs text-secondary">{deal.title ?? 'Untitled deal'}</p>
                  </Link>

                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-semibold tabular-nums text-primary">
                      {formatMoney(deal.value, currency, locale)}
                    </span>
                    {deal.owner && (
                      <span
                        title={deal.owner.name}
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${getAvatarColor(deal.owner.name)}`}
                      >
                        {getInitials(deal.owner.name)}
                      </span>
                    )}
                  </div>

                  {/*
                    The two stall signals, on the card rather than only in an
                    overnight scan. The thresholds already existed and were
                    scanned daily but never shown (§1.3 ⑧).
                  */}
                  {(deal.isRotting || deal.blockedOn || deal.isOnHold) && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      {deal.isOnHold && (
                        <p className="flex items-center gap-1 text-[11px] text-secondary">
                          <Pause className="h-3 w-3" />
                          Parked{deal.holdReason ? ` — ${deal.holdReason}` : ''}
                        </p>
                      )}
                      {deal.isRotting && !deal.isOnHold && (
                        <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                          <Clock className="h-3 w-3" />
                          {deal.daysInStage} days in {column.name}
                        </p>
                      )}
                      {deal.blockedOn && (
                        <p className="text-[11px] text-secondary">Waiting on: {deal.blockedOn}</p>
                      )}
                    </div>
                  )}
                </article>
              ))}

              {column.deals.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-secondary">Nothing here</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {winning && (
        <WinDealDialog
          dealId={winning.id}
          dealTitle={winning.title ?? 'Untitled deal'}
          companyName={winning.company.name}
          defaults={winning.value ? { amount: winning.value } : undefined}
          onClose={() => setWinning(null)}
          onWon={() => {
            setWinning(null);
            void load();
          }}
        />
      )}

      {creating && (
        <NewDealModal 
          onConfirm={(deal) => {
            setCreating(false);
            window.location.href = `/pipeline/${deal.id}`;
          }} 
          onCancel={() => setCreating(false)} 
        />
      )}

      {needsInfo && (
        <ExtendedCompanyInfoModal
          company={needsInfo.deal.company as any}
          onConfirm={async (updated) => {
            const { deal, columnId } = needsInfo;
            setNeedsInfo(null);
            
            // Proceed with moving the deal now that company info is updated
            try {
              await api.deals.moveStage(deal.id, columnId);
              await load();
            } catch (e: any) {
              setError(e.message || 'Could not move the deal');
            }
          }}
          onCancel={() => setNeedsInfo(null)}
        />
      )}
    </>
  );
}
