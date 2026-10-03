import type { ZenCard, ZenStep, ZenStepsDone } from '@/lib/api-v2';

/**
 * How a prepared job's steps behave (Zen Plan 4) — kept apart from the card
 * that draws them, so the rules can be tested without a browser.
 *
 *   - Each step has its own button; there is no "do all".
 *   - A step that names earlier steps in `after` stays locked until every one
 *     of them is done. A failed step locks only the steps that depend on it.
 *   - A form step is "opened", never "done": the form's own Save is the act.
 */

export type StepRun =
  | { state: 'doing' }
  | { state: 'done'; result: string }
  | { state: 'failed'; error: string }
  | { state: 'opened' };

export type StepState = 'info' | 'locked' | 'ready' | 'doing' | 'done' | 'failed' | 'opened';

/** "card.step", as the server records it. */
export const stepKey = (cardIndex: number, stepIndex: number) => `${cardIndex}.${stepIndex}`;

/** Whether a step counts as done, for unlocking the ones after it. */
function isDone(step: ZenStep, key: string, done: ZenStepsDone, run: StepRun | undefined): boolean {
  if (step.kind === 'note' || step.kind === 'link') return true;
  if (step.kind === 'form') return Boolean(done[key]) || run?.state === 'opened';
  return Boolean(done[key]) || run?.state === 'done';
}

export function stepState(
  card: Extract<ZenCard, { type: 'plan' }>,
  cardIndex: number,
  stepIndex: number,
  done: ZenStepsDone,
  runs: Record<number, StepRun | undefined>,
): StepState {
  const step = card.steps[stepIndex];
  if (step.kind === 'note' || step.kind === 'link') return 'info';
  const run = runs[stepIndex];
  const recorded = done[stepKey(cardIndex, stepIndex)];
  if (run?.state === 'doing') return 'doing';
  if (step.kind === 'form') {
    if (recorded || run?.state === 'opened') return 'opened';
  } else {
    if (recorded || run?.state === 'done') return 'done';
    if (run?.state === 'failed') return 'failed';
  }
  const blockedBy = (step.after ?? []).filter(
    (i) => card.steps[i] && !isDone(card.steps[i], stepKey(cardIndex, i), done, runs[i]),
  );
  return blockedBy.length > 0 ? 'locked' : 'ready';
}

/** The result of one item in a grouped step. */
export type ItemResult = { ok: true } | { ok: false; error: string } | { skipped: true };

/**
 * One line for a grouped step: "5 moved, 1 refused: month is closed".
 *
 * `ok` is false only when nothing went through — a step with any success is
 * done (and recorded), with the refusals said beside it.
 */
export function summarise(results: ItemResult[], doneText = 'done'): { ok: boolean; text: string } {
  const sent = results.filter((r) => !('skipped' in r));
  const okCount = sent.filter((r) => 'ok' in r && r.ok).length;
  const refused = sent.filter((r): r is { ok: false; error: string } => 'ok' in r && !r.ok);
  if (sent.length === 0) return { ok: false, text: 'Nothing was chosen.' };
  if (sent.length === 1) {
    return refused.length ? { ok: false, text: refused[0].error } : { ok: true, text: doneText.charAt(0).toUpperCase() + doneText.slice(1) };
  }
  const reasons = Array.from(new Set(refused.map((r) => r.error)));
  const refusedText = refused.length ? `${refused.length} refused: ${reasons.join('; ')}` : '';
  if (okCount === 0) return { ok: false, text: `${refused.length} refused: ${reasons.join('; ')}` };
  return { ok: true, text: [`${okCount} ${doneText}`, refusedText].filter(Boolean).join(', ') };
}

/** The button's words: the step's own label when it is short, else its first word. */
export const buttonText = (label: string) => (label.length <= 24 ? label : label.split(' ')[0]);
