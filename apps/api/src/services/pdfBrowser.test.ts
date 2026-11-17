import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Browser } from 'puppeteer';
import { createPdfBrowserPool } from './pdfBrowser.js';

/**
 * The PDF pool (Perf Plan 3, decision 2): one browser reused, two PDFs at a
 * time, a fresh browser after a crash, closed after it has sat idle.
 */

/** A pretend Chromium: tabs that render on request, and a way to crash it. */
function fakeBrowser() {
  const events = new EventEmitter();
  const state = { connected: true, openTabs: 0, maxTabs: 0, closed: false };
  const browser = {
    get connected() {
      return state.connected;
    },
    once: (event: string, fn: () => void) => events.once(event, fn),
    newPage: vi.fn(async () => {
      if (!state.connected) throw new Error('Target closed');
      state.openTabs += 1;
      state.maxTabs = Math.max(state.maxTabs, state.openTabs);
      return {
        close: vi.fn(async () => {
          state.openTabs -= 1;
        }),
      };
    }),
    close: vi.fn(async () => {
      state.closed = true;
      state.connected = false;
    }),
    crash() {
      state.connected = false;
      events.emit('disconnected');
    },
  };
  return { browser: browser as unknown as Browser & { crash(): void }, state };
}

const launcher = () => {
  const made: ReturnType<typeof fakeBrowser>[] = [];
  const launch = vi.fn(async () => {
    const b = fakeBrowser();
    made.push(b);
    return b.browser;
  });
  return { launch, made };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the PDF browser pool', () => {
  it('starts one browser and reuses it for every PDF', async () => {
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch });
    for (let i = 0; i < 5; i++) await pool.withPage(async () => 'pdf');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(made[0].browser.newPage).toHaveBeenCalledTimes(5);
    // Every tab is closed after its PDF.
    expect(made[0].state.openTabs).toBe(0);
    await pool.close();
  });

  it('starts only one browser when several PDFs arrive at the same moment', async () => {
    const { launch } = launcher();
    const pool = createPdfBrowserPool({ launch });
    await Promise.all(Array.from({ length: 5 }, () => pool.withPage(async () => 'pdf')));
    expect(launch).toHaveBeenCalledTimes(1);
    await pool.close();
  });

  it('renders at most two at once and queues the rest, in order', async () => {
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch, concurrency: 2 });
    const order: number[] = [];
    const gates = Array.from({ length: 5 }, () => {
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      return { gate, open };
    });
    const jobs = gates.map((g, i) =>
      pool.withPage(async () => {
        order.push(i);
        await g.gate;
        return i;
      }),
    );
    await vi.waitFor(() => expect(order).toEqual([0, 1]));
    expect(pool.stats).toMatchObject({ running: 2, waiting: 3 });
    gates[0].open();
    await vi.waitFor(() => expect(order).toEqual([0, 1, 2]));
    for (const g of gates) g.open();
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4]);
    expect(made[0].state.maxTabs).toBe(2);
    expect(pool.stats).toMatchObject({ running: 0, waiting: 0 });
    await pool.close();
  });

  it('starts a fresh browser after a crash', async () => {
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch });
    await pool.withPage(async () => 'one');
    made[0].browser.crash();
    expect(await pool.withPage(async () => 'two')).toBe('two');
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  it('tries a PDF once more on a fresh browser when Chromium dies under it', async () => {
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch });
    let attempts = 0;
    const pdf = await pool.withPage(async () => {
      attempts += 1;
      if (attempts === 1) {
        made[0].browser.crash();
        throw new Error('Protocol error: Target closed');
      }
      return 'rendered';
    });
    expect(pdf).toBe('rendered');
    expect(attempts).toBe(2);
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  it('does not retry a PDF that failed with the browser still up', async () => {
    const { launch } = launcher();
    const pool = createPdfBrowserPool({ launch });
    let attempts = 0;
    await expect(
      pool.withPage(async () => {
        attempts += 1;
        throw new Error('bad HTML');
      }),
    ).rejects.toThrow('bad HTML');
    expect(attempts).toBe(1);
    // And the slot it held is free again.
    expect(await pool.withPage(async () => 'next')).toBe('next');
    await pool.close();
  });

  it('tries the launch again for the next PDF when one launch fails', async () => {
    const launch = vi
      .fn<() => Promise<Browser>>()
      .mockRejectedValueOnce(new Error('The PDF renderer could not start on this server.'))
      .mockImplementation(async () => fakeBrowser().browser);
    const pool = createPdfBrowserPool({ launch });
    await expect(pool.withPage(async () => 'x')).rejects.toThrow('could not start');
    expect(await pool.withPage(async () => 'y')).toBe('y');
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  it('closes the browser after ten idle minutes, and starts again when needed', async () => {
    vi.useFakeTimers();
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch, idleMs: 10 * 60_000 });
    await pool.withPage(async () => 'pdf');
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(made[0].state.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(made[0].state.closed).toBe(true);
    expect(pool.stats.open).toBe(false);
    await pool.withPage(async () => 'later');
    expect(launch).toHaveBeenCalledTimes(2);
    await pool.close();
  });

  it('never closes the browser while a PDF is rendering', async () => {
    vi.useFakeTimers();
    const { launch, made } = launcher();
    const pool = createPdfBrowserPool({ launch, idleMs: 1000 });
    await pool.withPage(async () => 'first');
    let finish!: () => void;
    const busy = pool.withPage(() => new Promise<string>((r) => (finish = () => r('long'))));
    await vi.advanceTimersByTimeAsync(5000);
    expect(made[0].state.closed).toBe(false);
    finish();
    await busy;
    await vi.advanceTimersByTimeAsync(1000);
    expect(made[0].state.closed).toBe(true);
  });
});
