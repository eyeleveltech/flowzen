'use client';

// A simple event emitter to mirror the socket.io-client API locally
class SSEClient {
  private eventSource: EventSource | null = null;
  private listeners: Record<string, Function[]> = {};

  connect() {
    if (this.eventSource) return;

    const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    this.eventSource = new EventSource(`${url}/api/stream`, { withCredentials: true });

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

    this.eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      // EventSource reconnects automatically
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

export function getSSE(): SSEClient | null {
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
