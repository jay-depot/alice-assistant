import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createSession,
  endSession,
  fetchSession,
  patchSession,
} from '../api/sessions.js';
import type { ActiveSessionAgent, Message, Session } from '../types/index.js';
import { getMessageKey } from '../utils.js';

interface UseSessionOptions {
  onError?: (message: string) => void;
  refreshSessions?: () => Promise<void>;
}

const DEFAULT_TITLE = 'A.L.I.C.E.';

function getActiveAgentsStateKey(activeAgents: ActiveSessionAgent[]): string {
  return activeAgents
    .map(agent =>
      [
        agent.instanceId,
        agent.status,
        agent.pendingMessageCount,
        agent.startedAt,
      ].join(':')
    )
    .join('|');
}

function getLastReadMessageKey(messages: Message[]): string | null {
  let hasTrailingAssistantMessage = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') {
      hasTrailingAssistantMessage = true;
      continue;
    }

    if (message.role === 'user' && hasTrailingAssistantMessage) {
      return getMessageKey(message);
    }
  }

  return null;
}

export function useSession({
  onError,
  refreshSessions,
}: UseSessionOptions = {}) {
  const [currentSessionId, setCurrentSessionId] = useState<
    number | string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionTitle, setSessionTitle] = useState(DEFAULT_TITLE);
  const [isSessionBusy, setIsSessionBusy] = useState(false);
  const [isProcessingMessage, setIsProcessingMessage] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [pendingMessageKey, setPendingMessageKey] = useState<string | null>(
    null
  );
  const [lastReadMessageKey, setLastReadMessageKey] = useState<string | null>(
    null
  );
  const [activeAgents, setActiveAgents] = useState<ActiveSessionAgent[]>([]);

  const reportError = useCallback(
    (message: string, error: unknown) => {
      console.error(message, error);
      onError?.(message);
    },
    [onError]
  );

  const applySessionState = useCallback((session: Session) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setSessionTitle(session.title);
    setActiveAgents(session.activeAgents);
    setLastReadMessageKey(getLastReadMessageKey(session.messages));
  }, []);

  const reloadSession = useCallback(
    async (id: number | string) => {
      const session = await fetchSession(id);
      applySessionState(session);
    },
    [applySessionState]
  );

  const loadSession = useCallback(
    async (id: number | string) => {
      if (isSessionBusy || isProcessingMessage || isEndingSession) {
        return;
      }

      setIsSessionBusy(true);

      try {
        await reloadSession(id);
      } catch (error) {
        reportError('Failed to load conversation.', error);
      } finally {
        setIsSessionBusy(false);
      }
    },
    [
      isEndingSession,
      isProcessingMessage,
      isSessionBusy,
      reloadSession,
      reportError,
    ]
  );

  const handleNewChat = useCallback(async () => {
    if (isSessionBusy || isProcessingMessage || isEndingSession) {
      return;
    }

    setCurrentSessionId(null);
    setMessages([]);
    setSessionTitle('Starting...');
    setPendingMessageKey(null);
    setLastReadMessageKey(null);
    setActiveAgents([]);
    setIsSessionBusy(true);

    try {
      const session = await createSession();
      applySessionState(session);
      await refreshSessions?.();
    } catch (error) {
      setMessages([]);
      setSessionTitle(DEFAULT_TITLE);
      setPendingMessageKey(null);
      setLastReadMessageKey(null);
      setActiveAgents([]);
      reportError('Failed to start new conversation.', error);
    } finally {
      setIsSessionBusy(false);
    }
  }, [
    applySessionState,
    isEndingSession,
    isProcessingMessage,
    isSessionBusy,
    refreshSessions,
    reportError,
  ]);

  const sendMessage = useCallback(
    async (content: string) => {
      const message = content.trim();
      if (
        !message ||
        isSessionBusy ||
        isProcessingMessage ||
        isEndingSession ||
        currentSessionId === null
      ) {
        return;
      }

      const optimisticMessage: Message = {
        role: 'user',
        messageKind: 'chat',
        content: message,
        timestamp: new Date().toISOString(),
      };
      const optimisticMessageKey = getMessageKey(optimisticMessage);

      setMessages(currentMessages => [...currentMessages, optimisticMessage]);
      setPendingMessageKey(optimisticMessageKey);
      setIsProcessingMessage(true);

      try {
        const session = await patchSession(currentSessionId, message);
        applySessionState(session);
        await refreshSessions?.();
      } catch (error) {
        reportError('Failed to send message. Please try again.', error);
        try {
          await reloadSession(currentSessionId);
        } catch (reloadError) {
          reportError('Failed to reload conversation.', reloadError);
        }
      } finally {
        setPendingMessageKey(null);
        setIsProcessingMessage(false);
      }
    },
    [
      applySessionState,
      currentSessionId,
      isEndingSession,
      isProcessingMessage,
      isSessionBusy,
      refreshSessions,
      reloadSession,
      reportError,
    ]
  );

  const deleteSession = useCallback(async () => {
    if (
      currentSessionId === null ||
      isSessionBusy ||
      isProcessingMessage ||
      isEndingSession
    ) {
      return;
    }

    const confirmed = window.confirm(
      'End this session? Alice will summarize and archive the conversation.'
    );

    if (!confirmed) {
      return;
    }

    setIsEndingSession(true);

    try {
      await endSession(currentSessionId);
      setCurrentSessionId(null);
      setMessages([]);
      setSessionTitle(DEFAULT_TITLE);
      setPendingMessageKey(null);
      setLastReadMessageKey(null);
      setActiveAgents([]);
      await refreshSessions?.();
    } catch (error) {
      reportError('Failed to end session.', error);
    } finally {
      setIsEndingSession(false);
    }
  }, [
    currentSessionId,
    isEndingSession,
    isProcessingMessage,
    isSessionBusy,
    refreshSessions,
    reportError,
  ]);

  const resetToWelcome = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setSessionTitle(DEFAULT_TITLE);
    setPendingMessageKey(null);
    setLastReadMessageKey(null);
    setActiveAgents([]);
  }, []);

  const inputPlaceholder = useMemo(() => {
    if (isSessionBusy && currentSessionId === null) {
      return 'Starting new conversation...';
    }

    if (currentSessionId === null) {
      return 'Start a new chat to begin...';
    }

    return 'Type a message... (Enter to send, Shift+Enter for newline)';
  }, [currentSessionId, isSessionBusy]);

  useEffect(() => {
    if (
      currentSessionId === null ||
      isSessionBusy ||
      isProcessingMessage ||
      isEndingSession
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const session = await fetchSession(currentSessionId);
          const currentLastMessage = messages[messages.length - 1];
          const incomingLastMessage =
            session.messages[session.messages.length - 1];
          const hasNewMessages =
            session.messages.length !== messages.length ||
            session.title !== sessionTitle ||
            incomingLastMessage?.timestamp !== currentLastMessage?.timestamp ||
            incomingLastMessage?.content !== currentLastMessage?.content;

          const hasAgentUpdates =
            getActiveAgentsStateKey(session.activeAgents) !==
            getActiveAgentsStateKey(activeAgents);

          if (!hasNewMessages && !hasAgentUpdates) {
            return;
          }

          applySessionState(session);
          await refreshSessions?.();
        } catch (error) {
          console.error(
            'Failed to poll active conversation for updates:',
            error
          );
        }
      })();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    applySessionState,
    currentSessionId,
    isEndingSession,
    isProcessingMessage,
    isSessionBusy,
    messages,
    activeAgents,
    refreshSessions,
    sessionTitle,
  ]);

  return {
    currentSessionId,
    messages,
    sessionTitle,
    isSessionBusy,
    isProcessingMessage,
    isEndingSession,
    pendingMessageKey,
    lastReadMessageKey,
    activeAgents,
    showWelcome:
      currentSessionId === null && messages.length === 0 && !isSessionBusy,
    showDeleteSession: currentSessionId !== null,
    canDeleteSession:
      currentSessionId !== null &&
      !isSessionBusy &&
      !isProcessingMessage &&
      !isEndingSession,
    canSubmitMessage:
      currentSessionId !== null &&
      !isSessionBusy &&
      !isProcessingMessage &&
      !isEndingSession,
    isInputDisabled:
      currentSessionId === null || isSessionBusy || isEndingSession,
    inputPlaceholder,
    loadSession,
    handleNewChat,
    sendMessage,
    deleteSession,
    resetToWelcome,
  };
}
