/**
 * Blessed-based TUI frontend for A.L.I.C.E.
 *
 * Full-screen terminal interface with:
 * - Scrollable message log with markdown rendering
 * - Input bar at the bottom (single-line with multiline toggle)
 * - Status bar at the top (session info, connection, processing)
 * - Overlay panels for agents and help
 * - Input history (up/down arrows)
 * - Slash commands (/clear, /compact, /help, /quit)
 */

import blessed from 'blessed';
import type {
  TuiFrontend,
  TuiWsEvent,
  WsSession,
  WsToolCallEvent,
  WsActiveAgent,
  TuiToolCallBatch,
} from './tui-types.js';
import { TuiApiClient } from './tui-api-client.js';
import { TuiWsClient } from './tui-ws-client.js';
import {
  groupToolCallBatches,
  formatToolCallBatchLine,
} from './tui-tool-calls.js';
import { renderMarkdown } from './tui-markdown.js';

const STATUS_BAR_HEIGHT = 1;
const INPUT_BAR_HEIGHT = 3;

export class TuiBlessedFrontend implements TuiFrontend {
  onUserInput: ((text: string) => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private screen!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageLog!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inputBox!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private statusBar!: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agentsOverlay: any | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private helpOverlay: any | null = null;

  private currentSessionId: number | null = null;
  private isProcessing = false;
  private isMultiline = false;
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private toolCallBatches = new Map<string, TuiToolCallBatch>();
  private activeAgents: WsActiveAgent[] = [];
  private connected = false;
  private lastToolCallLine = '';

  constructor(
    private apiClient: TuiApiClient,
    private wsClient: TuiWsClient
  ) {}

  async start(): Promise<void> {
    this.createScreen();
    this.createStatusBar();
    this.createMessageLog();
    this.createInputBox();

    this.wsClient.onEvent(event => this.handleWsEvent(event));

    // Create a new session
    try {
      const session = await this.apiClient.createSession();
      this.currentSessionId = session.id;
      this.updateStatusBar();

      // Show initial greeting
      for (const msg of session.messages) {
        if (msg.role === 'assistant' && msg.content) {
          this.appendAssistantMessage(msg.content);
        }
      }
    } catch (err) {
      this.messageLog.log(
        `{red-fg}Failed to connect to A.L.I.C.E. Is Alice running?{/red-fg}`
      );
      this.messageLog.log(`{red-fg}${String(err)}{/red-fg}`);
      return;
    }

    this.screen.render();
    this.inputBox.focus();
  }

  async stop(): Promise<void> {
    if (this.currentSessionId !== null) {
      try {
        await this.apiClient.deleteSession(this.currentSessionId);
      } catch {
        // Best effort.
      }
    }
    if (this.screen) {
      this.screen.destroy();
    }
  }

  // ── UI Construction ──────────────────────────────────────────────────

  private createScreen(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'A.L.I.C.E.',
      fullUnicode: true,
    });

    this.screen.key(['C-c'], () => {
      this.stop().then(() => process.exit(0));
    });

    this.screen.key(['escape'], () => {
      if (this.agentsOverlay) {
        this.closeAgentsOverlay();
      } else if (this.helpOverlay) {
        this.closeHelpOverlay();
      }
    });

    // Toggle agents overlay
    this.screen.key(['C-a'], () => {
      if (this.agentsOverlay) {
        this.closeAgentsOverlay();
      } else {
        this.showAgentsOverlay();
      }
    });

    // Toggle help overlay
    this.screen.key(['f1'], () => {
      if (this.helpOverlay) {
        this.closeHelpOverlay();
      } else {
        this.showHelpOverlay();
      }
    });
  }

  private createStatusBar(): void {
    this.statusBar = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: STATUS_BAR_HEIGHT,
      tags: true,
      style: {
        bg: '#0c120c',
        fg: '#33ea33',
      },
    });
  }

  private createMessageLog(): void {
    this.messageLog = blessed.log({
      parent: this.screen,
      top: STATUS_BAR_HEIGHT,
      left: 0,
      width: '100%',
      height: `100%-${STATUS_BAR_HEIGHT + INPUT_BAR_HEIGHT}`,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: 'line',
      style: {
        border: { fg: '#233a23' },
        bg: '#040804',
        fg: '#33ea33',
      },
    });

    // Allow scrolling the message log
    this.messageLog.key(['up'], () => {
      this.messageLog.scroll(-1);
      this.screen.render();
    });

    this.messageLog.key(['down'], () => {
      this.messageLog.scroll(1);
      this.screen.render();
    });
  }

  private createInputBox(): void {
    this.inputBox = blessed.textbox({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: INPUT_BAR_HEIGHT,
      keys: true,
      mouse: true,
      inputOnFocus: true,
      border: 'line',
      style: {
        border: { fg: '#2e4a2e' },
        bg: '#111911',
        fg: '#33ea33',
      },
    });

    this.inputBox.key('enter', () => {
      const value = this.inputBox.getValue();
      if (!value.trim()) {
        return;
      }

      this.inputBox.clearValue();
      this.screen.render();

      this.handleInput(value.trim());
    });

    // Input history navigation
    this.inputBox.key('up', () => {
      if (this.inputHistory.length === 0) {
        return;
      }
      if (this.historyIndex > 0) {
        this.historyIndex--;
      } else if (this.historyIndex === -1) {
        this.historyIndex = this.inputHistory.length - 1;
      }
      this.inputBox.setValue(this.inputHistory[this.historyIndex] ?? '');
      this.screen.render();
    });

    this.inputBox.key('down', () => {
      if (this.historyIndex === -1) {
        return;
      }
      if (this.historyIndex < this.inputHistory.length - 1) {
        this.historyIndex++;
        this.inputBox.setValue(this.inputHistory[this.historyIndex] ?? '');
      } else {
        this.historyIndex = -1;
        this.inputBox.setValue('');
      }
      this.screen.render();
    });

    // Toggle multiline mode
    this.inputBox.key(['C-m'], () => {
      this.isMultiline = !this.isMultiline;
      this.updateStatusBar();
      this.screen.render();
    });

    // Register overlay toggles on the input box too — screen-level keybindings
    // don't fire when a child widget has focus in input mode.
    this.inputBox.key(['C-a'], () => {
      if (this.agentsOverlay) {
        this.closeAgentsOverlay();
      } else {
        this.showAgentsOverlay();
      }
    });

    this.inputBox.key(['f1'], () => {
      if (this.helpOverlay) {
        this.closeHelpOverlay();
      } else {
        this.showHelpOverlay();
      }
    });

    this.inputBox.key(['escape'], () => {
      if (this.agentsOverlay) {
        this.closeAgentsOverlay();
      } else if (this.helpOverlay) {
        this.closeHelpOverlay();
      }
    });
  }

  // ── Input Handling ───────────────────────────────────────────────────

  private async handleInput(input: string): Promise<void> {
    if (input.startsWith('/')) {
      await this.handleSlashCommand(input);
      this.inputBox.focus();
      return;
    }

    // Store in history
    this.inputHistory.push(input);
    this.historyIndex = -1;

    // Show user message
    this.messageLog.log(`{bold}{#33f845-fg}You:{/#33f845-fg}{/bold} ${input}`);

    // Send to API
    if (this.currentSessionId === null) {
      return;
    }

    this.isProcessing = true;
    this.updateStatusBar();
    this.screen.render();

    try {
      const session = await this.apiClient.sendMessage(
        this.currentSessionId,
        input
      );

      // Find the latest assistant message
      const messages = session.messages;
      const lastAssistant = [...messages]
        .reverse()
        .find(m => m.role === 'assistant' && m.messageKind === 'chat');

      if (lastAssistant) {
        this.appendAssistantMessage(lastAssistant.content);
      }

      // Show any new notifications
      const notifications = messages.filter(
        m => m.messageKind === 'notification'
      );
      for (const notif of notifications) {
        this.appendNotification(notif.content);
      }
    } catch (err) {
      this.messageLog.log(`{red-fg}Error: ${String(err)}{/red-fg}`);
    } finally {
      this.isProcessing = false;
      this.clearToolCallBatches();
      this.updateStatusBar();
      this.screen.render();
      this.inputBox.focus();
    }
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/help':
        this.showHelpOverlay();
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
          this.messageLog.setContent('');
          this.messageLog.log(
            `{bold}{#33ea33-fg}=== New Session ==={/#33ea33-fg}{/bold}`
          );
          for (const msg of session.messages) {
            if (msg.role === 'assistant' && msg.content) {
              this.appendAssistantMessage(msg.content);
            }
          }
          this.updateStatusBar();
          this.screen.render();
        }
        break;

      case '/compact':
        if (this.currentSessionId !== null) {
          try {
            const result = await this.apiClient.compactSession(
              this.currentSessionId,
              'normal'
            );
            this.messageLog.log(
              result.compacted
                ? `{#33ea33-fg}Context compacted.{/#33ea33-fg}`
                : `{#339733-fg}No compaction needed (context within limits).{/#339733-fg}`
            );
          } catch (err) {
            this.messageLog.log(
              `{#cc4444-fg}Compaction failed: ${String(err)}{/#cc4444-fg}`
            );
          }
          this.screen.render();
        }
        break;

      case '/quit':
      case '/exit':
        await this.stop();
        process.exit(0);
        break;

      default:
        this.messageLog.log(
          `{yellow-fg}Unknown command: ${cmd}. Type /help for available commands.{/yellow-fg}`
        );
        this.screen.render();
    }
  }

  // ── Message Rendering ───────────────────────────────────────────────

  private appendAssistantMessage(content: string): void {
    const rendered = renderMarkdown(content);
    // blessed.log supports ANSI output when content doesn't use blessed tags
    this.messageLog.log(`{bold}{#33ea33-fg}A.L.I.C.E.:{/#33ea33-fg}{/bold}`);
    // Add each line of the rendered markdown separately so blessed.log
    // handles scrolling correctly.
    for (const line of rendered.split('\n')) {
      this.messageLog.log(line);
    }
    this.messageLog.log(''); // Blank line for spacing
  }

  private appendNotification(content: string): void {
    this.messageLog.log(`{yellow-fg}🔔 ${content}{/yellow-fg}`);
  }

  private appendToolCallLine(line: string): void {
    if (this.lastToolCallLine) {
      // Overwrite the previous tool call line by logging a new one
      // (blessed.log doesn't support in-place updates, so we just append)
    }
    this.lastToolCallLine = line;

    // Color based on status
    if (line.startsWith('⚙')) {
      this.messageLog.log(`{#118811-fg}${line}{/#118811-fg}`);
    } else if (line.startsWith('✓')) {
      this.messageLog.log(`{#33ea33-fg}${line}{/#33ea33-fg}`);
    } else if (line.startsWith('✗')) {
      this.messageLog.log(`{#cc4444-fg}${line}{/#cc4444-fg}`);
    } else {
      this.messageLog.log(line);
    }
  }

  // ── WS Event Handling ───────────────────────────────────────────────

  private handleWsEvent(event: TuiWsEvent): void {
    switch (event.type) {
      case 'session_updated':
        this.handleSessionUpdated(event.session);
        break;
      case 'tool_call_event':
        this.handleToolCallEvent(event.event);
        break;
      case 'connected':
        this.connected = true;
        this.updateStatusBar();
        this.screen.render();
        break;
      case 'disconnected':
        this.connected = false;
        this.updateStatusBar();
        this.screen.render();
        break;
      case 'reconnecting':
        this.connected = false;
        this.updateStatusBar();
        this.screen.render();
        break;
    }
  }

  private handleSessionUpdated(session: WsSession): void {
    if (session.id !== this.currentSessionId) {
      return;
    }

    // Update active agents
    this.activeAgents = session.activeAgents ?? [];

    // If we were processing and the session has been updated, check for
    // new assistant messages that we haven't displayed yet.
    // (The PATCH response already handles this, so WS updates are
    // primarily for real-time tool call events and agent status.)
  }

  private handleToolCallEvent(event: WsToolCallEvent): void {
    if (event.sessionId !== this.currentSessionId) {
      return;
    }

    groupToolCallBatches(this.toolCallBatches, event);

    if (event.callBatchId) {
      const batch = this.toolCallBatches.get(event.callBatchId);
      if (batch) {
        this.appendToolCallLine(formatToolCallBatchLine(batch));
        this.screen.render();
      }
    }
  }

  // ── Overlays ────────────────────────────────────────────────────────

  private showAgentsOverlay(): void {
    if (this.agentsOverlay) {
      return;
    }

    const lines: string[] = [];
    lines.push('{bold}Active Agents{/bold}');
    lines.push('─'.repeat(40));

    if (this.activeAgents.length === 0) {
      lines.push('{#338733-fg}No active agents{/#338733-fg}');
    } else {
      for (const agent of this.activeAgents) {
        const statusColor =
          agent.status === 'running'
            ? '#33ea33'
            : agent.status === 'completed'
              ? '#339733'
              : '#cc4444';
        lines.push(
          `{bold}${agent.agentName}{/bold} ` +
            `{#${statusColor}-fg}[${agent.status}]{/#${statusColor}-fg} ` +
            `pending: ${agent.pendingMessageCount}`
        );
      }
    }

    lines.push('');
    lines.push('{#338733-fg}Press Esc or Ctrl+A to close{/#338733-fg}');

    this.agentsOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '50%',
      border: 'line',
      tags: true,
      content: lines.join('\n'),
      style: {
        border: { fg: '#233a23' },
        bg: '#0c120c',
      },
      keys: true,
      interactive: true,
    });

    this.agentsOverlay.key(['escape', 'C-a'], () => {
      this.closeAgentsOverlay();
    });

    this.agentsOverlay.focus();
    this.screen.render();
  }

  private closeAgentsOverlay(): void {
    if (this.agentsOverlay) {
      this.agentsOverlay.destroy();
      this.agentsOverlay = null;
      this.screen.render();
      this.inputBox.focus();
    }
  }

  private showHelpOverlay(): void {
    if (this.helpOverlay) {
      return;
    }

    const lines: string[] = [];
    lines.push('{bold}A.L.I.C.E. TUI — Help{/bold}');
    lines.push('─'.repeat(40));
    lines.push('');
    lines.push('{bold}Slash Commands:{/bold}');
    lines.push('  /clear    Close session, start fresh');
    lines.push('  /compact  Compact conversation context');
    lines.push('  /help     Show this help');
    lines.push('  /quit     Exit the TUI');
    lines.push('');
    lines.push('{bold}Keybindings:{/bold}');
    lines.push('  Ctrl+C    Force quit');
    lines.push('  Ctrl+A    Toggle agents panel');
    lines.push('  Ctrl+M    Toggle multiline input');
    lines.push('  F1        Toggle this help');
    lines.push('  Esc       Close overlay / cancel');
    lines.push('  Up/Down   Input history (in input box)');
    lines.push('  Enter     Send message');
    lines.push('');
    lines.push('{#338733-fg}Press Esc or F1 to close{/#338733-fg}');

    this.helpOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '60%',
      border: 'line',
      tags: true,
      content: lines.join('\n'),
      style: {
        border: { fg: '#233a23' },
        bg: '#0c120c',
      },
      keys: true,
      interactive: true,
    });

    this.helpOverlay.key(['escape', 'f1'], () => {
      this.closeHelpOverlay();
    });

    this.helpOverlay.focus();
    this.screen.render();
  }

  private closeHelpOverlay(): void {
    if (this.helpOverlay) {
      this.helpOverlay.destroy();
      this.helpOverlay = null;
      this.screen.render();
      this.inputBox.focus();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private updateStatusBar(): void {
    const parts: string[] = [];

    // Connection status
    parts.push(
      this.connected ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}'
    );

    // Session info
    if (this.currentSessionId !== null) {
      parts.push(`Session #${this.currentSessionId}`);
    }

    // Processing indicator
    if (this.isProcessing) {
      parts.push('{yellow-fg}thinking…{/yellow-fg}');
    }

    // Multiline indicator
    if (this.isMultiline) {
      parts.push('{cyan-fg}[ML]{/cyan-fg}');
    }

    // Agent count
    if (this.activeAgents.length > 0) {
      parts.push(`Agents: ${this.activeAgents.length}`);
    }

    this.statusBar.setContent(` ${parts.join(' │ ')}`);
  }

  private clearToolCallBatches(): void {
    this.toolCallBatches.clear();
    this.lastToolCallLine = '';
  }
}
