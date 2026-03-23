// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Session {
  id: number | string;
  title: string;
  createdAt: string;
  messages: Message[];
}

interface SessionSummary {
  id: number | string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

interface MoodResponse {
  mood: string;
}

// ── State ──────────────────────────────────────────────────────────────────

let currentSessionId: number | string | null = null;
let isLoading = false;
let moodPollIntervalId: number | null = null;
let isPollingMood = false;
let currentMoodClass = 'neutral';

// ── DOM references ─────────────────────────────────────────────────────────

const sessionsList    = document.getElementById('sessions-list')    as HTMLDivElement;
const messagesArea    = document.getElementById('messages-area')    as HTMLDivElement;
const messageInput    = document.getElementById('message-input')    as HTMLTextAreaElement;
const sendBtn         = document.getElementById('send-btn')         as HTMLButtonElement;
const newChatBtn      = document.getElementById('new-chat-btn')     as HTMLButtonElement;
const sessionTitle    = document.getElementById('session-title')    as HTMLSpanElement;
const deleteSessionBtn = document.getElementById('delete-session-btn') as HTMLButtonElement;
const welcomeScreen   = document.getElementById('welcome-screen')   as HTMLDivElement;
const moodBox         = document.getElementById('mood-box')         as HTMLDivElement | null;

// ── API ────────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchSessions(): Promise<SessionSummary[]> {
  const data = await apiFetch<{ sessions: SessionSummary[] }>('/api/chat');
  return data.sessions;
}

async function fetchSession(id: number | string): Promise<Session> {
  const data = await apiFetch<{ session: Session }>(`/api/chat/${id}`);
  return data.session;
}

async function createSession(): Promise<Session> {
  const data = await apiFetch<{ session: Session }>('/api/chat', {
    method: 'POST',
  });
  return data.session;
}

async function patchSession(id: number | string, message: string): Promise<Session> {
  const data = await apiFetch<{ session: Session }>(`/api/chat/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ message }),
  });
  return data.session;
}

async function endSession(id: number | string): Promise<void> {
  await apiFetch(`/api/chat/${id}`, { method: 'DELETE' });
}

async function fetchMood(): Promise<string> {
  const data = await apiFetch<MoodResponse>('/api/mood');
  return data.mood;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins  = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);
  if (diffMins  < 1)  return 'just now';
  if (diffMins  < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays  < 7)  return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeMoodClass(mood: string): string {
  const normalizedMood = mood.trim().toLowerCase().replace(/\s+/g, '-');
  return normalizedMood || 'neutral';
}

function updateMoodBox(mood: string): void {
  if (!moodBox) return;

  const nextMoodClass = normalizeMoodClass(mood);
  moodBox.classList.remove(currentMoodClass);
  moodBox.classList.add(nextMoodClass);
  moodBox.title = nextMoodClass;
  currentMoodClass = nextMoodClass;
}

async function pollMood(): Promise<void> {
  if (isPollingMood) return;
  isPollingMood = true;
  try {
    updateMoodBox(await fetchMood());
  } catch (err) {
    console.error('Failed to poll mood:', err);
  } finally {
    isPollingMood = false;
  }
}

function startMoodPolling(): void {
  if (moodPollIntervalId !== null) return;
  pollMood();
  moodPollIntervalId = window.setInterval(() => {
    void pollMood();
  }, 3000);
}

function stopMoodPolling(): void {
  if (moodPollIntervalId !== null) {
    window.clearInterval(moodPollIntervalId);
    moodPollIntervalId = null;
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderSessionList(sessions: SessionSummary[]): void {
  sessionsList.innerHTML = '';

  if (sessions.length === 0) {
    sessionsList.innerHTML = '<div class="sessions-empty">No previous sessions</div>';
    return;
  }

  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = `session-item${s.id === currentSessionId ? ' session-item--active' : ''}`;
    item.dataset.id = String(s.id);
    item.innerHTML = `
      <div class="session-item__title">${escapeHtml(s.title)}</div>
      <div class="session-item__preview">${escapeHtml(s.lastAssistantMessage ?? '')}</div>
      <div class="session-item__time">${formatRelativeTime(s.lastMessageAt)}</div>
    `;
    item.addEventListener('click', () => { loadSession(s.id); });
    sessionsList.appendChild(item);
  }
}

function renderMessages(messages: Message[]): void {
  messagesArea.innerHTML = '';
  for (const msg of messages) {
    appendMessageBubble(msg.role, msg.content, msg.timestamp);
  }
  scrollToBottom();
}

function appendMessageBubble(
  role: 'user' | 'assistant',
  content: string,
  timestamp?: string,
): void {
  const wrapper = document.createElement('div');
  wrapper.className = `message message--${role}`;
  const timeStr = timestamp ? formatTime(timestamp) : formatTime(new Date().toISOString());
  wrapper.innerHTML = `
    <div class="message__bubble">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
    <div class="message__meta">${timeStr}</div>
  `;
  messagesArea.appendChild(wrapper);
  scrollToBottom();
}

function showTypingIndicator(): void {
  const el = document.createElement('div');
  el.className = 'message message--assistant typing-message';
  el.id = 'typing-indicator';
  el.innerHTML = `
    <div class="message__bubble typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  messagesArea.appendChild(el);
  scrollToBottom();
}

function removeTypingIndicator(): void {
  document.getElementById('typing-indicator')?.remove();
}

function scrollToBottom(): void {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ── UI state transitions ───────────────────────────────────────────────────

function showWelcomeScreen(): void {
  welcomeScreen.style.display = 'flex';
  sessionTitle.textContent    = 'A.L.I.C.E.';
  deleteSessionBtn.classList.add('hidden');
  messageInput.disabled       = true;
  sendBtn.disabled            = true;
  messageInput.placeholder    = 'Start a new chat to begin...';
}

function enterChatMode(title: string): void {
  welcomeScreen.style.display = 'none';
  sessionTitle.textContent    = title;
  deleteSessionBtn.classList.remove('hidden');
  messageInput.disabled       = false;
  sendBtn.disabled            = false;
  messageInput.placeholder    = 'Type a message... (Enter to send, Shift+Enter for newline)';
  messageInput.focus();
}

function setSidebarActiveSession(id: number | string | null): void {
  document.querySelectorAll<HTMLElement>('.session-item').forEach(el => {
    el.classList.toggle('session-item--active', id !== null && el.dataset.id === String(id));
  });
}

// ── Actions ────────────────────────────────────────────────────────────────

async function loadSession(id: number | string): Promise<void> {
  if (isLoading) return;
  isLoading = true;
  try {
    const session = await fetchSession(id);
    currentSessionId  = session.id;
    renderMessages(session.messages);
    enterChatMode(session.title);
    setSidebarActiveSession(session.id);
  } catch (err) {
    console.error('Failed to load session:', err);
    showError('Failed to load conversation.');
  } finally {
    isLoading = false;
  }
}

async function refreshSessionList(): Promise<void> {
  try {
    renderSessionList(await fetchSessions());
  } catch (err) {
    console.error('Failed to refresh sessions:', err);
  }
}

async function handleSend(): Promise<void> {
  const message = messageInput.value.trim();
  if (!message || isLoading || currentSessionId === null) return;

  messageInput.value = '';
  resizeTextarea();
  isLoading        = true;
  sendBtn.disabled = true;

  appendMessageBubble('user', message);
  showTypingIndicator();

  try {
    const session = await patchSession(currentSessionId, message);
    renderMessages(session.messages);
  } catch (err) {
    console.error('Failed to send message:', err);
    removeTypingIndicator();
    showError('Failed to send message. Please try again.');
  } finally {
    isLoading        = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

async function handleNewChat(): Promise<void> {
  if (isLoading) return;

  currentSessionId = null;
  messagesArea.innerHTML = '';
  welcomeScreen.style.display = 'none';
  sessionTitle.textContent = 'Starting...';
  deleteSessionBtn.classList.add('hidden');
  messageInput.disabled = true;
  sendBtn.disabled = true;
  messageInput.placeholder = 'Starting new conversation...';
  setSidebarActiveSession(null);

  isLoading = true;
  showTypingIndicator();

  try {
    const session = await createSession();
    currentSessionId = session.id;
    renderMessages(session.messages);
    enterChatMode(session.title);
    await refreshSessionList();
    setSidebarActiveSession(session.id);
  } catch (err) {
    console.error('Failed to create session:', err);
    removeTypingIndicator();
    showError('Failed to start new conversation.');
    showWelcomeScreen();
  } finally {
    isLoading = false;
  }
}

async function handleDeleteSession(): Promise<void> {
  if (currentSessionId === null || isLoading) return;

  const confirmed = confirm(
    'End this session? Alice will summarize and archive the conversation.'
  );
  if (!confirmed) return;

  isLoading = true;
  try {
    await endSession(currentSessionId);
    currentSessionId = null;
    messagesArea.innerHTML = '';
    showWelcomeScreen();
    await refreshSessionList();
  } catch (err) {
    console.error('Failed to end session:', err);
    showError('Failed to end session.');
  } finally {
    isLoading = false;
  }
}

function showError(message: string): void {
  const toast = document.createElement('div');
  toast.className   = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Textarea auto-resize ───────────────────────────────────────────────────

function resizeTextarea(): void {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 150)}px`;
}

// ── Event listeners ────────────────────────────────────────────────────────

newChatBtn.addEventListener('click', () => { void handleNewChat(); });
deleteSessionBtn.addEventListener('click', () => { void handleDeleteSession(); });
sendBtn.addEventListener('click', () => { void handleSend(); });

messageInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void handleSend();
  }
});

messageInput.addEventListener('input', resizeTextarea);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopMoodPolling();
    return;
  }

  startMoodPolling();
});

// ── Init ───────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  showWelcomeScreen();
  startMoodPolling();
  try {
    renderSessionList(await fetchSessions());
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

init();

window.addEventListener('beforeunload', stopMoodPolling);
