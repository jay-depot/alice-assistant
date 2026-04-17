import Type from 'typebox';
import { AlicePlugin, startConversation } from '../../../lib.js';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

// ── Shared types ──────────────────────────────────────────────────────────

export type ObsidianNoteContent = {
  filePath: string;
  content: string;
  cursorPosition?: {
    line: number;
    column: number;
  };
  selection?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
};

export type ObsidianEditSuggestion = {
  filePath: string;
  originalText: string;
  replacementText: string;
  /** Optional line range for more precise edits. */
  startLine?: number;
  endLine?: number;
};

// ── WebSocket message types ──────────────────────────────────────────────

type WsObsidianClientMessage =
  | { type: 'note_update'; note: ObsidianNoteContent }
  | { type: 'chat_message'; content: string }
  | { type: 'pong' };

type WsObsidianServerMessage =
  | { type: 'assistant_message'; content: string }
  | { type: 'edit_suggestion'; edit: ObsidianEditSuggestion; reason?: string }
  | { type: 'ping' }
  | { type: 'connected' }
  | { type: 'error'; message: string };

// ── Plugin capabilities ──────────────────────────────────────────────────

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'obsidian-broker': {
      /**
       * Returns the most recently pushed note context from the connected
       * Obsidian client, or null if no client is connected or no note is open.
       */
      getActiveNoteContext: () => ObsidianNoteContent | null;

      /**
       * Returns true when at least one Obsidian client is connected over
       * WebSocket.
       */
      isObsidianConnected: () => boolean;

      /**
       * Pushes an edit suggestion to all connected Obsidian clients.
       * Returns true if at least one client received it.
       */
      sendEditSuggestion: (
        edit: ObsidianEditSuggestion,
        reason?: string
      ) => boolean;
    };
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────

const obsidianBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'obsidian-broker',
    name: 'Obsidian Broker',
    brandColor: '#7c3aed',
    description:
      'Provides a bridge between ALICE and Obsidian. An Obsidian plugin ' +
      'connects via WebSocket to share the active note context, send chat ' +
      'messages, and receive edit suggestions. The broker injects note ' +
      'context into the LLM prompt and exposes tools for reading and editing ' +
      'the active note.',
    version: 'LATEST',
    dependencies: [{ id: 'rest-serve', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    // ── State ───────────────────────────────────────────────────────────

    let activeNote: ObsidianNoteContent | null = null;
    const wsConnections = new Set<WebSocket>();
    let wss: WebSocketServer | null = null;

    // ── Conversation type ──────────────────────────────────────────────

    plugin.registerConversationType({
      id: 'obsidian',
      name: 'Obsidian Chat',
      description:
        'A chat session originating from the Obsidian editor plugin, ' +
        'with the active note context available.',
      baseType: 'chat',
      includePersonality: true,
      scenarioPrompt: [
        ' - You are chatting with the user through the Obsidian editor.',
        ' - The user may have an active note open; its content is provided in the system prompt.',
        ' - You can suggest edits to the active note using the suggest_obsidian_edit tool.',
        ' - When suggesting edits, be precise and explain your reasoning.',
        ' - Avoid narration or emotes. Stick to what you want to SAY.',
      ].join('\n'),
    });

    // ── Offered API ─────────────────────────────────────────────────────

    plugin.offer<'obsidian-broker'>({
      getActiveNoteContext: () => activeNote,
      isObsidianConnected: () => wsConnections.size > 0,
      sendEditSuggestion: (edit, reason) => {
        const msg: WsObsidianServerMessage = {
          type: 'edit_suggestion',
          edit,
          reason,
        };
        let delivered = false;
        for (const ws of wsConnections) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
            delivered = true;
          }
        }
        return delivered;
      },
    });

    // ── REST endpoints ──────────────────────────────────────────────────

    const restServe = await plugin.request('rest-serve');
    const app = restServe.express;
    const server: Server = restServe.server;

    // Health / status check
    app.get('/obsidian/status', (_req, res) => {
      res.json({
        connected: wsConnections.size > 0,
        activeNote: activeNote ? { filePath: activeNote.filePath } : null,
      });
    });

    // Get current note context (for polling clients or debugging)
    app.get('/obsidian/context', (_req, res) => {
      if (!activeNote) {
        return res
          .status(404)
          .json({ error: 'No active note context available' });
      }
      res.json(activeNote);
    });

    // Push note context from Obsidian (for REST-only clients)
    app.post('/obsidian/context', (req, res) => {
      const note = req.body as ObsidianNoteContent;
      if (!note.filePath || typeof note.content !== 'string') {
        return res.status(400).json({
          error: 'Missing required fields: filePath, content',
        });
      }
      activeNote = note;
      plugin.logger.log(
        `[Obsidian Broker] Note context updated: ${note.filePath}`
      );
      res.json({ status: 'ok' });
    });

    // ── WebSocket server ────────────────────────────────────────────────

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        '[Obsidian Broker] onAssistantAcceptsRequests: Starting WebSocket server on /obsidian-ws.'
      );

      wss = new WebSocketServer({ server, path: '/obsidian-ws' });

      wss.on('connection', ws => {
        wsConnections.add(ws);
        plugin.logger.log(
          `[Obsidian Broker] Obsidian client connected. (${wsConnections.size} total)`
        );

        // Acknowledge connection
        const connectedMsg: WsObsidianServerMessage = {
          type: 'connected',
        };
        ws.send(JSON.stringify(connectedMsg));

        // If we already have note context, let the client know.
        if (activeNote) {
          const contextMsg: WsObsidianServerMessage = {
            type: 'assistant_message',
            content: `Active note context already loaded: ${activeNote.filePath}`,
          };
          ws.send(JSON.stringify(contextMsg));
        }

        ws.on('message', (data: Buffer) => {
          let msg: WsObsidianClientMessage;
          try {
            msg = JSON.parse(data.toString()) as WsObsidianClientMessage;
          } catch {
            plugin.logger.warn(
              '[Obsidian Broker] Malformed WS message received.'
            );
            return;
          }

          switch (msg.type) {
            case 'note_update':
              activeNote = msg.note;
              plugin.logger.log(
                `[Obsidian Broker] Note context updated via WS: ${msg.note.filePath}`
              );
              break;

            case 'chat_message':
              plugin.logger.log(
                `[Obsidian Broker] Chat message received from Obsidian: "${msg.content.slice(0, 80)}..."`
              );
              handleObsidianChatMessage(msg.content, ws).catch(err => {
                plugin.logger.error(
                  '[Obsidian Broker] Error handling chat message:',
                  err
                );
                const errMsg: WsObsidianServerMessage = {
                  type: 'error',
                  message: 'Failed to process chat message.',
                };
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(errMsg));
                }
              });
              break;

            case 'pong':
              // heartbeat response — nothing to do
              break;

            default:
              plugin.logger.warn(
                `[Obsidian Broker] Unknown WS message type: ${(msg as { type: string }).type}`
              );
          }
        });

        ws.on('close', () => {
          wsConnections.delete(ws);
          plugin.logger.log(
            `[Obsidian Broker] Obsidian client disconnected. (${wsConnections.size} remaining)`
          );
        });

        ws.on('error', () => {
          wsConnections.delete(ws);
        });
      });

      // Heartbeat: ping all connections every 30s and prune dead ones.
      const heartbeat = setInterval(() => {
        for (const ws of [...wsConnections]) {
          if (ws.readyState !== WebSocket.OPEN) {
            wsConnections.delete(ws);
            continue;
          }
          const ping: WsObsidianServerMessage = { type: 'ping' };
          ws.send(JSON.stringify(ping));
        }
      }, 30_000);

      // Store cleanup reference
      wss.on('close', () => {
        clearInterval(heartbeat);
      });

      plugin.logger.log(
        '[Obsidian Broker] onAssistantAcceptsRequests: WebSocket server started on /obsidian-ws.'
      );
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      plugin.logger.log(
        '[Obsidian Broker] onAssistantWillStopAcceptingRequests: Shutting down WebSocket server.'
      );
      if (wss) {
        // Close all connections
        for (const ws of wsConnections) {
          ws.close();
        }
        wsConnections.clear();
        wss.close();
        wss = null;
      }
      plugin.logger.log(
        '[Obsidian Broker] onAssistantWillStopAcceptingRequests: WebSocket server shut down.'
      );
    });

    // ── Chat handler ────────────────────────────────────────────────────

    async function handleObsidianChatMessage(
      content: string,
      originatingWs: WebSocket
    ): Promise<void> {
      const conversation = startConversation('obsidian');

      const response = await conversation.sendUserMessage(content);

      const responseMsg: WsObsidianServerMessage = {
        type: 'assistant_message',
        content: response,
      };
      if (originatingWs.readyState === WebSocket.OPEN) {
        originatingWs.send(JSON.stringify(responseMsg));
      }
    }

    // ── Header system prompt ────────────────────────────────────────────

    plugin.registerHeaderSystemPrompt({
      name: 'obsidianActiveNote',
      weight: 95000,
      getPrompt: async context => {
        if (!activeNote || context.conversationType !== 'obsidian') {
          return false;
        }

        const chunks: string[] = [];
        chunks.push(`# OBSIDIAN ACTIVE NOTE CONTEXT\n`);
        chunks.push(`**File:** \`${activeNote.filePath}\`\n`);
        if (activeNote.cursorPosition) {
          chunks.push(
            `**Cursor:** line ${activeNote.cursorPosition.line}, column ${activeNote.cursorPosition.column}\n`
          );
        }
        if (activeNote.selection) {
          chunks.push(
            `**Selection:** line ${activeNote.selection.start.line}:${activeNote.selection.start.column} – line ${activeNote.selection.end.line}:${activeNote.selection.end.column}\n`
          );
        }
        chunks.push(`\n---\n`);
        chunks.push(`${activeNote.content}\n`);
        chunks.push(`---\n`);

        return chunks.join('');
      },
    });

    // ── Tools ───────────────────────────────────────────────────────────

    const SuggestEditParametersSchema = Type.Object({
      originalText: Type.String({
        description: 'The exact text to replace in the note.',
      }),
      replacementText: Type.String({
        description: 'The replacement text.',
      }),
      reason: Type.Optional(
        Type.String({
          description: 'Why this edit is suggested (shown to user).',
        })
      ),
    });
    type SuggestEditParameters = Type.Static<
      typeof SuggestEditParametersSchema
    >;

    const GetNoteContentParametersSchema = Type.Object({});

    plugin.registerTool({
      name: 'suggest_obsidian_edit',
      availableFor: ['obsidian'],
      description:
        'Suggest an edit to the active Obsidian note. The edit is sent to the ' +
        'connected Obsidian client for the user to accept or reject. Use this ' +
        'when the user asks you to modify the current note.',
      parameters: SuggestEditParametersSchema,
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args: SuggestEditParameters) => {
        const { originalText, replacementText, reason } = args;
        if (wsConnections.size === 0) {
          return JSON.stringify({
            success: false,
            error: 'No Obsidian client connected.',
          });
        }
        if (!activeNote) {
          return JSON.stringify({
            success: false,
            error: 'No active note in Obsidian.',
          });
        }
        const edit: ObsidianEditSuggestion = {
          filePath: activeNote.filePath,
          originalText,
          replacementText,
        };
        const delivered = plugin
          .request('obsidian-broker')
          .sendEditSuggestion(edit, reason);
        return JSON.stringify({
          success: delivered,
          message: delivered
            ? `Edit suggestion sent to Obsidian${reason ? `: ${reason}` : '.'} The user can accept or reject it in the editor.`
            : 'Failed to deliver edit suggestion — no active WebSocket connection.',
        });
      },
    });

    plugin.registerTool({
      name: 'get_obsidian_note_content',
      availableFor: ['obsidian'],
      description:
        'Get the content of the currently open note in Obsidian. Returns the ' +
        'full note content, file path, and cursor position.',
      parameters: GetNoteContentParametersSchema,
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async () => {
        if (!activeNote) {
          return JSON.stringify({
            content: null,
            error: 'No active note in Obsidian.',
          });
        }
        return JSON.stringify({
          content: activeNote.content,
          filePath: activeNote.filePath,
          cursorPosition: activeNote.cursorPosition,
        });
      },
    });
  },
};

export default obsidianBrokerPlugin;
