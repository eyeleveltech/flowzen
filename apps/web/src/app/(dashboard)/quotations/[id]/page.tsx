'use client';

/**
 * One deal's proposal: the document, its price, its versions.
 * (AI Proposal Builder, phases 1 and 2.)
 *
 * The text is anyone's on the deal to write, by hand or with the AI. The price
 * is Management's: the Pricing tab, the floor override and Finalise. "Send for
 * review" hands a draft to Management; they finalise it or send it back. A
 * final version is locked and its PDF and Word file kept exactly; a change is
 * a new version. "Mark as sent" records the version on the pipeline, as adding
 * one by hand always has.
 */

import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Copy, CornerUpLeft, Download, FileText, ListOrdered, ReceiptText, Send, Sparkles, Trash2, UserCheck } from 'lucide-react';
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
  type ProposalLayout,
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
import { AiPanel } from '@/components/proposals/AiPanel';
import { CompareView } from '@/components/proposals/CompareView';
import { useConfirmStore } from '@/stores/confirm';
import { usePageHeader } from '@/hooks/usePageHeader';

type TabKey = 'DOCUMENT' | 'PRICING' | 'VERSIONS';

const statusOf = (d: { status: string; sentAt: string | null }): { label: string; tone: Tone } =>
  d.sentAt
    ? { label: 'Sent', tone: 'info' }
    : d.status === 'FINAL'
      ? { label: 'Final', tone: 'good' }
      : d.status === 'IN_REVIEW'
        ? { label: 'In review', tone: 'review' }
        : { label: 'Draft', tone: 'warn' };

const LAYOUTS: { key: ProposalLayout; label: string; hint: string }[] = [
  { key: 'MINIMAL', label: 'Minimal', hint: 'Most proposals' },
  { key: 'PREMIUM', label: 'Premium', hint: 'Larger deals' },
  { key: 'COMPACT', label: 'Compact', hint: 'One page, small jobs' },
];

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
  const [sendingBack, setSendingBack] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [fromProforma, setFromProforma] = useState(false);
  // The Document tab's left side: the sections by hand, or the AI.
  const [mode, setMode] = useState<'SECTIONS' | 'AI'>('SECTIONS');

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

  const start = async (withAi = false, proformaId?: string) => {
    setStarting(true);
    try {
      const res = await api.proposalDocs.start(id, proformaId ? { proformaId } : {});
      await loadDeal();
      setMode(withAi ? 'AI' : 'SECTIONS');
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

  const sendForReview = async (docIdToSend: string) => {
    setReviewing(true);
    try {
      changed(await api.proposalDocs.sendForReview(docIdToSend));
      toast.success('Sent to Management for review');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send it for review.');
    } finally {
      setReviewing(false);
    }
  };

  const setLayout = async (docIdToSet: string, layout: ProposalLayout) => {
    try {
      changed(await api.proposalDocs.save(docIdToSet, { layout }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not change the layout.');
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
  const openDraft = documents.find((d) => d.status === 'DRAFT' || d.status === 'IN_REVIEW');
  const closed = Boolean(proposal.outcome);
  const status = doc ? statusOf(doc) : null;
  // A draft is anyone's to change; one in review is Management's; a final is nobody's.
  const editable = Boolean(doc) && (doc!.status === 'DRAFT' || (doc!.status === 'IN_REVIEW' && deal.canPrice));

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
            <a href={api.proposalDocs.docxUrl(doc.id)} className={buttonClass('ghost')}>
              <FileText className="h-4 w-4" /> Word
            </a>
            {doc.status === 'DRAFT' && !closed && (
              <Button icon={UserCheck} onClick={() => void sendForReview(doc.id)} loading={reviewing}>
                Send for review
              </Button>
            )}
            {doc.status === 'IN_REVIEW' && deal.canPrice && (
              <Button icon={CornerUpLeft} onClick={() => setSendingBack(true)}>
                Send back
              </Button>
            )}
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
              : 'Write it with the AI, or start from the standard sections with the studio terms filled in. Management adds the prices.'
          }
          action={
            !closed && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={Sparkles} onClick={() => void start(true)} loading={starting}>
                  Write with AI
                </Button>
                <Button onClick={() => void start(false)} disabled={starting}>
                  Start blank
                </Button>
                <Button icon={ReceiptText} onClick={() => setFromProforma(true)} disabled={starting}>
                  Start from a proforma
                </Button>
              </div>
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
                {doc.status === 'IN_REVIEW' && (
                  <p className="mb-4 rounded-xl border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-body">
                    With Management for review{doc.review?.by ? `, sent by ${doc.review.by}` : ''}.{' '}
                    {deal.canPrice ? 'Price it, then finalise or send it back.' : 'They price it and finalise it, or send it back to you.'}
                  </p>
                )}
                {doc.status === 'DRAFT' && doc.reviewNote && (
                  <p className="mb-4 rounded-xl border border-warning/40 bg-warning-tint px-3 py-2.5 text-xs text-body">
                    <span className="font-semibold">Sent back by Management:</span> {doc.reviewNote}
                  </p>
                )}
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
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex rounded-xl bg-subtle p-1" role="tablist" aria-label="How to write">
                    {(
                      [
                        ['SECTIONS', 'Sections', ListOrdered],
                        ['AI', 'Write with AI', Sparkles],
                      ] as const
                    ).map(([key, label, Icon]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={mode === key}
                        onClick={() => setMode(key)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          mode === key ? 'bg-white font-semibold text-primary shadow-sm' : 'text-secondary hover:text-primary'
                        }`}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-secondary">
                    Layout
                    <select
                      value={doc.layout}
                      onChange={(e) => void setLayout(doc.id, e.target.value as ProposalLayout)}
                      disabled={!editable}
                      className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-body outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:bg-subtle"
                    >
                      {LAYOUTS.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.label} · {l.hint}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {mode === 'AI' ? (
                  <AiPanel doc={doc} editable={editable} canPrice={deal.canPrice} onChanged={changed} />
                ) : (
                  <SectionEditor key={doc.id} doc={doc} editable={editable} onSaved={changed} />
                )}
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
              key={`${doc.id}:${doc.status}:${doc.updatedAt}`}
              doc={doc}
              companyId={proposal.company.id}
              companyName={proposal.company.name}
              price={current?.price}
              problems={current?.problems ?? []}
              pricing={current?.pricing}
              onChanged={changed}
            />
          ) : (
            <>
              <VersionsList deal={deal} activeId={docId} onOpen={openDoc} onDiscard={(d) => void discard(d)} />
              {documents.length > 1 && (
                <section className="mt-8">
                  <h2 className="mb-3 text-base font-semibold text-primary">Compare versions</h2>
                  <CompareView proposalId={id} documents={documents} />
                </section>
              )}
            </>
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
      {fromProforma && (
        <StartFromProformaModal
          companyId={proposal.company.id}
          onClose={() => setFromProforma(false)}
          onPick={(proformaId) => {
            setFromProforma(false);
            void start(false, proformaId);
          }}
        />
      )}
      {sendingBack && doc && (
        <SendBackModal
          docId={doc.id}
          n={doc.n}
          onClose={() => setSendingBack(false)}
          onDone={(res) => {
            setSendingBack(false);
            changed(res);
            toast.success('Sent back to the writer');
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

function SendBackModal({
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
      onDone(await api.proposalDocs.sendBack(docId, note.trim()));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send it back.');
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Send v${n} back`} description="It goes back to a draft the writer can change. Your note is shown at the top of it.">
      <ModalBody>
        <Field label="What needs changing" textarea rows={3} value={note} onChange={setNote} placeholder="e.g. Tighten the scope to two services and add the shoot days" required />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={CornerUpLeft} onClick={() => void submit()} loading={saving} disabled={note.trim().length < 3}>
          Send back
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Start v1 from one of the client's proformas: its lines become the Pricing
 * tab's, its terms the Terms section. The proforma itself is only read.
 */
function StartFromProformaModal({
  companyId,
  onClose,
  onPick,
}: {
  companyId: string;
  onClose: () => void;
  onPick: (proformaId: string) => void;
}) {
  const query = useQuery({
    queryKey: ['proformas', 'company', companyId],
    queryFn: () => api.proformas.list({ companyId }),
  });
  const rows = (query.data?.proformas ?? []).filter((pf: { status: string }) => pf.status !== 'CANCELLED') as {
    id: string;
    number: string;
    status: string;
    amount: number | string | null;
    description?: string | null;
    raisedAt?: string | null;
    createdAt: string;
  }[];
  return (
    <Modal open onClose={onClose} title="Start from a proforma" description="Its lines go on the Pricing tab and its terms into Terms. The proforma is not changed.">
      <ModalBody>
        {query.isPending ? (
          <p className="text-sm text-secondary">Loading this client&apos;s proformas…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-secondary">This client has no proformas to start from.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((pf) => (
              <li key={pf.id}>
                <button
                  type="button"
                  onClick={() => onPick(pf.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-primary">{pf.number}</span>
                    <span className="block truncate text-xs text-secondary">
                      {formatDate(pf.raisedAt ?? pf.createdAt)}
                      {pf.description ? ` · ${pf.description}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">{pf.amount == null ? '' : formatMoney(pf.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}
