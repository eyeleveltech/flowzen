const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method || 'GET';
    const isMutation = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(isMutation ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}),
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login') && !window.location.pathname.includes('/register') && !window.location.pathname.includes('/forgot-password') && !window.location.pathname.includes('/reset-password')) {
        localStorage.removeItem('flowzen-user');
        window.location.href = '/login';
      }
      const error = await response.json().catch(() => ({ error: 'Unauthorized' }));
      throw new Error(error.error || 'Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      if (error.details) {
        throw new Error(`${error.error}: ${JSON.stringify(error.details)}`);
      }
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body });
  }

  patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body });
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient(API_URL);
