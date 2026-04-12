import { apiFetch } from './client.js';
import type { ExtensionRegistration } from '../types/index.js';

export async function fetchExtensions(): Promise<ExtensionRegistration[]> {
  try {
    const data = await apiFetch<{ extensions: ExtensionRegistration[] }>(
      '/api/extensions'
    );
    return data.extensions ?? [];
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return [];
    }

    throw error;
  }
}
