'use client';

/**
 * One piece of kit.
 *
 * The chain of custody is the reason this page exists. Everything above it —
 * the specs, the money, the warranty — is a record you consult twice a year.
 * The timeline is what you read when a lens goes missing, and it is why every
 * hand-over is one row with a condition going out and a condition coming back:
 * "it was fine when Dave took it and cracked when it came back" is a sentence
 * the register can produce, and a WhatsApp thread cannot.
 *
 * Which buttons appear comes from the server's `access.canManage`, not from the
 * client re-deriving it out of `user.permissions`. Two copies of a permission
 * decision are two things to keep in step, which is the failure the sidebar
 * rewrite was about.
 */

import { useCallback, useEffect, useState } from 'react';
import { plural } from '@/lib/utils';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, LogIn, LogOut, Package, Trash2, Wrench } from 'lucide-react';
import {
  api,
  ApiError,
  type AssetAccess,
  type AssetDetail,
  type AssetMovementRow,
} from '@/lib/api-v2';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { NotFoundPanel } from '@/components/ui/not-found-panel';
import { IssueModal, CheckInModal, type IssueMode } from '@/components/assets/IssueModal';
import { StatTile } from '@/components/ui/stat-tile';
import {
  RetireModal,
  MaintenanceModal,
  CloseMaintenanceModal,
} from '@/components/assets/RetireModal';
import {
  assetCategoryLabel,
  assetStatusLabel,
  assetTone,
  dueLabel,
  rupees,
  shortDate,
} from '@/lib/assets';

type Dialog =
  | { kind: 'issue'; mode: IssueMode }
  | { kind: 'checkin' }
  | { kind: 'retire' }
  | { kind: 'repair' }
  | { kind: 'closeRepair'; maintenanceId: string }
  | null;

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [access, setAccess] = useState<AssetAccess>({ canManage: false, canSeeFigures: false });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.assets.get(id);
      setAsset(res.data);
      setAccess(res.access);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof Error ? e.message : 'Could not load this item');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  usePageHeader(asset?.name ?? 'Asset', asset?.tag ?? '');

  if (notFound) {
    return (
      <NotFoundPanel
        title="No such item"
        message="It may have been removed from the register."
        backHref="/assets"
        backLabel="Back to the register"
      />
    );
  }

  if (loading || !asset) {
    return <p className="px-5 py-16 text-center text-sm text-secondary">Loading…</p>;
  }

  const isClosed = ['RETIRED', 'SOLD', 'LOST'].includes(asset.status);
  const isOut = Boolean(asset.openMovement);
  const openRepair = asset.maintenance.find((m) => !m.returnedAt) ?? null;
  const label = `${asset.tag} — ${asset.name}`;

  const remove = async () => {
    if (!confirm(`Remove ${asset.tag} from the register? It goes to Trash and can be restored.`)) return;
    try {
      await api.assets.remove(asset.id);
      router.push('/assets');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove it');
    }
  };

  return (
    <div className="page-shell">
      <Link
        href="/assets"
        className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-secondary transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> The register
      </Link>

      {error && (
        <div className="mb-5">
          <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        </div>
      )}

      {/* Hero: what it is on the left, what you can do with it on the right. */}
      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-white p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{asset.name}</h1>
            <Badge tone={assetTone(asset.status)}>{assetStatusLabel(asset.status)}</Badge>
            {asset.fullyDepreciated && !isClosed && <Badge tone="neutral">Due for replacement</Badge>}
            {asset.bookable && <Badge tone="neutral">Goes on shoots</Badge>}
          </div>
          <p className="mt-1.5 text-xs text-secondary">
            <span className="font-mono">{asset.tag}</span> · {assetCategoryLabel(asset.category)}
            {asset.make ? ` · ${asset.make}` : ''}
            {asset.model ? ` ${asset.model}` : ''}
          </p>
          {asset.openMovement && (
            <p className={`mt-2 text-sm ${asset.openMovement.overdue ? 'text-danger' : 'text-body'}`}>
              With <span className="font-semibold">{asset.openMovement.user.name}</span> since{' '}
              {shortDate(asset.openMovement.outAt)}
              {asset.openMovement.dueAt ? `, ${dueLabel(asset.openMovement.dueAt)}` : ' — no due date'}
              {asset.openMovement.purpose ? ` · ${asset.openMovement.purpose}` : ''}
            </p>
          )}
        </div>

        {access.canManage && !isClosed && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isOut && asset.status !== 'IN_REPAIR' && (
              <>
                <Button size="sm" icon={LogOut} onClick={() => setDialog({ kind: 'issue', mode: 'CHECKOUT' })}>
                  Check out
                </Button>
                <Button size="sm" onClick={() => setDialog({ kind: 'issue', mode: 'ASSIGN' })}>
                  Assign
                </Button>
              </>
            )}
            {isOut && (
              <>
                <Button size="sm" variant="primary" icon={LogIn} onClick={() => setDialog({ kind: 'checkin' })}>
                  Check in
                </Button>
                <Button
                  size="sm"
                  icon={ArrowLeftRight}
                  onClick={() => setDialog({ kind: 'issue', mode: 'TRANSFER' })}
                >
                  Hand on
                </Button>
              </>
            )}
            {openRepair ? (
              <Button
                size="sm"
                variant="primary"
                icon={Wrench}
                onClick={() => setDialog({ kind: 'closeRepair', maintenanceId: openRepair.id })}
              >
                Back from repair
              </Button>
            ) : (
              !isOut && (
                <Button size="sm" icon={Wrench} onClick={() => setDialog({ kind: 'repair' })}>
                  Repair
                </Button>
              )
            )}
            {!isOut && (
              <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'retire' })}>
                Retire
              </Button>
            )}
            <Button size="sm" variant="danger" icon={Trash2} onClick={remove} aria-label="Remove from the register" />
          </div>
        )}
      </div>

      {isClosed && (
        <div className="mb-6">
          <Note>
            {assetStatusLabel(asset.status)} on {shortDate(asset.disposedAt)}
            {asset.disposalNote ? ` — ${asset.disposalNote}` : ''}
            {access.canSeeFigures && asset.disposalValue != null
              ? `. It fetched ${rupees(asset.disposalValue)}.`
              : ''}{' '}
            It stays on the register so the history survives it.
          </Note>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* The chain of custody — the reason this page exists. */}
          <Card padding="none">
            <CardHeader>
              <CardTitle>Chain of custody</CardTitle>
              <span className="eyebrow">
                {asset.movements.length} hand-over{asset.movements.length === 1 ? '' : 's'}
              </span>
            </CardHeader>
            <CardBody>
              {asset.movements.length === 0 ? (
                <p className="text-sm text-secondary">
                  Nobody has taken this out yet. It has been in the office since it was entered.
                </p>
              ) : (
                <ol className="space-y-4">
                  {asset.movements.map((m) => (
                    <MovementRow key={m.id} movement={m} />
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <Card padding="none">
            <CardHeader>
              <CardTitle>Repairs and servicing</CardTitle>
            </CardHeader>
            <CardBody>
              {asset.maintenance.length === 0 ? (
                <p className="text-sm text-secondary">Nothing has gone wrong with it yet.</p>
              ) : (
                <ul className="space-y-3">
                  {asset.maintenance.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm text-primary">
                          {m.kind.toLowerCase()} at {m.vendor ?? 'an unnamed shop'}
                        </p>
                        <p className="text-micro text-secondary">
                          Sent {shortDate(m.sentAt)}
                          {m.returnedAt ? ` · back ${shortDate(m.returnedAt)}` : ' · still there'}
                          {m.notes ? ` · ${m.notes}` : ''}
                        </p>
                      </div>
                      {access.canSeeFigures && m.amount != null && (
                        <span className="text-sm tabular-nums text-primary">{rupees(m.amount)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card padding="none">
            <CardHeader>
              <CardTitle>Specs</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-2.5">
                <Row label="Make">{asset.make ?? '—'}</Row>
                <Row label="Model">{asset.model ?? '—'}</Row>
                <Row label="Serial">
                  {asset.serialNumber ? <span className="font-mono text-xs">{asset.serialNumber}</span> : '—'}
                </Row>
                <Row label="Condition">{asset.condition.toLowerCase()}</Row>
                <Row label="Warranty">{shortDate(asset.warrantyUntil)}</Row>
                <Row label="Insured to">{shortDate(asset.insuredUntil)}</Row>
              </dl>
              {(asset.billUrl || asset.photoUrl) && (
                <div className="mt-4 flex gap-3 border-t border-border pt-3">
                  {asset.billUrl && (
                    <a href={asset.billUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline">
                      Bill
                    </a>
                  )}
                  {asset.photoUrl && (
                    <a href={asset.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline">
                      Photo
                    </a>
                  )}
                </div>
              )}
              {asset.notes && <p className="mt-4 border-t border-border pt-3 text-xs text-secondary">{asset.notes}</p>}
            </CardBody>
          </Card>

          {access.canSeeFigures ? (
            <Card padding="none">
              <CardHeader>
                <CardTitle>Money</CardTitle>
              </CardHeader>
              <CardBody>
                <StatTile
                  frame="none"
                  label="Worth today"
                  value={rupees(asset.bookValue)}
                  note={
                    asset.fullyDepreciated
                      ? 'Fully written off — it sits at salvage value now'
                      : `falling ${rupees(asset.monthlyDepreciation)} a month`
                  }
                />
                <dl className="mt-4 space-y-2.5 border-t border-border pt-3">
                  <Row label="Cost">{rupees(asset.purchasePrice)}</Row>
                  <Row label="Bought">{shortDate(asset.purchasedAt)}</Row>
                  <Row label="From">{asset.vendor ?? '—'}</Row>
                  <Row label="Their bill">{asset.invoiceNumber ?? '—'}</Row>
                  <Row label="Written off over">{plural(asset.usefulLifeMonths, 'month')}</Row>
                  <Row label="Left at the end">{rupees(asset.salvageValue)}</Row>
                </dl>
                {asset.costId && (
                  <p className="mt-3 border-t border-border pt-3 text-micro text-secondary">
                    Linked to the capital cost row in Money, so the amount is recorded once.
                  </p>
                )}
              </CardBody>
            </Card>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface p-5">
              <p className="eyebrow">Money</p>
              <p className="mt-2 text-sm text-secondary">
                What it cost and what it is worth are hidden. Where it is and who has had it are not —
                that part is yours to see.
              </p>
            </div>
          )}
        </div>
      </div>

      {dialog?.kind === 'issue' && (
        <IssueModal
          open
          mode={dialog.mode}
          assetId={asset.id}
          assetLabel={label}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'checkin' && (
        <CheckInModal
          open
          assetId={asset.id}
          assetLabel={label}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'retire' && (
        <RetireModal
          open
          assetId={asset.id}
          assetLabel={label}
          canSeeFigures={access.canSeeFigures}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'repair' && (
        <MaintenanceModal
          open
          assetId={asset.id}
          assetLabel={label}
          canSeeFigures={access.canSeeFigures}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'closeRepair' && (
        <CloseMaintenanceModal
          open
          assetId={asset.id}
          maintenanceId={dialog.maintenanceId}
          assetLabel={label}
          canSeeFigures={access.canSeeFigures}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="eyebrow shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs text-body">{children}</dd>
    </div>
  );
}

/**
 * One hand-over.
 *
 * Condition out and condition in sit on the same line on purpose: the moment
 * they differ is the moment somebody needs to know, and putting them anywhere
 * else means comparing two rows to notice.
 */
function MovementRow({ movement: m }: { movement: AssetMovementRow }) {
  const changed = m.conditionIn && m.conditionIn !== m.conditionOut;
  return (
    <li className="border-l-2 border-border pl-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-primary">
          <span className="font-semibold">{m.user.name}</span>{' '}
          {m.kind === 'BOOKING' ? 'took it out' : 'was given it'}
          {m.returnedAt ? '' : ' — still with them'}
        </p>
        <span className="text-micro text-secondary">
          {shortDate(m.outAt)}
          {m.returnedAt ? ` → ${shortDate(m.returnedAt)}` : ''}
        </span>
      </div>
      <p className="mt-0.5 text-micro text-secondary">
        Issued by {m.issuedBy.name}
        {m.purpose ? ` · ${m.purpose}` : ''}
        {m.project ? ` · ${m.project.name}` : ''}
        {m.dueAt ? ` · was due ${shortDate(m.dueAt)}` : ''}
      </p>
      <p className={`mt-0.5 text-micro ${changed ? 'text-danger' : 'text-secondary'}`}>
        Out {m.conditionOut.toLowerCase()}
        {m.conditionIn ? ` · back ${m.conditionIn.toLowerCase()}` : ''}
        {changed ? ' — condition changed' : ''}
      </p>
      {m.notes && <p className="mt-0.5 text-micro text-secondary">{m.notes}</p>}
    </li>
  );
}
