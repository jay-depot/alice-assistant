/**
 * REST API client for the A.L.I.C.E. TUI.
 *
 * Uses Node 22+ built-in fetch to communicate with the web-ui plugin's
 * REST endpoints. No authentication — local-first.
 */

import type {
  ApiSession,
  ApiSessionSummary,
  ApiCompactResponse,
} from './tui-types.js';

export class TuiApiClient {
  private baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async listSessions(): Promise<ApiSessionSummary[]> {
    const res = await this.fetch('/api/chat');
    const data = (await res.json()) as { sessions: ApiSessionSummary[] };
    return data.sessions;
  }

  async createSession(): Promise<ApiSession> {
    const res = await this.fetch('/api/chat', { method: 'POST' });
    const data = (await res.json()) as { session: ApiSession };
    return data.session;
  }

  async getSession(id: number): Promise<ApiSession> {
    const res = await this.fetch(`/api/chat/${id}`);
    const data = (await res.json()) as { session: ApiSession };
    return data.session;
  }

  async sendMessage(id: number, message: string): Promise<ApiSession> {
    const res = await this.fetch(`/api/chat/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = (await res.json()) as { session: ApiSession };
    return data.session;
  }

  async deleteSession(id: number): Promise<void> {
    await this.fetch(`/api/chat/${id}`, { method: 'DELETE' });
  }

  async compactSession(
    id: number,
    mode: 'normal' | 'full' | 'clear' = 'normal'
  ): Promise<ApiCompactResponse> {
    const res = await this.fetch(`/api/chat/${id}/compact?mode=${mode}`, {
      method: 'POST',
    });
    return (await res.json()) as ApiCompactResponse;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(
        `API request failed: ${res.status} ${res.statusText} — ${text}`
      );
    }
    return res;
  }
}
