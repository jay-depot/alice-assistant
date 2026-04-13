import { useCallback, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ChatHeader } from './components/ChatHeader.js';
import { ErrorToast } from './components/ErrorToast.js';
import { InputArea } from './components/InputArea.js';
import { MessagesArea } from './components/MessagesArea.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { Sidebar } from './components/Sidebar.js';
import { useExtensionContext } from './context/ExtensionContext.js';
import { useSession } from './hooks/useSession.js';
import { useSessions } from './hooks/useSessions.js';
import { useToolCallEvents } from './hooks/useToolCallEvents.js';
import type { PluginClientRoute, ToolCallData } from './types/index.js';

interface ChatWorkspaceProps {
  title: string;
  showDelete: boolean;
  canDelete: boolean;
  isEndingSession: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
  messages: Parameters<typeof MessagesArea>[0]['messages'];
  activeAgents: Parameters<typeof MessagesArea>[0]['activeAgents'];
  showWelcome: boolean;
  isProcessing: boolean;
  pendingMessageKey: string | null;
  lastReadMessageKey: string | null;
  toolCallBatches: Map<string, ToolCallData[]>;
  draft: string;
  setDraft: (value: string) => void;
  submitDraft: () => void;
  isInputDisabled: boolean;
  canSubmitMessage: boolean;
  inputPlaceholder: string;
}

function ChatWorkspace({
  title,
  showDelete,
  canDelete,
  isEndingSession,
  onDelete,
  onOpenSettings,
  messages,
  activeAgents,
  showWelcome,
  isProcessing,
  pendingMessageKey,
  lastReadMessageKey,
  toolCallBatches,
  draft,
  setDraft,
  submitDraft,
  isInputDisabled,
  canSubmitMessage,
  inputPlaceholder,
}: ChatWorkspaceProps) {
  return (
    <main id="main">
      <ChatHeader
        title={title}
        showDelete={showDelete}
        canDelete={canDelete}
        isEndingSession={isEndingSession}
        onDelete={onDelete}
        onOpenSettings={onOpenSettings}
      />
      <MessagesArea
        messages={messages}
        activeAgents={activeAgents}
        showWelcome={showWelcome}
        isProcessing={isProcessing}
        isEndingSession={isEndingSession}
        pendingMessageKey={pendingMessageKey}
        lastReadMessageKey={lastReadMessageKey}
        toolCallBatches={toolCallBatches}
      />
      <InputArea
        value={draft}
        onChange={setDraft}
        onSubmit={submitDraft}
        inputDisabled={isInputDisabled}
        submitDisabled={!canSubmitMessage}
        placeholder={inputPlaceholder}
      />
    </main>
  );
}

function PluginRoutePage({
  route,
  onOpenSettings,
}: {
  route: PluginClientRoute;
  onOpenSettings: () => void;
}) {
  const RouteComponent = route.component;
  const pageTitle =
    route.title?.trim() || route.path.replace(/^\//, '') || 'Plugin Page';

  return (
    <main id="main">
      <ChatHeader
        title={pageTitle}
        showDelete={false}
        canDelete={false}
        isEndingSession={false}
        onDelete={() => undefined}
        onOpenSettings={onOpenSettings}
      />
      <div className="plugin-route-page">
        <RouteComponent />
      </div>
    </main>
  );
}

export function App() {
  const [draft, setDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { routes } = useExtensionContext();
  const { sessions, refreshSessions } = useSessions(setErrorMessage);
  const {
    currentSessionId,
    messages,
    activeAgents,
    sessionTitle,
    isEndingSession,
    isProcessingMessage,
    pendingMessageKey,
    lastReadMessageKey,
    showDeleteSession,
    canDeleteSession,
    canSubmitMessage,
    isInputDisabled,
    inputPlaceholder,
    loadSession,
    handleNewChat,
    sendMessage,
    deleteSession,
    showWelcome,
  } = useSession({
    onError: setErrorMessage,
    refreshSessions,
  });

  const { toolCallBatches } = useToolCallEvents(
    currentSessionId,
    isProcessingMessage
  );

  const pluginRoutes = routes.filter(route => route.path !== '/');

  const submitDraft = useCallback(async () => {
    const trimmedDraft = draft.trim();
    if (!trimmedDraft) {
      return;
    }

    setDraft('');
    await sendMessage(trimmedDraft);
  }, [draft, sendMessage]);

  return (
    <BrowserRouter>
      <Sidebar
        sessions={sessions}
        routes={pluginRoutes}
        currentSessionId={currentSessionId}
        onSelectSession={id => {
          void loadSession(id);
        }}
        onNewChat={() => {
          void handleNewChat();
        }}
      />

      <Routes>
        <Route
          path="/"
          element={
            <ChatWorkspace
              title={sessionTitle}
              showDelete={showDeleteSession}
              canDelete={canDeleteSession}
              isEndingSession={isEndingSession}
              onDelete={() => {
                void deleteSession();
              }}
              onOpenSettings={() => setIsSettingsOpen(true)}
              messages={messages}
              activeAgents={activeAgents}
              showWelcome={showWelcome}
              isProcessing={isProcessingMessage}
              pendingMessageKey={pendingMessageKey}
              lastReadMessageKey={lastReadMessageKey}
              toolCallBatches={toolCallBatches}
              draft={draft}
              setDraft={setDraft}
              submitDraft={() => {
                void submitDraft();
              }}
              isInputDisabled={isInputDisabled}
              canSubmitMessage={canSubmitMessage}
              inputPlaceholder={inputPlaceholder}
            />
          }
        />
        {pluginRoutes.map(route => (
          <Route
            key={route.path}
            path={route.path}
            element={
              <PluginRoutePage
                route={route}
                onOpenSettings={() => setIsSettingsOpen(true)}
              />
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <ErrorToast
        message={errorMessage}
        onClear={() => setErrorMessage(null)}
      />
    </BrowserRouter>
  );
}
