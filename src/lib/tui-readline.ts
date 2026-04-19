/**
 * Readline-based fallback frontend for the A.L.I.C.E. TUI.
 *
 * Used when blessed is unavailable or `--plain` is specified.
 * Provides the same chat functionality with minimal terminal rendering.
 */

import * as readline from 'node:readline';
import type {
  TuiFrontend,
  TuiWsEvent,
  WsSession,
  WsToolCallEvent,
  TuiToolCallBatch,
} from './tui-types.js';
import { TuiWsClient } from './tui-ws-client.js';
import { TuiApiClient } from './tui-api-client.js';
import {
  groupToolCallBatches,
  formatToolCallBatchLine,
} from './tui-tool-calls.js';

export class TuiReadlineFrontend implements TuiFrontend {
  onUserInput: ((text: string) => void) | null = null;
  private rl: readline.Interface | null = null;
  currentSessionId: number | null = null;
  private isProcessing = false;
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private toolCallBatches = new Map<string, TuiToolCallBatch>();

  constructor(
    private apiClient: TuiApiClient,
    private wsClient: TuiWsClient
  ) {}

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    this.wsClient.onEvent(event => this.handleWsEvent(event));

    // Create a new session
    try {
      const session = await this.apiClient.createSession();
      this.currentSessionId = session.id;
      console.log(`\n=== A.L.I.C.E. TUI (readline mode) ===`);
      console.log(`Session: ${session.title}`);
      console.log(`Type /help for commands, /quit to exit.\n`);

      // Show initial greeting if any
      for (const msg of session.messages) {
        if (msg.role === 'assistant' && msg.content) {
          console.log(`A.L.I.C.E.: ${msg.content}\n`);
        }
      }
    } catch (err) {
      console.error(
        `Failed to connect to A.L.I.C.E. at ${this.apiClient.constructor.name}. Is Alice running?`
      );
      console.error(err);
      return;
    }

    this.rl.setPrompt('> ');
    this.rl.prompt();

    this.rl.on('line', async (line: string) => {
      const input = line.trim();
      if (!input) {
        this.rl?.prompt();
        return;
      }

      if (input.startsWith('/')) {
        await this.handleSlashCommand(input);
        this.rl?.prompt();
        return;
      }

      // Store in history
      this.inputHistory.push(input);
      this.historyIndex = this.inputHistory.length;

      console.log(`You: ${input}`);
      this.isProcessing = true;
      this.onUserInput?.(input);
    });

    this.rl.on('close', () => {
      this.stop();
    });
  }

  async stop(): Promise<void> {
    if (this.currentSessionId !== null) {
      try {
        await this.apiClient.deleteSession(this.currentSessionId);
      } catch {
        // Best effort — we're shutting down.
      }
    }
    this.rl?.close();
    this.rl = null;
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/help':
        console.log('Commands:');
        console.log('  /clear   — Close session and start fresh');
        console.log('  /compact — Compact conversation context');
        console.log('  /help    — Show this help');
        console.log('  /quit    — Exit the TUI');
        break;

      case '/clear':
        if (this.currentSessionId !== null) {
          try {
            await this.apiClient.deleteSession(this.currentSessionId);
          } catch {
            // Best effort.
          }
          const session = await this.apiClient.createSession();
          this.currentSessionId = session.id;
          this.toolCallBatches.clear();
          console.log(`\n=== New session: ${session.title} ===\n`);
          for (const msg of session.messages) {
            if (msg.role === 'assistant' && msg.content) {
              console.log(`A.L.I.C.E.: ${msg.content}\n`);
            }
          }
        }
        break;

      case '/compact':
        if (this.currentSessionId !== null) {
          try {
            const result = await this.apiClient.compactSession(
              this.currentSessionId,
              'normal'
            );
            console.log(
              result.compacted
                ? 'Context compacted.'
                : 'No compaction needed (context is within limits).'
            );
          } catch (err) {
            console.error('Compaction failed:', err);
          }
        }
        break;

      case '/quit':
      case '/exit':
        await this.stop();
        process.exit(0);
        break;

      default:
        console.log(
          `Unknown command: ${cmd}. Type /help for available commands.`
        );
    }
  }

  private handleWsEvent(event: TuiWsEvent): void {
    switch (event.type) {
      case 'session_updated':
        this.handleSessionUpdated(event.session);
        break;
      case 'tool_call_event':
        this.handleToolCallEvent(event.event);
        break;
      case 'disconnected':
        console.log('\n[Disconnected from A.L.I.C.E. — reconnecting...]\n');
        break;
      case 'connected':
        if (this.reconnectShown) {
          console.log('\n[Reconnected to A.L.I.C.E.]\n');
          this.reconnectShown = false;
        }
        break;
      case 'reconnecting':
        this.reconnectShown = true;
        break;
    }
  }

  private reconnectShown = false;

  private handleSessionUpdated(session: WsSession): void {
    if (session.id !== this.currentSessionId) {
      return;
    }

    if (this.isProcessing) {
      // Find the latest assistant message
      const messages = session.messages;
      const lastAssistant = [...messages]
        .reverse()
        .find(m => m.role === 'assistant' && m.messageKind === 'chat');

      if (lastAssistant) {
        console.log(`\nA.L.I.C.E.: ${lastAssistant.content}\n`);
      }

      this.isProcessing = false;
      this.rl?.prompt();
    }
  }

  private handleToolCallEvent(event: WsToolCallEvent): void {
    if (event.sessionId !== this.currentSessionId) {
      return;
    }

    groupToolCallBatches(this.toolCallBatches, event);

    // Show the latest batch status line
    if (event.callBatchId) {
      const batch = this.toolCallBatches.get(event.callBatchId);
      if (batch) {
        const line = formatToolCallBatchLine(batch);
        // Use \r to overwrite the previous tool call line
        process.stdout.write(`\r${line}`);
        if (batch.status === 'completed' || batch.status === 'error') {
          process.stdout.write('\n');
        }
      }
    }
  }
}
