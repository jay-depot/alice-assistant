import { apiFetch } from './client.js';

export interface AssistantInfo {
  assistantName: string;
  displayName: string;
}

export async function fetchAssistantInfo(): Promise<AssistantInfo> {
  return apiFetch<AssistantInfo>('/api/assistant-info');
}
