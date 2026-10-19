'use client';

/**
 * One deal's proposal: the document, its price, its versions.
 * (AI Proposal Builder, phase 1 — written by hand.)
 *
 * The text is anyone's on the deal to write. The price is Management's: the
 * Pricing tab, the floor override and Finalise. A final version is locked and
 * its PDF kept exactly; a change is a new version. "Mark as sent" records the
 * version on the pipeline, as adding one by hand always has.
 */

import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Copy, Download, FileText, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { STAGE_LABEL } from '@flowzen/shared';
import {
  api,
  ApiError,
  formatDate,
  formatMoney,
  type ProposalDealDocs,
  type ProposalDocResponse,
  type ProposalDocSummary,
} from '@/lib/api-v2';
import { Button, buttonClass } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/empty-state';
import { NotFoundPanel } from '@/components/ui/not-found-panel';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { NextStepFields, nextStepBody, nextStepDraft, nextStepOk, useStudioToday } from '@/components/sales/NextStep';
import { SectionEditor } from '@/components/proposals/SectionEditor';
import { PricingPanel } from '@/components/proposals/PricingPanel';
import { useConfirmStore } from '@/stores/confirm';
import { usePageHeader } from '@/hooks/usePageHeader';

type TabKey = 'DOCUMENT' | 'PRICING' | 'VERSIONS';

const statusOf = (d: { status: string; sentAt: string | null }): { label: string; tone: Tone } =>
  d.sentAt ? { label: 'Sent', tone: 'info' } : d.status === 'FINAL' ? { label: 'Final', tone: 'good' } : { label: 'Draft', tone: 'warn' };

export default function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const confirm = useConfirmStore((s) => s.confirm);

  const qc = useQueryClient();
  const [previewTick, setPreviewTick] = useState(0);
  const [starting, setStarting] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const [sending, setSending] = useState(false);

  const dealQuery = useQuery({ queryKey: ['proposal-docs', id], queryFn: () => api.proposalDocs.forDeal(id) });
  const deal: ProposalDealDocs | null = dealQuery.data ?? null;
  const loadDeal = useCallback(() => dealQuery.refetch(), [dealQuery]);

  usePageHeader('Proposal', deal?.proposal.company.name ?? null);

  const wanted = search.get('doc');
  const docId = deal ? (deal.documents.find((d) => d.id === wanted)?.id ?? deal.documents[0]?.id ?? null) : null;

  const docQuery = useQuery({
    queryKey: ['proposal-doc', docId],
    queryFn: () => api.proposalDocs.get(docId!),
    enabled: Boolean(docId),
  });
  const current: ProposalDocResponse | null = docQuery.data ?? null;

  // Asked again after every save, so the preview follows the editor.
  const previewQuery = useQuery({
    queryKey: ['proposal-preview', docId, previewTick],
    queryFn: () => api.proposalDocs.preview(docId!),
    enabled: Boolean(docId),
    placeholderData: keepPreviousData,
  });
  const preview = previewQuery.data?.html ?? null;

  const tabs: TabDef<TabKey>[] = [
    { key: 'DOCUMENT', label: 'Document' },
    { key: 'PRICING', label: 'Pricing', visible: Boolean(deal?.canPrice) },
    { key: 'VERSIONS', label: 'Versions', count: deal?.documents.length },
  ];
  const [tab, setTab] = useTabState(tabs);

  const openDoc = (docIdToOpen: string) => {
    const next = new URLSearchParams(search.toString());
    next.set('doc', docIdToOpen);
    router.replace(`/quotations/${id}?${next}`, { scroll: false });
  };

  /** A save anywhere: the document, the version list, and the preview. */
  const changed = useCallback(
    (res: ProposalDocResponse) => {
      qc.setQueryData(['proposal-doc', res.document.id], res);
      setPreviewTick((n) => n + 1);
      void qc.invalidateQueries({ queryKey: ['proposal-docs', id] });
    },
    [qc, id],
  );

  const start = async () => {
    setStarting(true);
    try {
      const res = await api.proposalDocs.start(id);
      await loadDeal();
      openDoc(res.document.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start the proposal.');
    } finally {
      setStarting(false);
    }
  };

  const discard = async (d: ProposalDocSummary) => {
    const ok = await confirm({
      title: `Discard v${d.n}?`,
      message: 'The draft and its pricing are deleted. Final versions are kept.',
      confirmText: 'Discard draft',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.proposalDocs.discard(d.id);
      toast.success(`v${d.n} discarded`);
      const next = new URLSearchParams(search.toString());
      next.delete('doc');
      router.replace(`/quotations/${id}?${next}`, { scroll: false });
      await loadDeal();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not discard it.');
    }
  };

  if (dealQuery.error) {
    return (
      <NotFoundPanel thing="proposal" error={dealQuery.error} back={{ href: '/quotations', label: 'Back to Proposals' }} onRetry={() => void loadDeal()} />
    );
  }
  if (!deal) return <PageSkeleton />;

  const { proposal, documents } = deal;
  const doc = current?.document.id === docId ? current.document : null;
  const openDraft = documents.find((d) => d.status === 'DRAFT');
  const closed = Boolean(proposal.outcome);
  const status = doc ? statusOf(doc) : null;

  return (
    <>
      <Link href="/quotations" className="mb-4 inline-flex items-center gap-1.5 text-sm text-secondary transition-colors hover:text-primary">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Proposals
      </Link>

      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-primary">{proposal.company.name}</h1>
            <Badge tone="info">{proposal.kind === 'RETAINER' ? 'Retainer' : 'One time'}</Badge>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary">
            {doc && <span className="font-mono text-xs text-body">{doc.ref}</span>}
            <span>· {STAGE_LABEL[proposal.stage as keyof typeof STAGE_LABEL] ?? proposal.stage}</span>
            <span>· owner {proposal.owner.name}</span>
            <Link href={`/companies/${proposal.company.id}`} className="hover:underline">
              · client record
            </Link>
          </div>
        </div>

        {doc && (
          <div className="flex flex-wrap items-center gap-2">
            <a href={api.proposalDocs.pdfUrl(doc.id)} className={buttonClass('ghost')}>
              <Download className="h-4 w-4" /> {doc.status === 'FINAL' ? 'PDF' : 'Draft PDF'}
            </a>
            {doc.status === 'FINAL' && !doc.sentAt && !closed && (
              <Button variant="primary" icon={Send} onClick={() => setSending(true)}>
                Mark as sent
              </Button>
            )}
            {!openDraft && !closed && (
              <Button icon={Copy} onClick={() => setVersioning(true)}>
                New version
              </Button>
            )}
          </div>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No proposal written yet"
          hint={
            closed
              ? 'This deal is closed.'
              : 'Start one: the sections are laid out with the studio terms filled in. Management adds the prices.'
          }
          action={
            !closed && (
              <Button variant="primary" onClick={() => void start()} loading={starting}>
                Start the proposal
              </Button>
            )
          }
        />
      ) : (
        <>
          <VersionStrip documents={documents} activeId={docId} onOpen={openDoc} />
          <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-5" />

          {!doc ? (
            <PageSkeleton />
          ) : tab === 'DOCUMENT' ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                {doc.status === 'FINAL' && (
                  <p className="mb-4 rounded-xl bg-subtle px-3 py-2.5 text-xs text-secondary">
                    v{doc.n} is final{doc.finalisedBy ? `, by ${doc.finalisedBy}` : ''}
                    {doc.finalisedAt ? ` on ${formatDate(doc.finalisedAt, undefined, undefined, true)}` : ''}. It is locked. Start a new version to change it.
                  </p>
                )}
                {doc.revisionNote && (
                  <p className="mb-4 text-xs text-secondary">
                    <span className="font-semibold text-body">Why this version:</span> {doc.revisionNote}
                  </p>
                )}
                <SectionEditor key={doc.id} doc={doc} editable={doc.status === 'DRAFT'} onSaved={changed} />
              </div>
              <div className="xl:sticky xl:top-4 xl:self-start">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="eyebrow text-secondary">Preview</h2>
                  {!deal.canPrice && doc.status !== 'FINAL' && (
                    <span className="text-micro text-secondary">Prices appear once Management adds them.</span>
                  )}
                </div>
                {preview ? (
                  <iframe
                    title={`Preview of ${doc.ref}`}
                    srcDoc={preview}
                    sandbox=""
                    className="h-[78vh] w-full rounded-2xl border border-border bg-white"
                  />
                ) : (
                  <div className="flex h-[40vh] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-secondary">
                    Loading the preview…
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'PRICING' && deal.canPrice ? (
            <PricingPanel
              key={`${doc.id}:${doc.status}`}
              doc={doc}
              price={current?.price}
              problems={current?.problems ?? []}
              pricing={current?.pricing}
              onChanged={changed}
            />
          ) : (
            <VersionsList deal={deal} activeId={docId} onOpen={openDoc} onDiscard={(d) => void discard(d)} />
          )}
        </>
      )}

      {versioning && doc && (
        <NewVersionModal
          docId={doc.id}
          n={doc.n}
          onClose={() => setVersioning(false)}
          onDone={async (res) => {
            setVersioning(false);
            await loadDeal();
            openDoc(res.document.id);
          }}
        />
      )}
      {sending && doc && (
        <MarkSentModal
          docId={doc.id}
          refLabel={doc.ref}
          onClose={() => setSending(false)}
          onDone={async () => {
            setSending(false);
            await loadDeal();
            void qc.invalidateQueries({ queryKey: ['proposal-doc', doc.id] });
          }}
        />
      )}
    </>
  );
}

function VersionStrip({
  documents,
  activeId,
  onOpen,
}: {
  documents: ProposalDocSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  if (documents.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2" role="list" aria-label="Versions">
      {documents.map((d) => {
        const s = statusOf(d);
        const active = d.id === activeId;
        return (
          <button
            key={d.id}
            type="button"
            role="listitem"
            onClick={() => onOpen(d.id)}
            aria-current={active ? 'true' : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              active ? 'border-primary bg-primary text-white' : 'border-border bg-white text-body hover:border-primary/40'
            }`}
          >
            <span className="font-semibold">v{d.n}</span>
            <span className={active ? 'text-white/80' : 'text-secondary'}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function VersionsList({
  deal,
  activeId,
  onOpen,
  onDiscard,
}: {
  deal: ProposalDealDocs;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDiscard: (d: ProposalDocSummary) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <ol className="space-y-3">
        {deal.documents.map((d) => {
          const s = statusOf(d);
          return (
            <li key={d.id} className={`rounded-2xl border bg-white p-4 ${d.id === activeId ? 'border-primary/50' : 'border-border'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-primary">v{d.n}</span>
                  <span className="font-mono text-xs text-secondary">{d.ref}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)}>
                    Open
                  </Button>
                  <a href={api.proposalDocs.pdfUrl(d.id)} className={buttonClass('ghost', 'sm')} aria-label={`Download v${d.n} as PDF`}>
                    <Download className="h-4 w-4" />
                  </a>
                  {d.status === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={() => onDiscard(d)}
                      aria-label={`Discard v${d.n}`}
                      className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-secondary">
                Started {formatDate(d.createdAt)}
                {d.createdBy ? ` by ${d.createdBy}` : ''}
                {d.finalisedAt ? ` · final ${formatDate(d.finalisedAt)}` : ''}
                {d.sentAt ? ` · sent ${formatDate(d.sentAt)}` : ''}
              </p>
              {d.revisionNote && <p className="mt-1.5 text-sm text-body">{d.revisionNote}</p>}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-border bg-white p-4">
        <h3 className="eyebrow text-secondary">On the pipeline</h3>
        <p className="mt-1 text-xs text-secondary">What was sent, as the pipeline counts it.</p>
        {deal.versions.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">Nothing sent yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {deal.versions.map((v) => (
              <li key={v.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-primary">Version {v.n}</p>
                  <p className="truncate text-xs text-secondary">
                    {formatDate(v.sentAt)}
                    {v.fromDocument ? ` · from document v${v.fromDocument.n}` : ' · logged by hand'}
                  </p>
                </div>
                {v.value !== undefined && <span className="shrink-0 font-semibold tabular-nums text-primary">{formatMoney(v.value)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewVersionModal({
  docId,
  n,
  onClose,
  onDone,
}: {
  docId: string;
  n: number;
  onClose: () => void;
  onDone: (res: ProposalDocResponse) => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      onDone(await api.proposalDocs.newVersion(docId, note.trim()));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start a new version.');
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`New version from v${n}`} description="A copy of the text and the prices, as a draft you can change.">
      <ModalBody>
        <Field label="Why this version" textarea rows={3} value={note} onChange={setNote} placeholder="e.g. Client asked for a three-month option" hint="Optional. Shown on the version." />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} loading={saving}>Start v{n + 1}</Button>
      </ModalFooter>
    </Modal>
  );
}

function MarkSentModal({
  docId,
  refLabel,
  onClose,
  onDone,
}: {
  docId: string;
  refLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = useStudioToday();
  const [step, setStep] = useState(nextStepDraft());
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.proposalDocs.markSent(docId, nextStepBody(step));
      toast.success(`Sent: version ${res.version.n} is on the pipeline`);
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not mark it as sent.');
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Mark ${refLabel} as sent`} description="Records it on the pipeline as a sent version, at the fee in this document.">
      <ModalBody>
        <NextStepFields value={step} onChange={setStep} />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={Send} onClick={() => void submit()} loading={saving} disabled={!nextStepOk(step, today)}>
          Mark as sent
        </Button>
      </ModalFooter>
    </Modal>
  );
}
