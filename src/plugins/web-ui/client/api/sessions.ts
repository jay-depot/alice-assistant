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

export async function createSession(): Promise<Session> {
  const data = await apiFetch<{ session: Session }>('/api/chat', {
    method: 'POST',
  });
  return data.session;
}

export async function patchSession(id: number | string, message: string): Promise<Session> {
  const data = await apiFetch<{ session: Session }>(`/api/chat/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ message }),
  });
  return data.session;
}

export async function endSession(id: number | string): Promise<void> {
  await apiFetch(`/api/chat/${id}`, { method: 'DELETE' });
}
