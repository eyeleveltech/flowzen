'use client';

// A simple event emitter to mirror the socket.io-client API locally
class SSEClient {
  private eventSource: EventSource | null = null;
  private listeners: Record<string, Function[]> = {};

  connect() {
    // A CLOSED EventSource is still an object. The guard used to be `if
    // (this.eventSource) return`, so once a stream had failed — an expired
    // cookie, a restarted API — this returned early forever and real-time
    // updates stayed dead for the rest of the session, however many times
    // anything asked to reconnect. Only a live or connecting one should block.
    if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) return;
    if (this.eventSource) this.eventSource.close();

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    this.eventSource = new EventSource(`${apiUrl}/stream`, { withCredentials: true });

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event) {
          this.emit(data.event, data.data);
        }
      } catch (err) {
        console.error('Failed to parse SSE message', err);
      }
    };

    this.eventSource.onerror = () => {
      // EventSource fires onerror on every transient hiccup (network blips, server
      // restarts, dev HMR) and reconnects automatically — those are expected and noisy,
      // so we stay quiet. Only warn if the connection is permanently CLOSED (won't retry).
      //
      // CLOSED is also what a 401 looks like from here: the spec fails the
      // connection on any non-200 and does NOT retry. There is no status on the
      // error event to tell the two apart, so drop the dead handle and let
      // whoever owns the lifecycle decide whether to try again — an authenticated
      // caller reconnects, a signed-out one is on its way to /login anyway.
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        console.warn('SSE connection closed; real-time updates paused until reconnect.');
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event: string, callback?: Function) {
    if (!this.listeners[event]) return;
    if (callback) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    } else {
      this.listeners[event] = [];
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
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
  if (sseInstance) {
    sseInstance.disconnect();
    sseInstance = null;
  }
}
