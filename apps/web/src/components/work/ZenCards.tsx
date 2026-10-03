'use client';

/**
 * The cards a prepared Zen job shows (Zen Plan 4).
 *
 * Nothing on these has happened when they appear. Each step is a button, and
 * pressing it is the change: the request goes from this browser, on your own
 * session, to the endpoint the screen itself would call — so every rule the
 * app keeps (approvals, closed months, who may do what) answers exactly as it
 * would there. Money documents open their real form, filled in, for you to
 * check and save. Messages are copied or opened in WhatsApp or your email —
 * Flowzen sends nothing.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy, ExternalLink, Lock, Mail, MessageCircle, TriangleAlert } from 'lucide-react';
import { api, ApiError, type ZenCard, type ZenStepsDone } from '@/lib/api-v2';
import { cn } from '@/lib/utils';
import { stashZenForm, zenFormHref } from '@/lib/zenForms';
import { buttonText, stepKey, stepState, summarise, type ItemResult, type StepRun } from './zenPlan';

type Plan = Extract<ZenCard, { type: 'plan' }>;
type Message = Extract<ZenCard, { type: 'message' }>;

const why = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not go through');

export function ZenPlanCard({
  card,
  cardIndex,
  done,
  disabled,
  onRecorded,
  onNavigate,
}: {
  card: Plan;
  cardIndex: number;
  /** What was recorded before — a reopened thread shows these as done. */
  done: ZenStepsDone;
  /** While the answer is still being written. */
  disabled?: boolean;
  /** A step was carried out: record it against the message. */
  onRecorded: (key: string, result: string) => void;
  /** Called before leaving for a form, so a phone sheet can step aside. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<Record<number, StepRun | undefined>>({});
  const [itemResults, setItemResults] = useState<Record<number, ItemResult[]>>({});
  /** The option picked for each item of a step with choices. */
  const [choices, setChoices] = useState<Record<string, number>>({});

  const run = async (i: number) => {
    const step = card.steps[i];
    if (step.kind === 'form') {
      const key = stashZenForm(step.form);
      setRuns((r) => ({ ...r, [i]: { state: 'opened' } }));
      onRecorded(stepKey(cardIndex, i), 'opened');
      onNavigate?.();
      router.push(zenFormHref(step.form.path, key));
      return;
    }
    if (step.kind !== 'post') return;
    setRuns((r) => ({ ...r, [i]: { state: 'doing' } }));
    const results: ItemResult[] = [];
    // One by one, so each refusal can be said against its own item.
    for (const [j, item] of step.items.entries()) {
      const picked = item.options ? item.options[choices[`${i}.${j}`] ?? item.choice ?? 0]?.request ?? null : item.request ?? null;
      if (!picked) {
        results.push({ skipped: true });
        continue;
      }
      try {
        await api.assistant.sendStep(picked);
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false, error: why(e) });
      }
      setItemResults((r) => ({ ...r, [i]: [...results] }));
    }
    setItemResults((r) => ({ ...r, [i]: results }));
    const outcome = summarise(results, step.doneText);
    if (outcome.ok) {
      setRuns((r) => ({ ...r, [i]: { state: 'done', result: outcome.text } }));
      onRecorded(stepKey(cardIndex, i), outcome.text);
    } else {
      setRuns((r) => ({ ...r, [i]: { state: 'failed', error: outcome.text } }));
    }
  };

  return (
    <div data-plan className="mt-1 w-[85%] overflow-hidden rounded-2xl rounded-bl-md border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <span className="text-sm font-medium text-body">{card.title}</span>
        {card.link && (
          <Link href={card.link} className="shrink-0 text-micro text-secondary underline-offset-2 hover:text-primary hover:underline">
            Open
          </Link>
        )}
      </div>

      {(card.summary?.length || card.warnings?.length || card.notes?.length) && (
        <div className="space-y-1.5 border-b border-border px-3.5 py-2.5 text-micro">
          {card.summary?.map((s) => (
            <p key={s} className="text-body">
              {s}
            </p>
          ))}
          {card.warnings?.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-warning-ink">
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
              {w}
            </p>
          ))}
          {card.notes?.map((n) => (
            <p key={n} className="text-secondary">
              {n}
            </p>
          ))}
        </div>
      )}

      <ol className="divide-y divide-border">
        {card.steps.map((step, i) => {
          const state = stepState(card, cardIndex, i, done, runs);
          const recorded = done[stepKey(cardIndex, i)]?.result;
          const stepRun = runs[i];
          const results = itemResults[i];
          const locked = state === 'locked';
          return (
            <li key={i} data-step={state} className={cn('px-3.5 py-2.5', locked && 'opacity-55')}>
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold tabular-nums',
                    state === 'done' ? 'bg-success text-white' : 'bg-subtle text-secondary',
                  )}
                  aria-hidden
                >
                  {state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-body">{step.label}</p>
                  {step.detail && <p className="mt-0.5 text-micro text-secondary">{step.detail}</p>}
                  {/* One change: its own note, said under the step. */}
                  {step.kind === 'post' && step.items.length === 1 && !step.items[0].options && step.items[0].detail && (
                    <p className="mt-0.5 text-micro text-secondary">{step.items[0].detail}</p>
                  )}

                  {/* The items of a grouped step, with a choice each where there is one. */}
                  {step.kind === 'post' && (step.items.length > 1 || step.items.some((it) => it.options)) && (
                    <ul className="mt-1.5 space-y-1">
                      {step.items.map((item, j) => {
                        const r = results?.[j];
                        return (
                          <li key={j} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro">
                            <span className="min-w-0 flex-1 text-body">{item.label}</span>
                            {item.options && state !== 'done' && (
                              <select
                                aria-label={`What to do with ${item.label}`}
                                value={choices[`${i}.${j}`] ?? item.choice ?? 0}
                                disabled={disabled || state === 'doing'}
                                onChange={(e) => setChoices((c) => ({ ...c, [`${i}.${j}`]: Number(e.target.value) }))}
                                className="rounded-md border border-border bg-white px-1.5 py-0.5 text-micro text-body"
                              >
                                {item.options.map((o, k) => (
                                  <option key={o.label} value={k}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            {r && 'ok' in r && (r.ok ? <Check className="h-3 w-3 text-success" /> : <span className="w-full text-danger">{r.error}</span>)}
                            {item.detail && <span className="w-full text-secondary">{item.detail}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* What happened, in the server's own words when it refused. */}
                  {state === 'done' && <p className="mt-1 text-micro text-success">{stepRun?.state === 'done' ? stepRun.result : recorded || 'Done'}</p>}
                  {state === 'failed' && stepRun?.state === 'failed' && <p className="mt-1 text-micro text-danger">{stepRun.error}</p>}
                  {state === 'opened' && <p className="mt-1 text-micro text-secondary">Opened — check the form and press its Save.</p>}
                  {locked && (
                    <p className="mt-1 flex items-center gap-1 text-micro text-secondary">
                      <Lock className="h-3 w-3" /> After step {(step.kind === 'post' || step.kind === 'form' ? step.after ?? [] : []).map((n) => n + 1).join(', ')}
                    </p>
                  )}
                </div>

                <div className="shrink-0">
                  {step.kind === 'link' && (
                    <Link href={step.href} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-micro font-medium text-primary hover:bg-subtle">
                      Open <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  {(step.kind === 'post' || step.kind === 'form') && state !== 'done' && (
                    <button
                      type="button"
                      onClick={() => void run(i)}
                      disabled={disabled || locked || state === 'doing'}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-micro font-medium disabled:opacity-60',
                        state === 'opened' ? 'text-secondary hover:bg-subtle' : 'bg-primary text-white hover:bg-primary-hover',
                      )}
                    >
                      {state === 'doing'
                        ? 'Working…'
                        : step.kind === 'form'
                          ? state === 'opened'
                            ? 'Open again'
                            : 'Open the form'
                          : state === 'failed'
                            ? 'Try again'
                            : buttonText(step.label)}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A follow-up for you to send — Flowzen never sends it. */
export function ZenMessageCard({ card }: { card: Message }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: the text is on screen to select by hand.
    }
  };
  const action = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-micro font-medium';
  return (
    <div data-message-card className="mt-1 w-[85%] overflow-hidden rounded-2xl rounded-bl-md border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <span className="text-sm font-medium text-body">{card.title}</span>
        {card.link && (
          <Link href={card.link} className="shrink-0 text-micro text-secondary underline-offset-2 hover:text-primary hover:underline">
            Open
          </Link>
        )}
      </div>
      <div className="space-y-1.5 px-3.5 py-2.5 text-micro">
        <p className="text-secondary">
          To:{' '}
          <span className="text-body">
            {card.to ? `${card.to.name} (${card.to.role.toLowerCase()})${card.to.phone ? ` · ${card.to.phone}` : ''}${card.to.email ? ` · ${card.to.email}` : ''}` : 'nobody on file'}
          </span>
        </p>
        <p className="whitespace-pre-wrap rounded-xl border border-border bg-white px-3 py-2 text-xs text-body">{card.text}</p>
        {card.note && <p className="text-warning-ink">{card.note}</p>}
        <p className="text-secondary">Flowzen doesn&apos;t send this. Send it yourself from WhatsApp or your email.</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border px-3.5 py-2.5">
        <button type="button" onClick={() => void copy()} className={cn(action, 'text-secondary hover:bg-subtle')}>
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a href={card.whatsapp} target="_blank" rel="noopener noreferrer" className={cn(action, 'text-secondary hover:bg-subtle')}>
          <MessageCircle className="h-3 w-3" /> Open in WhatsApp
        </a>
        <a href={card.mailto} className={cn(action, 'bg-primary text-white hover:bg-primary-hover')}>
          <Mail className="h-3 w-3" /> Email
        </a>
      </div>
    </div>
  );
}
