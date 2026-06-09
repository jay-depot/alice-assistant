import { apiFetch } from './client.js';
import type { Session, SessionSummary } from '../types/index.js';

export async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await apiFetch<{ sessions: SessionSummary[] }>('/api/chat');
  return data.sessions;
}

export async function fetchSession(id: number | string): Promise<Session> {
  const data = await apiFetch<{ session: Session }>(`/api/chat/${id}`);
  return data.session;
}
