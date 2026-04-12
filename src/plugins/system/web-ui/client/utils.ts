export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return 'just now';
  }

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString();
}

export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getMessageKey({
  role,
  messageKind,
  timestamp,
  content,
}: {
  role: string;
  messageKind: string;
  timestamp: string;
  content: string;
}): string {
  return `${role}:${messageKind}:${timestamp}:${content}`;
}

export function isDisplayableMessage({
  role,
  messageKind,
  content,
}: {
  role: string;
  messageKind: string;
  content: string;
}): boolean {
  if (role === 'assistant' && messageKind === 'chat') {
    return content.trim().length > 0;
  }

  return true;
}

export function normalizeMoodClass(mood: string): string {
  const normalizedMood = mood.trim().toLowerCase().replace(/\s+/g, '-');
  return normalizedMood || 'neutral';
}

export function classNames(
  ...names: Array<string | false | null | undefined>
): string {
  return names.filter(Boolean).join(' ');
}
