import path from 'node:path';
import { mkdir, readFile, writeFile, exists } from '../../lib/node/fs-promised.js';
import type { SystemConfigFull } from '../../lib/types/system-config-full.js';
import type { MoltbookPluginConfigSchema } from './moltbook.js';
import { formatComments, formatFeedItems, formatHome, formatNotificationSummary, formatPost, formatProfile, formatSearchResults, formatSubmolt, formatSubmoltList } from './moltbook-format.js';
import { solveMoltbookVerificationChallenge } from './moltbook-verification.js';

export const MOLTBOOK_BASE_URL = 'https://www.moltbook.com/api/v1';

type JsonRecord = Record<string, unknown>;

type MoltbookClientOptions = {
  pluginConfig: MoltbookPluginConfigSchema;
  systemConfig: SystemConfigFull;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  requiresAuth?: boolean;
};

type VerificationOutcome = {
  attempted: boolean;
  success: boolean;
  message: string;
};

type RegistrationResult = {
  apiKey: string;
  agentName: string;
  claimUrl: string;
  verificationCode: string;
};

function assertTrustedBaseUrl() {
  const parsed = new URL(MOLTBOOK_BASE_URL);
  if (parsed.origin !== 'https://www.moltbook.com' || !parsed.pathname.startsWith('/api/v1')) {
    throw new Error('Moltbook Plugin: Refusing to use an untrusted Moltbook host. Only https://www.moltbook.com/api/v1 is allowed.');
  }
}

function buildUrl(requestPath: string, query?: Record<string, string | number | undefined>) {
  assertTrustedBaseUrl();
  const url = new URL(requestPath.startsWith('/') ? requestPath.slice(1) : requestPath, `${MOLTBOOK_BASE_URL}/`);

  if (url.origin !== 'https://www.moltbook.com') {
    throw new Error('Moltbook Plugin: Refusing to send a request to a non-www Moltbook host.');
  }

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

function normalizeErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as JsonRecord;
  const message = typeof record.error === 'string'
    ? record.error
    : typeof record.message === 'string'
      ? record.message
      : undefined;
  const hint = typeof record.hint === 'string' ? record.hint : undefined;

  if (!message && !hint) {
    return undefined;
  }

  return [message, hint ? `Hint: ${hint}` : undefined].filter(Boolean).join(' ');
}

function getHeaderValue(headers: Headers, name: string) {
  const value = headers.get(name);
  return value ? value.trim() : undefined;
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export type MoltbookClient = ReturnType<typeof createMoltbookClient>;

export function createMoltbookClient({ pluginConfig, systemConfig }: MoltbookClientOptions) {
  const credentialsFilePath = path.join(systemConfig.configDirectory, 'plugin-settings', 'moltbook', 'credentials.json');

  async function ensureCredentialsDirectory() {
    const directory = path.dirname(credentialsFilePath);
    if (!await exists(directory)) {
      await mkdir(directory, { recursive: true });
    }
  }

  async function readStoredCredentials() {
    if (!await exists(credentialsFilePath)) {
      return undefined;
    }

    try {
      return JSON.parse(await readFile(credentialsFilePath, 'utf-8')) as JsonRecord;
    } catch {
      return undefined;
    }
  }

  async function resolveApiKey() {
    if (pluginConfig.apiKey) {
      return pluginConfig.apiKey;
    }

    const storedCredentials = await readStoredCredentials();
    const storedApiKey = typeof storedCredentials?.api_key === 'string' ? storedCredentials.api_key : undefined;
    if (storedApiKey) {
      return storedApiKey;
    }

    return process.env.MOLTBOOK_API_KEY;
  }

  async function saveCredentials(registration: RegistrationResult) {
    await ensureCredentialsDirectory();
    await writeFile(credentialsFilePath, JSON.stringify({
      api_key: registration.apiKey,
      agent_name: registration.agentName,
      claim_url: registration.claimUrl,
      verification_code: registration.verificationCode,
      saved_at: new Date().toISOString(),
    }, null, 2), 'utf-8');
  }

  async function request<T = JsonRecord>({ method = 'GET', path: requestPath, query, body, requiresAuth = true }: RequestOptions): Promise<{ data: T; headers: Headers; }> {
    const apiKey = requiresAuth ? await resolveApiKey() : undefined;
    if (requiresAuth && !apiKey) {
      throw new Error('Moltbook Plugin: No API key is available. Register an agent first or add credentials in plugin-settings/moltbook/moltbook.json or plugin-settings/moltbook/credentials.json.');
    }

    const url = buildUrl(requestPath, query);
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const rateLimitRemaining = getHeaderValue(response.headers, 'X-RateLimit-Remaining');
      const rateLimitReset = getHeaderValue(response.headers, 'X-RateLimit-Reset');
      const retryAfter = getHeaderValue(response.headers, 'Retry-After');
      const details = normalizeErrorPayload(payload);
      const rateLimitSummary = [
        rateLimitRemaining ? `Remaining: ${rateLimitRemaining}.` : undefined,
        rateLimitReset ? `Reset: ${rateLimitReset}.` : undefined,
        retryAfter ? `Retry-After: ${retryAfter}s.` : undefined,
      ].filter(Boolean).join(' ');

      throw new Error(`Moltbook API request failed with status ${response.status}. ${details ?? ''} ${rateLimitSummary}`.trim());
    }

    return {
      data: (payload ?? {}) as T,
      headers: response.headers,
    };
  }

  async function maybeVerifyContent(contentType: 'post' | 'comment', data: JsonRecord): Promise<VerificationOutcome> {
    const content = data[contentType];
    if (!content || typeof content !== 'object') {
      return {
        attempted: false,
        success: true,
        message: 'No verification step was required.',
      };
    }

    const record = content as JsonRecord;
    const verification = record.verification;
    if (!verification || typeof verification !== 'object') {
      return {
        attempted: false,
        success: true,
        message: 'No verification step was required.',
      };
    }

    const verificationRecord = verification as JsonRecord;
    const verificationCode = typeof verificationRecord.verification_code === 'string' ? verificationRecord.verification_code : undefined;
    const challengeText = typeof verificationRecord.challenge_text === 'string' ? verificationRecord.challenge_text : undefined;
    console.log('Moltbook API', { challengeText });

    if (!verificationCode || !challengeText) {
      return {
        attempted: false,
        success: false,
        message: 'Moltbook requested verification, but the challenge payload was incomplete.',
      };
    }

    const solution = solveMoltbookVerificationChallenge(challengeText);
    if (!solution.success) {
      return {
        attempted: false,
        success: false,
        message: `Moltbook requested verification, but the plugin could not safely parse the challenge. Challenge: ${challengeText}`,
      };
    }

    try {
      await request({
        method: 'POST',
        path: '/verify',
        body: {
          verification_code: verificationCode,
          answer: solution.answer,
        },
      });

      return {
        attempted: true,
        success: true,
        message: `Verification solved automatically with answer ${solution.answer}.`,
      };
    } catch (error) {
      return {
        attempted: true,
        success: false,
        message: error instanceof Error ? error.message : 'Verification failed for an unknown reason.',
      };
    }
  }

  return {
    credentialsFilePath,
    getDefaultFeedLimit() {
      return pluginConfig.defaultFeedLimit;
    },
    getDefaultCommentLimit() {
      return pluginConfig.defaultCommentLimit;
    },
    async registerAgent(name: string, description: string) {
      const response = await request<{ agent?: JsonRecord; important?: string }>({
        method: 'POST',
        path: '/agents/register',
        requiresAuth: false,
        body: { name, description },
      });

      const agent = response.data.agent;
      const apiKey = typeof agent?.api_key === 'string' ? agent.api_key : undefined;
      const claimUrl = typeof agent?.claim_url === 'string' ? agent.claim_url : undefined;
      const verificationCode = typeof agent?.verification_code === 'string' ? agent.verification_code : undefined;

      if (!apiKey || !claimUrl || !verificationCode) {
        throw new Error('Moltbook Plugin: Registration succeeded but the response was missing credentials or claim details.');
      }

      const registration = { apiKey, agentName: name, claimUrl, verificationCode };
      await saveCredentials(registration);
      return registration;
    },
    async getClaimStatus() {
      const response = await request<JsonRecord>({ path: '/agents/status' });
      return response.data;
    },
    async getProfile(name?: string) {
      if (name) {
        const response = await request<JsonRecord>({ path: '/agents/profile', query: { name } });
        return response.data;
      }

      const response = await request<JsonRecord>({ path: '/agents/me' });
      return response.data;
    },
    async updateProfile(update: { description?: string; metadata?: Record<string, unknown>; }) {
      const response = await request<JsonRecord>({
        method: 'PATCH',
        path: '/agents/me',
        body: update,
      });
      return response.data;
    },
    async getHome() {
      const response = await request<JsonRecord>({ path: '/home' });
      return response.data;
    },
    async getFeed(options: { sort?: string; limit?: number; cursor?: string; filter?: string; }) {
      const response = await request<JsonRecord>({ path: '/feed', query: options });
      return response.data;
    },
    async getSubmoltFeed(options: { submolt: string; sort?: string; limit?: number; cursor?: string; }) {
      const response = await request<JsonRecord>({ path: `/submolts/${encodeURIComponent(options.submolt)}/feed`, query: { sort: options.sort, limit: options.limit, cursor: options.cursor } });
      return response.data;
    },
    async getPost(postId: string) {
      const response = await request<JsonRecord>({ path: `/posts/${encodeURIComponent(postId)}` });
      return response.data;
    },
    async getComments(options: { postId: string; sort?: string; limit?: number; cursor?: string; requesterId?: string; }) {
      const response = await request<JsonRecord>({
        path: `/posts/${encodeURIComponent(options.postId)}/comments`,
        query: {
          sort: options.sort,
          limit: options.limit,
          cursor: options.cursor,
          requester_id: options.requesterId,
        },
      });
      return response.data;
    },
    async listSubmolts() {
      const response = await request<JsonRecord>({ path: '/submolts' });
      return response.data;
    },
    async getSubmolt(name: string) {
      const response = await request<JsonRecord>({ path: `/submolts/${encodeURIComponent(name)}` });
      return response.data;
    },
    async search(options: { query: string; type?: string; limit?: number; cursor?: string; }) {
      const response = await request<JsonRecord>({
        path: '/search',
        query: {
          q: options.query,
          type: options.type,
          limit: options.limit,
          cursor: options.cursor,
        },
      });
      return response.data;
    },
    async createPost(input: { submolt_name: string; title: string; content?: string; url?: string; type?: string; }) {
      const response = await request<JsonRecord>({ method: 'POST', path: '/posts', body: input });
      const verification = await maybeVerifyContent('post', response.data);
      return { data: response.data, verification };
    },
    async createComment(postId: string, input: { content: string; parent_id?: string; }) {
      const response = await request<JsonRecord>({ method: 'POST', path: `/posts/${encodeURIComponent(postId)}/comments`, body: input });
      const verification = await maybeVerifyContent('comment', response.data);
      return { data: response.data, verification };
    },
    async vote(targetType: 'post' | 'comment', targetId: string, direction: 'upvote' | 'downvote') {
      const pathSuffix = targetType === 'post' ? `/posts/${encodeURIComponent(targetId)}/${direction}` : `/comments/${encodeURIComponent(targetId)}/${direction}`;
      const response = await request<JsonRecord>({ method: 'POST', path: pathSuffix, body: {} });
      return response.data;
    },
    async follow(agentName: string, shouldFollow: boolean) {
      const response = await request<JsonRecord>({
        method: shouldFollow ? 'POST' : 'DELETE',
        path: `/agents/${encodeURIComponent(agentName)}/follow`,
      });
      return response.data;
    },
    async subscribe(submoltName: string, shouldSubscribe: boolean) {
      const response = await request<JsonRecord>({
        method: shouldSubscribe ? 'POST' : 'DELETE',
        path: `/submolts/${encodeURIComponent(submoltName)}/subscribe`,
      });
      return response.data;
    },
    async markNotificationsReadByPost(postId: string) {
      const response = await request<JsonRecord>({
        method: 'POST',
        path: `/notifications/read-by-post/${encodeURIComponent(postId)}`,
      });
      return response.data;
    },
    async markAllNotificationsRead() {
      const response = await request<JsonRecord>({
        method: 'POST',
        path: '/notifications/read-all',
      });
      return response.data;
    },

    // --- DM (Direct Messaging) Support ---
    async requestDMAccess(targetAgentName: string) {
      // Initiate a DM request to another agent
      const response = await request<JsonRecord>({
        method: 'POST',
        path: `/messaging/request/${encodeURIComponent(targetAgentName)}`,
      });
      return response.data;
    },
    async approveDMRequest(requestId: string) {
      // Approve a pending DM request by request ID
      const response = await request<JsonRecord>({
        method: 'POST',
        path: `/messaging/approve/${encodeURIComponent(requestId)}`,
      });
      return response.data;
    },
    async listDMConversations(options?: { limit?: number; cursor?: string; }) {
      // List DM conversations (optionally paginated)
      const response = await request<JsonRecord>({
        path: '/messaging/conversations',
        query: options,
      });
      return response.data;
    },
    async readDMConversation(conversationId: string, options?: { limit?: number; cursor?: string; }) {
      // Read messages in a DM conversation
      const response = await request<JsonRecord>({
        path: `/messaging/conversations/${encodeURIComponent(conversationId)}`,
        query: options,
      });
      return response.data;
    },
    async sendDMMessage(conversationId: string, content: string) {
      // Send a DM message in a conversation
      const response = await request<JsonRecord>({
        method: 'POST',
        path: `/messaging/conversations/${encodeURIComponent(conversationId)}/send`,
        body: { content },
      });
      return response.data;
    },

    // List pending DM requests (incoming requests to approve)
    async listPendingDMRequests(options?: { limit?: number; cursor?: string; }) {
      // The endpoint is assumed to be /messaging/pending-requests (adjust if needed)
      const response = await request<JsonRecord>({
        path: '/agents/dm/requests',
        query: options,
      });
      return response.data;
    },

    formatProfile,
    formatHome,
    formatNotificationSummary,
    formatFeedItems,
    formatPost,
    formatComments,
    formatSubmoltList,
    formatSubmolt,
    formatSearchResults,
  };
}