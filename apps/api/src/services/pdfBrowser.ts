import type { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger.js';

/**
 * One Chromium for every PDF (Perf Plan 3, decision 2).
 *
 * Each proforma, invoice and proposal used to start a whole browser of its
 * own and close it again — a second or more of every download spent before a
 * page was drawn, and five downloads at once were five Chromiums at once,
 * which is how a small server runs out of memory.
 *
 * Now one browser is kept alive and every PDF is a new tab in it:
 *
 *   - **A queue.** At most `concurrency` PDFs render at once (two); the rest
 *     wait their turn, so a burst never opens more than two tabs.
 *   - **A crash restarts it.** If Chromium dies, the next PDF starts a fresh
 *     one — and a PDF that was rendering when it died is tried once more on
 *     the fresh browser rather than failing the download.
 *   - **It goes away when nobody needs it.** Ten minutes with nothing to
 *     render and it is closed, so an idle server is not holding Chromium's
 *     memory for a PDF nobody asked for.
 */

export type PdfBrowserPool = {
  /** A new tab in the shared browser, for one job; closed when the job ends. */
  withPage<T>(job: (page: Page) => Promise<T>): Promise<T>;
  /** Close the browser now (the next job starts a new one). */
  close(): Promise<void>;
  /** For tests and logs: what the pool holds right now. */
  readonly stats: { running: number; waiting: number; open: boolean; launches: number };
};

export function createPdfBrowserPool(opts: {
  launch: () => Promise<Browser>;
  concurrency?: number;
  idleMs?: number;
}): PdfBrowserPool {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const idleMs = opts.idleMs ?? 10 * 60_000;

  let browser: Promise<Browser> | null = null;
  let launches = 0;
  let running = 0;
  const waiting: (() => void)[] = [];
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (running === 0 && waiting.length === 0) void close();
    }, idleMs);
    // A timer for tidying up must never keep the process alive on its own.
    idleTimer.unref?.();
  };

  /** The live browser, or a new one if there is none or it has died. */
  async function current(): Promise<Browser> {
    if (browser) {
      const b = await browser.catch(() => null);
      if (b?.connected) return b;
      browser = null;
    }
    const launching = opts.launch();
    browser = launching;
    launches += 1;
    try {
      const b = await launching;
      // Died on its own (a crash, the OOM killer): forget it, the next job launches again.
      b.once('disconnected', () => {
        if (browser === launching) browser = null;
      });
      return b;
    } catch (e) {
      // A launch that failed is not kept: the next job tries again.
      if (browser === launching) browser = null;
      throw e;
    }
  }

  async function acquire(): Promise<void> {
    if (running < concurrency) {
      running += 1;
      return;
    }
    // Handed the slot directly by `release`, so `running` stays at the cap.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next) {
      next();
      return;
    }
    running -= 1;
    if (running === 0) armIdle();
  }

  async function runOn<T>(b: Browser, job: (page: Page) => Promise<T>): Promise<T> {
    const page = await b.newPage();
    try {
      return await job(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function withPage<T>(job: (page: Page) => Promise<T>): Promise<T> {
    await acquire();
    clearIdle();
    try {
      // A browser that will not start fails the job as it is; nothing to retry on.
      const b = await current();
      try {
        return await runOn(b, job);
      } catch (e) {
        // A render that failed with the browser still up is a real failure.
        if (b.connected) throw e;
        // The browser died under this job: once more, on a fresh one.
        logger.warn(`PDF renderer: Chromium went away mid-render, starting it again. ${e instanceof Error ? e.message : e}`);
        return await runOn(await current(), job);
      }
    } finally {
      release();
    }
  }

  async function close(): Promise<void> {
    clearIdle();
    const b = await browser?.catch(() => null);
    browser = null;
    await b?.close().catch(() => {});
  }

  return {
    withPage,
    close,
    get stats() {
      return { running, waiting: waiting.length, open: browser !== null, launches };
    },
  };
}
