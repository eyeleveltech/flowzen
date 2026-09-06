/**
 * Saved views.
 *
 * The storage is a few lines; the part worth testing is what happens when it
 * misbehaves — a private window, cleared site data, or a key somebody edited by
 * hand. A filter control that throws on read takes the whole list down with it,
 * so every path here has to end in "no views" rather than an exception.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readViews, saveView, removeView, sameQuery } from './views';

const PAGE = 'tasks';

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('saving and reading', () => {
  it('keeps what was saved', () => {
    saveView(PAGE, 'My attention', 'mine=1&overdue=1');
    const [view] = readViews(PAGE);
    expect(view.name).toBe('My attention');
    expect(view.query).toBe('mine=1&overdue=1');
  });

  it('overwrites by name rather than collecting duplicates', () => {
    saveView(PAGE, 'Overdue', 'overdue=1');
    saveView(PAGE, 'overdue', 'overdue=1&mine=1');
    const views = readViews(PAGE);
    expect(views).toHaveLength(1);
    expect(views[0].query).toBe('overdue=1&mine=1');
  });

  it('refuses a blank name', () => {
    saveView(PAGE, '   ', 'overdue=1');
    expect(readViews(PAGE)).toHaveLength(0);
  });

  it('trims the name, so " Overdue " and "Overdue" are one view', () => {
    saveView(PAGE, '  Overdue  ', 'a=1');
    expect(readViews(PAGE)[0].name).toBe('Overdue');
  });

  it('keeps each screen’s views apart', () => {
    saveView('tasks', 'Mine', 'mine=1');
    saveView('projects', 'At risk', 'health=AT_RISK');
    expect(readViews('tasks')).toHaveLength(1);
    expect(readViews('projects')[0].name).toBe('At risk');
  });

  it('removes one without touching the others', () => {
    saveView(PAGE, 'A', 'a=1');
    saveView(PAGE, 'B', 'b=1');
    const [a] = readViews(PAGE);
    const left = removeView(PAGE, a.id);
    expect(left.map((v) => v.name)).toEqual(['B']);
  });
});

describe('when storage misbehaves', () => {
  it('returns nothing rather than throwing on unparseable data', () => {
    window.localStorage.setItem('flowzen-views:tasks', 'not json');
    expect(readViews(PAGE)).toEqual([]);
  });

  it('ignores an entry that is not a view', () => {
    window.localStorage.setItem(
      'flowzen-views:tasks',
      JSON.stringify([{ id: '1', name: 'ok', query: '' }, { nonsense: true }, null]),
    );
    expect(readViews(PAGE)).toHaveLength(1);
  });

  it('survives storage that is not an array at all', () => {
    window.localStorage.setItem('flowzen-views:tasks', JSON.stringify({ a: 1 }));
    expect(readViews(PAGE)).toEqual([]);
  });

  it('does not throw when writing is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveView(PAGE, 'A', 'a=1')).not.toThrow();
  });

  it('does not throw when reading is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readViews(PAGE)).toEqual([]);
  });
});

describe('sameQuery — which view am I looking at', () => {
  it('ignores the order the parameters happen to be in', () => {
    // The screen rewrites its own URL, so it has no reason to preserve whatever
    // order a view was saved in.
    expect(sameQuery('mine=1&overdue=1', 'overdue=1&mine=1')).toBe(true);
  });

  it('ignores `create`, which opens a dialog rather than filtering anything', () => {
    expect(sameQuery('mine=1&create=true', 'mine=1')).toBe(true);
  });

  it('still tells different filters apart', () => {
    expect(sameQuery('mine=1', 'mine=1&overdue=1')).toBe(false);
    expect(sameQuery('status=TODO', 'status=DONE')).toBe(false);
  });

  it('treats no filters as no filters', () => {
    expect(sameQuery('', '')).toBe(true);
  });
});
