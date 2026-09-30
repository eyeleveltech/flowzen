'use client';

/**
 * Task approval, in three pieces.
 *
 *   · `WhatsAppShare`   — "Send on WhatsApp" and "Copy message", after a task
 *                         is sent for approval.
 *   · `ApproveControls` — Approve, and Request changes with required feedback.
 *                         Used in the drawer and on every row of the
 *                         approver's queue on My Work.
 *   · `ApprovalSection` — the drawer's Approval block: send it, wait for it,
 *                         decide it, and every round so far.
 *   · `StuckApproval`   — the editor's side once nobody has answered: how
 *                         long, who it escalated to, and a nudge to the group.
 *
 * Approvers mostly open these on their phone from a WhatsApp link, so every
 * control stacks full width at phone size and only sits in a row from `sm` up.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, MessageCircle, RotateCcw, Send } from 'lucide-react';
import { api, ApiError, type TaskReviewRound, type TaskReviewsResponse } from '@/lib/api-v2';
import { Button, buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/empty-state';
import { useConfig } from '@/hooks/queries';
import { APPROVAL_QUEUE_KEY, approvalMessage, reminderMessage, whatsAppHref, whenDecided } from '@/lib/approvals';
import { cn } from '@/lib/utils';

// ── Share ────────────────────────────────────────────────────────────────────

export function WhatsAppShare({
  message,
  again = false,
  label,
}: {
  message: string;
  again?: boolean;
  /** In place of "Send on WhatsApp" — "Remind on WhatsApp", say. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // Older browsers and some in-app webviews: the textarea fallback.
      const el = document.createElement('textarea');
      el.value = message;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    toast.success('Message copied — paste it into the approvers’ group');
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {/* A real link the person clicks: WhatsApp opens its chat picker. */}
      <a
        href={whatsAppHref(message)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonClass(again ? 'secondary' : 'primary', 'md'), 'w-full gap-2 sm:w-auto')}
      >
        <MessageCircle className="h-4 w-4" strokeWidth={1.75} />
        {label ?? (again ? 'Share on WhatsApp again' : 'Send on WhatsApp')}
      </a>
      <Button variant="ghost" icon={copied ? Check : Copy} onClick={() => void copy()} className="w-full sm:w-auto">
        {copied ? 'Copied' : 'Copy message'}
      </Button>
    </div>
  );
}

// ── Stuck ────────────────────────────────────────────────────────────────────

/**
 * Nobody has answered: amber once the approvers have been reminded, red once
 * it has escalated. The editor gets no bell for this — this is how they know.
 */
export function StuckNote({
  waited,
  escalatedTo,
  compact = false,
}: {
  waited: string | null;
  /** Null until it has escalated; then who to (possibly nobody set). */
  escalatedTo: { id: string; name: string }[] | null;
  compact?: boolean;
}) {
  const size = compact ? 'text-micro' : 'text-sm';
  return (
    <div className="space-y-0.5">
      <p className={cn(size, 'font-semibold text-warning-ink')}>No answer{waited ? ` for ${waited}` : ' yet'}</p>
      {escalatedTo && (
        <p className={cn(size, 'font-semibold text-danger')}>
          {escalatedTo.length > 0 ? `Escalated to ${escalatedTo.map((p) => p.name).join(', ')}` : 'Escalated'}
        </p>
      )}
    </div>
  );
}

/**
 * The same, on a My Work row: the note and a small "Remind on WhatsApp" link.
 * The link is real (`<a target="_blank">`) and stops the click reaching the
 * row, which would open the drawer.
 */
export function StuckApproval({
  taskId,
  title,
  clientName,
  projectName,
  waited,
  escalatedTo,
}: {
  taskId: string;
  title: string;
  clientName: string | null;
  projectName: string | null;
  waited: string | null;
  escalatedTo: { id: string; name: string }[] | null;
}) {
  const message = reminderMessage({ title, clientName, projectName, waited: waited ?? 'a while', taskId });
  return (
    <div className="mt-1 space-y-1">
      <StuckNote waited={waited} escalatedTo={escalatedTo} compact />
      <a
        href={whatsAppHref(message)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-sm text-micro font-semibold text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
        Remind on WhatsApp
      </a>
    </div>
  );
}

// ── Decide ───────────────────────────────────────────────────────────────────

export function ApproveControls({
  taskId,
  onDecided,
}: {
  taskId: string;
  /** After a decision — or after finding someone else already made one. */
  onDecided: (outcome: 'APPROVED' | 'CHANGES_REQUESTED' | 'ALREADY_DECIDED') => void;
}) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'changes'>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    // Two approvers at once: the other one won. Say who, and move on.
    if (e instanceof ApiError && e.status === 409) {
      toast.error(e.message);
      onDecided('ALREADY_DECIDED');
      return;
    }
    setError(e instanceof ApiError ? e.message : 'Could not save that decision');
  };

  const approve = async () => {
    setBusy('approve');
    setError(null);
    try {
      await api.tasks.approve(taskId);
      toast.success('Approved — the task is done');
      onDecided('APPROVED');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const sendBack = async () => {
    if (!feedback.trim()) {
      setError('Say what needs changing — the editor works from this.');
      return;
    }
    setBusy('changes');
    setError(null);
    try {
      await api.tasks.requestChanges(taskId, feedback.trim());
      toast.success('Sent back with your feedback');
      onDecided('CHANGES_REQUESTED');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
      {mode === 'changes' ? (
        <>
          <Field
            label="What needs changing?"
            value={feedback}
            onChange={setFeedback}
            textarea
            rows={3}
            required
            placeholder="Be specific — the editor works from this."
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setMode('idle')} disabled={busy !== null} className="w-full sm:w-auto">
              Back
            </Button>
            <Button
              variant="danger"
              icon={RotateCcw}
              loading={busy === 'changes'}
              disabled={busy !== null || !feedback.trim()}
              onClick={() => void sendBack()}
              className="w-full sm:w-auto"
            >
              Send back for changes
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            icon={Check}
            loading={busy === 'approve'}
            disabled={busy !== null}
            onClick={() => void approve()}
            className="w-full sm:w-auto"
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            icon={RotateCcw}
            disabled={busy !== null}
            onClick={() => setMode('changes')}
            className="w-full sm:w-auto"
          >
            Request changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ── The drawer's block ───────────────────────────────────────────────────────

const reviewsKey = (taskId: string) => ['task-reviews', taskId] as const;

/** The WhatsApp message for the round that is waiting. */
export function messageFor(data: TaskReviewsResponse, round: TaskReviewRound) {
  return approvalMessage({
    taskTypeLabel: data.task.taskTypeLabel,
    title: data.task.title,
    clientName: data.task.clientName,
    projectName: data.task.projectName,
    editorName: round.submittedBy.name,
    round: round.round,
    link: round.link,
    taskId: data.task.id,
  });
}

export function ApprovalSection({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const me = config?.me.userId;
  const { data, isPending, error, refetch } = useQuery({
    queryKey: reviewsKey(taskId),
    queryFn: () => api.tasks.reviews(taskId),
  });

  const [sending, setSending] = useState(false);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The round just sent from here — what the WhatsApp buttons talk about. */
  const [justSent, setJustSent] = useState<number | null>(null);

  const refreshAll = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY });
    onChanged();
  };

  if (isPending) return <div className="h-16 animate-pulse rounded-xl bg-subtle" aria-busy="true" />;
  if (error || !data) {
    return <p className="text-xs text-secondary">{error instanceof ApiError ? error.message : 'Could not load the approval.'}</p>;
  }

  const { task, reviews, viewer } = data;
  const open = task.status === 'IN_REVIEW' ? ([...reviews].reverse().find((r) => r.decision == null) ?? null) : null;
  // How long it has waited, coloured by how far the chaser has got.
  const waitTone = open?.escalatedAt ? 'font-semibold text-danger' : open?.remindedAt ? 'font-semibold text-warning-ink' : '';
  const last = reviews[reviews.length - 1] ?? null;
  const onIt = Boolean(me && (task.assignees.some((a) => a.id === me) || task.creator?.id === me));

  // Nothing to show: a task that never needed approval and never had a round.
  if (!task.needsApproval && reviews.length === 0) return null;

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.tasks.submitReview(taskId, { link: link.trim() || undefined, note: note.trim() || undefined });
      setJustSent(res.review.round);
      setSending(false);
      setLink('');
      setNote('');
      toast.success(`Sent for approval — round ${res.review.round}`);
      refreshAll();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not send it for approval');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Approval" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Approval</p>
        {task.status === 'IN_REVIEW' && <Badge tone="review">In review</Badge>}
      </div>

      {/* ── Waiting: the approver decides; the editor waits and can nudge. ── */}
      {open && (
        <div className="space-y-3 rounded-xl border border-review/30 bg-review-tint/60 p-3.5">
          <p className="text-sm text-body">
            <b className="text-primary">Round {open.round}</b> · sent by {open.submittedBy.name}
            {data.waitingText && (
              <>
                {' · '}
                <span className={waitTone}>waiting {data.waitingText}</span>
              </>
            )}
          </p>
          {/* Everybody sees that it escalated; only the editor is offered the nudge below. */}
          {open.escalatedAt && !onIt && (
            <p className="text-sm font-semibold text-danger">
              {data.escalatedTo.length > 0
                ? `Escalated to ${data.escalatedTo.map((p) => p.name).join(', ')}`
                : 'Escalated — no answer yet'}
            </p>
          )}
          {open.link && <OpenLink href={open.link} />}
          {open.note && <p className="whitespace-pre-wrap text-sm text-body">“{open.note}”</p>}

          {viewer.canApprove ? (
            <ApproveControls
              taskId={taskId}
              onDecided={() => {
                setJustSent(null);
                refreshAll();
              }}
            />
          ) : viewer.approveRefusal ? (
            <p className="text-xs text-secondary">{viewer.approveRefusal}</p>
          ) : null}

          {onIt && (
            <div className="space-y-2">
              {justSent === open.round && (
                <p className="text-xs font-medium text-body">Now tell the approvers — pick their group in WhatsApp:</p>
              )}
              {open.remindedAt && justSent !== open.round ? (
                // Past the reminder time: say so, and nudge the group.
                <>
                  <StuckNote waited={data.waitingText} escalatedTo={open.escalatedAt ? data.escalatedTo : null} />
                  <WhatsAppShare
                    label="Remind on WhatsApp"
                    message={reminderMessage({
                      title: task.title,
                      clientName: task.clientName,
                      projectName: task.projectName,
                      waited: data.waitingText ?? 'a while',
                      taskId: task.id,
                    })}
                  />
                </>
              ) : (
                <WhatsAppShare message={messageFor(data, open)} again={justSent !== open.round} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Decided, and not waiting again: say how it ended. ── */}
      {!open && last?.decision && (
        <div
          className={cn(
            'rounded-xl border p-3.5 text-sm',
            last.decision === 'APPROVED' ? 'border-success/30 bg-success-tint/60' : 'border-warning/30 bg-warning-tint/60',
          )}
        >
          <p className="font-medium text-primary">
            {last.decision === 'APPROVED'
              ? `Approved by ${last.decidedBy?.name ?? 'an approver'} at ${whenDecided(last.decidedAt)}`
              : `Changes requested by ${last.decidedBy?.name ?? 'an approver'} · ${whenDecided(last.decidedAt)}`}
          </p>
          {last.decision === 'CHANGES_REQUESTED' && last.feedback && (
            <p className="mt-1 whitespace-pre-wrap text-body">“{last.feedback}”</p>
          )}
        </div>
      )}

      {/* ── Ready to send. ── */}
      {viewer.canSubmit &&
        (sending ? (
          <div className="space-y-3 rounded-xl border border-border p-3.5">
            {formError && <ErrorNote onDismiss={() => setFormError(null)}>{formError}</ErrorNote>}
            <Field
              label="Link to the work"
              value={link}
              onChange={setLink}
              placeholder="https://drive.google.com/…"
              hint="Optional — where the approver can see it."
            />
            <Field label="Note" value={note} onChange={setNote} textarea rows={2} placeholder="Optional — anything they should know" />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setSending(false)} disabled={busy} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button variant="primary" icon={Send} loading={busy} onClick={() => void submit()} className="w-full sm:w-auto">
                Send for approval
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" icon={Send} onClick={() => setSending(true)} className="w-full sm:w-auto">
            {reviews.length > 0 ? `Send for approval — round ${reviews.length + 1}` : 'Send for approval'}
          </Button>
        ))}

      {/* ── Every round so far, newest first — less the one waiting, shown above. ── */}
      {reviews.some((r) => r.id !== open?.id) && (
        <ol className="space-y-2">
          {[...reviews]
            .reverse()
            .filter((r) => r.id !== open?.id)
            .map((r) => (
            <li key={r.id} className="rounded-xl border border-border px-3.5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-primary">Round {r.round}</span>
                <Badge tone={r.decision === 'APPROVED' ? 'good' : r.decision === 'CHANGES_REQUESTED' ? 'warn' : task.status === 'IN_REVIEW' ? 'review' : 'neutral'}>
                  {r.decision === 'APPROVED'
                    ? 'Approved'
                    : r.decision === 'CHANGES_REQUESTED'
                      ? 'Changes requested'
                      : task.status === 'IN_REVIEW'
                        ? 'Waiting'
                        : 'Withdrawn'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-secondary">
                Sent by {r.submittedBy.name} · {whenDecided(r.submittedAt)}
                {r.decidedBy && ` · ${r.decision === 'APPROVED' ? 'approved' : 'sent back'} by ${r.decidedBy.name} · ${whenDecided(r.decidedAt)}`}
              </p>
              {r.link && <OpenLink href={r.link} small />}
              {r.note && <p className="mt-1 whitespace-pre-wrap text-xs text-body">Note: {r.note}</p>}
              {r.feedback && <p className="mt-1 whitespace-pre-wrap text-xs text-body">Feedback: “{r.feedback}”</p>}
            </li>
            ))}
        </ol>
      )}
    </section>
  );
}

export function OpenLink({ href, small = false }: { href: string; small?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 font-medium text-primary underline underline-offset-2',
        small ? 'mt-1 text-xs' : 'text-sm',
      )}
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Open the work</span>
    </a>
  );
}
