import { describe, it, expect } from 'vitest';
import { zenRequestAllowed, type ZenCard } from '@/lib/api-v2';
import { buttonText, stepState, summarise } from './zenPlan';

/**
 * A prepared job's steps (Zen Plan 4): each its own button, later steps locked
 * until the ones they need are done, a failure blocking only what depends on
 * it — and only a short list of existing endpoints ever reachable from a card.
 */

type Plan = Extract<ZenCard, { type: 'plan' }>;
const post = (label: string, after?: number[]) => ({
  kind: 'post' as const,
  label,
  items: [{ label, request: { method: 'POST' as const, path: '/proposals/p1/win', body: {} } }],
  ...(after ? { after } : {}),
});
const won: Plan = {
  type: 'plan',
  title: 'Acme: won on v2',
  steps: [
    post('Mark won on v2'),
    { kind: 'form', label: 'Set up the retainer', after: [0], form: { name: 'retainer', path: '/companies/c1', values: {} } },
    { kind: 'note', label: 'Closes by itself on the 1st.' },
    post('Unrelated step'),
  ],
};

describe('step unlock', () => {
  it('locks a step until the step it needs is done', () => {
    expect(stepState(won, 0, 0, {}, {})).toBe('ready');
    expect(stepState(won, 0, 1, {}, {})).toBe('locked');
    expect(stepState(won, 0, 1, {}, { 0: { state: 'done', result: 'Won' } })).toBe('ready');
  });

  it('unlocks from what was recorded, when a thread is reopened', () => {
    expect(stepState(won, 0, 0, { '0.0': { result: 'Won' } }, {})).toBe('done');
    expect(stepState(won, 0, 1, { '0.0': { result: 'Won' } }, {})).toBe('ready');
  });

  it('keeps a step locked when the one it needs failed — and nothing else', () => {
    const runs = { 0: { state: 'failed' as const, error: 'This deal is already won.' } };
    expect(stepState(won, 0, 0, {}, runs)).toBe('failed');
    expect(stepState(won, 0, 1, {}, runs)).toBe('locked');
    expect(stepState(won, 0, 3, {}, runs)).toBe('ready');
  });

  it('shows a form as opened, never done — its own Save is the act', () => {
    expect(stepState(won, 0, 1, { '0.0': { result: 'Won' }, '0.1': { result: 'opened' } }, {})).toBe('opened');
  });

  it('has nothing to press on a note', () => {
    expect(stepState(won, 0, 2, {}, {})).toBe('info');
  });

  it('reads the recorded steps of its own card only', () => {
    expect(stepState(won, 1, 0, { '0.0': { result: 'Won' } }, {})).toBe('ready');
  });
});

describe('a grouped step’s result', () => {
  it('counts what went through and says why the rest did not', () => {
    expect(summarise([{ ok: true }, { ok: true }, { ok: false, error: 'month is closed' }], 'moved')).toEqual({
      ok: true,
      text: '2 moved, 1 refused: month is closed',
    });
  });

  it('is the server’s own words for a single refusal', () => {
    expect(summarise([{ ok: false, error: 'This task needs approval.' }])).toEqual({ ok: false, text: 'This task needs approval.' });
  });

  it('fails only when nothing went through', () => {
    expect(summarise([{ ok: false, error: 'a' }, { ok: false, error: 'a' }], 'moved')).toEqual({ ok: false, text: '2 refused: a' });
  });

  it('leaves out the items left as they are', () => {
    expect(summarise([{ ok: true }, { skipped: true }], 'settled')).toEqual({ ok: true, text: 'Settled' });
  });

  it('labels a long step by its verb', () => {
    expect(buttonText('Move 6 tasks to Mon 6 Oct')).toBe('Move');
    expect(buttonText('Book it')).toBe('Book it');
  });
});

describe('what a card may send', () => {
  it('only the endpoints a prepared job uses', () => {
    expect(zenRequestAllowed({ method: 'PATCH', path: '/tasks/t1' })).toBe(true);
    expect(zenRequestAllowed({ method: 'POST', path: '/tasks/t1/approve' })).toBe(true);
    expect(zenRequestAllowed({ method: 'POST', path: '/calendar/events' })).toBe(true);
    expect(zenRequestAllowed({ method: 'POST', path: '/proposals/p1/win' })).toBe(true);
  });

  it('never a delete, a cost, a document, or another route', () => {
    expect(zenRequestAllowed({ method: 'POST', path: '/costs' })).toBe(false);
    expect(zenRequestAllowed({ method: 'POST', path: '/proformas' })).toBe(false);
    expect(zenRequestAllowed({ method: 'POST', path: '/retainers' })).toBe(false);
    expect(zenRequestAllowed({ method: 'PATCH', path: '/calendar/events/e1/../../users/u1' })).toBe(false);
    expect(zenRequestAllowed({ method: 'DELETE' as never, path: '/calendar/events/e1' })).toBe(false);
  });
});
