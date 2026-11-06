'use client';

/**
 * The live connection — one per BROWSER, shared between tabs (Perf Plan 1,
 * decision 7).
 *
 * Every tab used to open its own EventSource to /api/stream. Over HTTP/1.1 a
 * browser allows six connections to a host, so six Flowzen tabs used them all
 * up on streams and every ordinary request queued behind them — which is how
 * "clicks feel laggy" with a few tabs open.
 *
 * Now the first tab to take the `flowzen-sse-leader` lock (the Web Locks API)
 * holds the stream and repeats every event to the other tabs on a
 * BroadcastChannel. A lock is released when its tab closes or is discarded,
 * so the next tab waiting on it takes over at once. Every tab, leader or
 * not, hears the same events through `on()`, exactly as before.
 *
 * A browser without locks or channels (none of the current ones) connects
 * directly, as it always did.
 */

type Listener = (data: unknown) => void;

const CHANNEL = 'flowzen-sse';
const LEADER_LOCK = 'flowzen-sse-leader';

class SSEClient {
  private eventSource: EventSource | null = null;
  private channel: BroadcastChannel | null = null;
  private listeners: Record<string, Listener[]> = {};
  /** connect() was called and disconnect() has not been. */
  private active = false;
  /** This tab holds the stream. */
  private leader = false;
  private releaseLock: (() => void) | null = null;

  connect() {
    if (this.active) {
      // Already running. A leader whose stream died (a 401, a restarted API)
      // opens it again; a follower has nothing to do.
      if (this.leader) this.openStream();
      return;
    }
    this.active = true;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e: MessageEvent) => {
        const msg = e.data as { event?: unknown; data?: unknown } | null;
        if (msg && typeof msg.event === 'string') this.emit(msg.event, msg.data);
      };
    }

    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || !this.channel) {
      this.leader = true;
      this.openStream();
      return;
    }

    void locks.request(LEADER_LOCK, async () => {
      // Signed out while waiting for the lock: let it go to the next tab.
      if (!this.active) return;
      this.leader = true;
      this.openStream();
      // Hold the lock until disconnect() — or until this tab goes away.
      await new Promise<void>((resolve) => {
        this.releaseLock = resolve;
      });
    });
  }

  private openStream() {
    // A CLOSED EventSource is still an object. The guard used to be `if
    // (this.eventSource) return`, so once a stream had failed — an expired
    // cookie, a restarted API — this returned early forever and real-time
    // updates stayed dead for the rest of the session, however many times
    // anything asked to reconnect. Only a live or connecting one should block.
    if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) return;
    if (this.eventSource) this.eventSource.close();

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const es = new EventSource(`${apiUrl}/stream`, { withCredentials: true });
    this.eventSource = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event) {
          this.emit(data.event, data.data);
          // The other tabs hear it from here, not from streams of their own.
          this.channel?.postMessage({ event: data.event, data: data.data });
        }
      } catch (err) {
        console.error('Failed to parse SSE message', err);
      }
    };

    es.onerror = () => {
      // EventSource fires onerror on every transient hiccup (network blips, server
      // restarts, dev HMR) and reconnects automatically — those are expected and noisy,
      // so we stay quiet. Only warn if the connection is permanently CLOSED (won't retry).
      //
      // CLOSED is also what a 401 looks like from here: the spec fails the
      // connection on any non-200 and does NOT retry. There is no status on the
      // error event to tell the two apart, so drop the dead handle and let
      // whoever owns the lifecycle decide whether to try again — an authenticated
      // caller reconnects, a signed-out one is on its way to /login anyway.
      if (es.readyState === EventSource.CLOSED) {
        console.warn('SSE connection closed; real-time updates paused until reconnect.');
        es.close();
        if (this.eventSource === es) this.eventSource = null;
      }
    };
  }

  disconnect() {
    this.active = false;
    this.leader = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    // Lets the lock go, so another open tab becomes the leader.
    this.releaseLock?.();
    this.releaseLock = null;
    this.channel?.close();
    this.channel = null;
  }

  on(event: string, callback: Listener) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event: string, callback?: Listener) {
    if (!this.listeners[event]) return;
    if (callback) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    } else {
      this.listeners[event] = [];
    }
  }

  private emit(event: string, data: unknown) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data));
    }
  }
}

let sseInstance: SSEClient | null = null;

export function getSSE(): SSEClient {
  if (!sseInstance) {
    sseInstance = new SSEClient();
  }
  return sseInstance;
}

export function connectSSE(): SSEClient {
  if (!sseInstance) {
    sseInstance = new SSEClient();
  }
  sseInstance.connect();
  return sseInstance;
}

export function disconnectSSE() {
  // The instance stays, listeners and all: GlobalEvents registered its
  // handlers once, at mount, and signing out and back in used to replace
  // the instance underneath them and leave the new stream unheard.
  sseInstance?.disconnect();
}
