import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchSession } from '../api/sessions.js';
import type { ActiveSessionAgent, Message, Session } from '../types/index.js';
import { getMessageIdentityKey } from '../utils.js';
import { useWebSocket } from './useWebSocket.js';

interface UseSessionOptions {
  onError?: (message: string) => void;
}

const DEFAULT_TITLE = 'A.L.I.C.E.';

function getLastReadMessageKey(messages: Message[]): string | null {
  let hasTrailingAssistantMessage = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') {
      hasTrailingAssistantMessage = true;
      continue;
    }

    if (message.role === 'user' && hasTrailingAssistantMessage) {
      return getMessageIdentityKey(message);
    }
  }

  return null;
}

export function useSession({ onError }: UseSessionOptions = {}) {
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

  const { subscribe, send } = useWebSocket();

  const handleNewChat = useCallback(() => {
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

    send({ type: 'create_session' });
    // The session_created or session_updated WS message applies state and
    // clears isSessionBusy in the subscription handler below.
  }, [isEndingSession, isProcessingMessage, isSessionBusy, send]);

  const sendMessage = useCallback(
    (content: string) => {
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
      const optimisticMessageKey = getMessageIdentityKey(optimisticMessage);

      setMessages(currentMessages => [...currentMessages, optimisticMessage]);
      setPendingMessageKey(optimisticMessageKey);
      setIsProcessingMessage(true);

      const numericSessionId =
        typeof currentSessionId === 'string'
          ? parseInt(currentSessionId)
          : currentSessionId;

      send({
        type: 'send_message',
        sessionId: numericSessionId,
        content: message,
        clientMessageKey: optimisticMessageKey,
      });
      // The session_updated WS message applies state and clears
      // isProcessingMessage / pendingMessageKey in the subscription below.
    },
    [
      currentSessionId,
      isEndingSession,
      isProcessingMessage,
      isSessionBusy,
      send,
    ]
  );

  const deleteSession = useCallback(() => {
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

    const numericSessionId =
      typeof currentSessionId === 'string'
        ? parseInt(currentSessionId)
        : currentSessionId;

    send({ type: 'end_session', sessionId: numericSessionId });
    // The session_ended WS message triggers state cleanup in the subscription.
  }, [
    currentSessionId,
    isEndingSession,
    isProcessingMessage,
    isSessionBusy,
    send,
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

  // ── WebSocket event subscriptions ────────────────────────────────────────
  // Server pushes session state via WS. We use these to complete the async
  // round-trip for sendMessage / handleNewChat / deleteSession.

  useEffect(() => {
    if (currentSessionId === null) {
      return subscribe(msg => {
        if (msg.type === 'session_created') {
          applySessionState(msg.session as unknown as Session);
          setIsSessionBusy(false);
        }
      });
    }

    const numericSessionId =
      typeof currentSessionId === 'string'
        ? parseInt(currentSessionId)
        : currentSessionId;

    return subscribe(msg => {
      switch (msg.type) {
        case 'session_updated':
          if (msg.sessionId === numericSessionId) {
            applySessionState(msg.session as unknown as Session);
            // Clear transport-level busy flags — safe even if triggered by
            // another tab's update (false → false is a React no-op).
            setIsProcessingMessage(false);
            setPendingMessageKey(null);
            setIsSessionBusy(false);
          }
          break;

        case 'session_created':
          applySessionState(msg.session as unknown as Session);
          setIsSessionBusy(false);
          break;

        case 'session_ended':
          if (msg.sessionId === numericSessionId) {
            resetToWelcome();
            setIsEndingSession(false);
          }
          break;

        case 'message_error':
          if (msg.sessionId === numericSessionId || currentSessionId === 0) {
            reportError('Failed to send message. Please try again.', msg.error);
            if (currentSessionId !== null && currentSessionId !== 0) {
              void reloadSession(currentSessionId);
            }
            setIsProcessingMessage(false);
            setPendingMessageKey(null);
            setIsSessionBusy(false);
          }
          break;
      }
    });
  }, [
    currentSessionId,
    applySessionState,
    reloadSession,
    reportError,
    resetToWelcome,
    subscribe,
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
