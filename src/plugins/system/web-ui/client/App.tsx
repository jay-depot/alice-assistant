import { useCallback, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { ChatHeader } from './components/ChatHeader.js';
import { ErrorToast } from './components/ErrorToast.js';
import { InputArea } from './components/InputArea.js';
import { MessagesArea } from './components/MessagesArea.js';
import { ActiveAgentsPanel } from './components/ActiveAgentsPanel.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { Sidebar } from './components/Sidebar.js';
import { useExtensionContext } from './context/ExtensionContext.js';
import { useSession } from './hooks/useSession.js';
import { useSessions } from './hooks/useSessions.js';
import { useStreamingSession } from './hooks/useStreamingSession.js';
import type { StreamTurn } from './hooks/useStreamingSession.js';
import { useToolCallEvents } from './hooks/useToolCallEvents.js';
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENTS_PER_MESSAGE,
} from '../ws-types.js';
import type {
  ActiveSessionAgent,
  ImageAttachment,
  PluginClientRoute,
  ToolCallData,
} from './types/index.js';

interface ChatWorkspaceProps {
  title: string;
  showDelete: boolean;
  canDelete: boolean;
  isEndingSession: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
  messages: Parameters<typeof MessagesArea>[0]['messages'];
  activeAgents: ActiveSessionAgent[];
  agentMonologue: Map<string, string>;
  showWelcome: boolean;
  isProcessing: boolean;
  pendingMessageKey: string | null;
  lastReadMessageKey: string | null;
  toolCallBatches: Map<string, ToolCallData[]>;
  pendingAssistantMessage: string | null;
  completedTurns: StreamTurn[];
  currentStreamTurn: StreamTurn | null;
  finalContent: string;
  finalReasoning: string | null;
  isStreaming: boolean;
  draft: string;
  setDraft: (value: string) => void;
  submitDraft: () => void;
  isInputDisabled: boolean;
  canSubmitMessage: boolean;
  inputPlaceholder: string;
  attachments: ImageAttachment[];
  onSelectFiles: (files: FileList | null) => void;
  onClearAttachments: () => void;
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
  agentMonologue,
  showWelcome,
  isProcessing,
  pendingMessageKey,
  lastReadMessageKey,
  toolCallBatches,
  pendingAssistantMessage,
  completedTurns,
  currentStreamTurn,
  finalContent,
  finalReasoning,
  isStreaming,
  draft,
  setDraft,
  submitDraft,
  isInputDisabled,
  canSubmitMessage,
  inputPlaceholder,
  attachments,
  onSelectFiles,
  onClearAttachments,
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
      {activeAgents.length > 0 ? (
        <ActiveAgentsPanel
          activeAgents={activeAgents}
          agentMonologue={agentMonologue}
        />
      ) : null}
      <MessagesArea
        messages={messages}
        showWelcome={showWelcome}
        isProcessing={isProcessing}
        isEndingSession={isEndingSession}
        pendingMessageKey={pendingMessageKey}
        lastReadMessageKey={lastReadMessageKey}
        toolCallBatches={toolCallBatches}
        pendingAssistantMessage={pendingAssistantMessage}
        completedTurns={completedTurns}
        currentStreamTurn={currentStreamTurn}
        finalContent={finalContent}
        finalReasoning={finalReasoning}
        isStreaming={isStreaming}
      />
      <InputArea
        value={draft}
        onChange={setDraft}
        onSubmit={submitDraft}
        attachments={attachments}
        onSelectFiles={onSelectFiles}
        onClearAttachments={onClearAttachments}
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
  onBack,
}: {
  route: PluginClientRoute;
  onOpenSettings: () => void;
  onBack: () => void;
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
        onBack={onBack}
      />
      <div className="plugin-route-page">
        <RouteComponent />
      </div>
    </main>
  );
}

function AppShell() {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const { routes } = useExtensionContext();
  const { sessions } = useSessions(setErrorMessage);
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
  });

  const {
    turns,
    currentTurn,
    finalContent,
    finalReasoning,
    isStreaming,
    reset: resetStreaming,
  } = useStreamingSession(currentSessionId);

  const {
    toolCallBatches,
    pendingAssistantMessage,
    agentMonologue,
    clear: clearToolCalls,
  } = useToolCallEvents(currentSessionId, messages);

  const pluginRoutes = routes.filter(route => route.path !== '/');

  const validateAttachmentBatch = useCallback(
    (files: File[]) => {
      const imageFiles = files.filter(file => file.type.startsWith('image/'));

      if (imageFiles.length !== files.length) {
        setErrorMessage('Only image files can be attached to chat messages.');
        return null;
      }

      if (
        attachments.length + imageFiles.length >
        MAX_IMAGE_ATTACHMENTS_PER_MESSAGE
      ) {
        setErrorMessage(
          `You can attach at most ${MAX_IMAGE_ATTACHMENTS_PER_MESSAGE} images per message.`
        );
        return null;
      }

      const oversizedFile = imageFiles.find(
        file => file.size > MAX_IMAGE_ATTACHMENT_BYTES
      );
      if (oversizedFile) {
        setErrorMessage(
          `Image "${oversizedFile.name}" is too large. The limit is ${Math.round(
            MAX_IMAGE_ATTACHMENT_BYTES / (1024 * 1024)
          )} MiB per image.`
        );
        return null;
      }

      return imageFiles;
    },
    [attachments.length]
  );

  const handleSelectFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const validatedFiles = validateAttachmentBatch([...files]);
      if (!validatedFiles) {
        return;
      }

      const converted = await Promise.all(
        validatedFiles.map(
          file =>
            new Promise<ImageAttachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  name: file.name,
                  mimeType: file.type,
                  dataUrl: String(reader.result),
                });
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            })
        )
      );

      setAttachments(current => [...current, ...converted]);
    },
    [validateAttachmentBatch]
  );

  const submitDraft = useCallback(() => {
    const trimmedDraft = draft.trim();
    if (!trimmedDraft && attachments.length === 0) {
      return;
    }

    setDraft('');
    setAttachments([]);
    // Clear the previous message cycle's transient state before the
    // new send so turns and tool batches don't bleed across messages.
    resetStreaming();
    clearToolCalls();
    sendMessage(trimmedDraft, attachments);
  }, [attachments, draft, sendMessage, resetStreaming, clearToolCalls]);

  return (
    <>
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={id => {
          navigate('/');
          void loadSession(id);
        }}
        onNewChat={() => {
          navigate('/');
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
              agentMonologue={agentMonologue}
              showWelcome={showWelcome}
              isProcessing={isProcessingMessage}
              pendingMessageKey={pendingMessageKey}
              lastReadMessageKey={lastReadMessageKey}
              toolCallBatches={toolCallBatches}
              pendingAssistantMessage={pendingAssistantMessage}
              completedTurns={turns}
              currentStreamTurn={currentTurn}
              finalContent={finalContent}
              finalReasoning={finalReasoning}
              isStreaming={isStreaming}
              draft={draft}
              setDraft={setDraft}
              submitDraft={submitDraft}
              isInputDisabled={isInputDisabled}
              canSubmitMessage={canSubmitMessage}
              inputPlaceholder={inputPlaceholder}
              attachments={attachments}
              onSelectFiles={files => {
                void handleSelectFiles(files);
              }}
              onClearAttachments={() => setAttachments([])}
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
                onBack={() => navigate('/')}
              />
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        routes={pluginRoutes}
      />
      <ErrorToast
        message={errorMessage}
        onClear={() => setErrorMessage(null)}
      />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
