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
import type { PluginClientRoute } from './types/index.js';

interface ChatWorkspaceProps {
  title: string;
  canDelete: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
  messages: Parameters<typeof MessagesArea>[0]['messages'];
  showWelcome: boolean;
  isTyping: boolean;
  draft: string;
  setDraft: (value: string) => void;
  submitDraft: () => void;
  canSendMessage: boolean;
  inputPlaceholder: string;
}

function ChatWorkspace({
  title,
  canDelete,
  onDelete,
  onOpenSettings,
  messages,
  showWelcome,
  isTyping,
  draft,
  setDraft,
  submitDraft,
  canSendMessage,
  inputPlaceholder,
}: ChatWorkspaceProps) {
  return (
    <main id="main">
      <ChatHeader
        title={title}
        canDelete={canDelete}
        onDelete={onDelete}
        onOpenSettings={onOpenSettings}
      />
      <MessagesArea messages={messages} showWelcome={showWelcome} isTyping={isTyping} />
      <InputArea
        value={draft}
        onChange={setDraft}
        onSubmit={submitDraft}
        disabled={!canSendMessage}
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
  const pageTitle = route.title?.trim() || route.path.replace(/^\//, '') || 'Plugin Page';

  return (
    <main id="main">
      <ChatHeader title={pageTitle} canDelete={false} onDelete={() => undefined} onOpenSettings={onOpenSettings} />
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
    sessionTitle,
    isTyping,
    canDeleteSession,
    canSendMessage,
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

  const pluginRoutes = routes.filter((route) => route.path !== '/');

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
        onSelectSession={(id) => {
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
              canDelete={canDeleteSession}
              onDelete={() => {
                void deleteSession();
              }}
              onOpenSettings={() => setIsSettingsOpen(true)}
              messages={messages}
              showWelcome={showWelcome}
              isTyping={isTyping}
              draft={draft}
              setDraft={setDraft}
              submitDraft={() => {
                void submitDraft();
              }}
              canSendMessage={canSendMessage}
              inputPlaceholder={inputPlaceholder}
            />
          }
        />
        {pluginRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={<PluginRoutePage route={route} onOpenSettings={() => setIsSettingsOpen(true)} />}
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <ErrorToast message={errorMessage} onClear={() => setErrorMessage(null)} />
    </BrowserRouter>
  );
}
