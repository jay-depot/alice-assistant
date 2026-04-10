import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSession, endSession, fetchSession, patchSession } from '../api/sessions.js';
import type { Message } from '../types/index.js';

interface UseSessionOptions {
  onError?: (message: string) => void;
  refreshSessions?: () => Promise<void>;
}

const DEFAULT_TITLE = 'A.L.I.C.E.';

export function useSession({ onError, refreshSessions }: UseSessionOptions = {}) {
  const [currentSessionId, setCurrentSessionId] = useState<number | string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionTitle, setSessionTitle] = useState(DEFAULT_TITLE);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const reportError = useCallback((message: string, error: unknown) => {
    console.error(message, error);
    onError?.(message);
  }, [onError]);

  const loadSession = useCallback(async (id: number | string) => {
    if (isLoading) {
      return;
    }

    setIsLoading(true);

    try {
      const session = await fetchSession(id);
      setCurrentSessionId(session.id);
      setMessages(session.messages);
      setSessionTitle(session.title);
    } catch (error) {
      reportError('Failed to load conversation.', error);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, reportError]);

  const handleNewChat = useCallback(async () => {
    if (isLoading) {
      return;
    }

    setCurrentSessionId(null);
    setMessages([]);
    setSessionTitle('Starting...');
    setIsLoading(true);
    setIsTyping(true);

    try {
      const session = await createSession();
      setCurrentSessionId(session.id);
      setMessages(session.messages);
      setSessionTitle(session.title);
      await refreshSessions?.();
    } catch (error) {
      setMessages([]);
      setSessionTitle(DEFAULT_TITLE);
      reportError('Failed to start new conversation.', error);
    } finally {
      setIsTyping(false);
      setIsLoading(false);
    }
  }, [isLoading, refreshSessions, reportError]);

  const sendMessage = useCallback(async (content: string) => {
    const message = content.trim();
    if (!message || isLoading || currentSessionId === null) {
      return;
    }

    const optimisticMessage: Message = {
      role: 'user',
      messageKind: 'chat',
      content: message,
      timestamp: new Date().toISOString(),
    };

    setMessages((currentMessages) => [...currentMessages, optimisticMessage]);
    setIsLoading(true);
    setIsTyping(true);

    try {
      const session = await patchSession(currentSessionId, message);
      setMessages(session.messages);
      setSessionTitle(session.title);
      await refreshSessions?.();
    } catch (error) {
      reportError('Failed to send message. Please try again.', error);
      await loadSession(currentSessionId);
    } finally {
      setIsTyping(false);
      setIsLoading(false);
    }
  }, [currentSessionId, isLoading, loadSession, refreshSessions, reportError]);

  const deleteSession = useCallback(async () => {
    if (currentSessionId === null || isLoading) {
      return;
    }

    const confirmed = window.confirm(
      'End this session? Alice will summarize and archive the conversation.'
    );

    if (!confirmed) {
      return;
    }

    setIsLoading(true);

    try {
      await endSession(currentSessionId);
      setCurrentSessionId(null);
      setMessages([]);
      setSessionTitle(DEFAULT_TITLE);
      await refreshSessions?.();
    } catch (error) {
      reportError('Failed to end session.', error);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
    }
  }, [currentSessionId, isLoading, refreshSessions, reportError]);

  const resetToWelcome = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setSessionTitle(DEFAULT_TITLE);
    setIsTyping(false);
  }, []);

  const inputPlaceholder = useMemo(() => {
    if (isLoading && currentSessionId === null) {
      return 'Starting new conversation...';
    }

    if (currentSessionId === null) {
      return 'Start a new chat to begin...';
    }

    return 'Type a message... (Enter to send, Shift+Enter for newline)';
  }, [currentSessionId, isLoading]);

  useEffect(() => {
    if (currentSessionId === null || isLoading) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const session = await fetchSession(currentSessionId);
          const currentLastMessage = messages[messages.length - 1];
          const incomingLastMessage = session.messages[session.messages.length - 1];
          const hasNewMessages = session.messages.length !== messages.length
            || session.title !== sessionTitle
            || incomingLastMessage?.timestamp !== currentLastMessage?.timestamp
            || incomingLastMessage?.content !== currentLastMessage?.content;

          if (!hasNewMessages) {
            return;
          }

          setMessages(session.messages);
          setSessionTitle(session.title);
          await refreshSessions?.();
        } catch (error) {
          console.error('Failed to poll active conversation for updates:', error);
        }
      })();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentSessionId, isLoading, messages, refreshSessions, sessionTitle]);

  return {
    currentSessionId,
    messages,
    sessionTitle,
    isLoading,
    isTyping,
    showWelcome: currentSessionId === null && messages.length === 0 && !isLoading,
    canDeleteSession: currentSessionId !== null && !isLoading,
    canSendMessage: currentSessionId !== null && !isLoading,
    inputPlaceholder,
    loadSession,
    handleNewChat,
    sendMessage,
    deleteSession,
    resetToWelcome,
  };
}
