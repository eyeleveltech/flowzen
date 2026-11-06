import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { optimistic, changedBackMessage, CHANGED_BACK } from './optimistic';
import { ApiError } from './api-v2';

/** Perf Plan 1, decision 6 — instant on screen, and back again when the server says no. */

type List = { tasks: { id: string; status: string }[] };
const list: List = { tasks: [{ id: 'a', status: 'TODO' }, { id: 'b', status: 'TODO' }] };
const markDone = (cur: List): List => ({ ...cur, tasks: cur.tasks.map((t) => (t.id === 'a' ? { ...t, status: 'DONE' } : t)) });

describe('optimistic', () => {
  it('changes the cache before the save finishes, and keeps it once the save succeeds', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['tasks', 'my'], list);
    let seenDuringSave: List | undefined;
    const ok = await optimistic<List>(qc, ['tasks', 'my'], markDone, async () => {
      seenDuringSave = qc.getQueryData<List>(['tasks', 'my']);
    });
    expect(ok).toBe(true);
    expect(seenDuringSave?.tasks[0].status).toBe('DONE');
    expect(qc.getQueryData<List>(['tasks', 'my'])?.tasks[0].status).toBe('DONE');
  });

  it('puts the cache back and says "Couldn’t save — changed back" with the server’s reason', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['tasks', 'my'], list);
    const notify = vi.fn();
    const ok = await optimistic<List>(
      qc,
      ['tasks', 'my'],
      markDone,
      async () => {
        throw new ApiError('That task is finished already', 400);
      },
      { notify },
    );
    expect(ok).toBe(false);
    expect(qc.getQueryData<List>(['tasks', 'my'])).toEqual(list);
    expect(notify).toHaveBeenCalledWith(`${CHANGED_BACK}: That task is finished already`);
  });

  it('changes every variant under a prefix key — each All tasks filter — and restores each', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['all-work', { status: 'open' }], list);
    qc.setQueryData(['all-work', { status: 'all' }], list);
    const ok = await optimistic<List>(qc, ['all-work'], markDone, async () => {
      expect(qc.getQueryData<List>(['all-work', { status: 'open' }])?.tasks[0].status).toBe('DONE');
      expect(qc.getQueryData<List>(['all-work', { status: 'all' }])?.tasks[0].status).toBe('DONE');
      throw new Error('offline');
    }, { notify: () => {} });
    expect(ok).toBe(false);
    expect(qc.getQueryData<List>(['all-work', { status: 'open' }])).toEqual(list);
    expect(qc.getQueryData<List>(['all-work', { status: 'all' }])).toEqual(list);
  });

  it('words the toast without a reason when there is none', () => {
    expect(changedBackMessage('nope')).toBe(CHANGED_BACK);
    expect(changedBackMessage(new Error(''))).toBe(CHANGED_BACK);
    expect(changedBackMessage(new Error('No connection'))).toBe(`${CHANGED_BACK}: No connection`);
  });
});
