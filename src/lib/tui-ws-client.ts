/**
 * WebSocket client for the A.L.I.C.E. TUI.
 *
 * Connects to the web-ui plugin's WS endpoint, handles ping/pong heartbeat,
 * and re-emits parsed server messages as typed events for the UI layer.
 */

import WebSocket from 'ws';
import type { WsServerMessage, TuiWsEvent } from './tui-types.js';

export type TuiWsEventHandler = (event: TuiWsEvent) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const PONG_TIMEOUT_MS = 35_000;

export class TuiWsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private handlers = new Set<TuiWsEventHandler>();

  constructor(
    private host: string,
    private port: number
  ) {}

  onEvent(handler: TuiWsEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(event: TuiWsEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors — don't let one bad listener break the WS client.
      }
    }
  }

  connect(): void {
    if (this.disposed) {
      return;
    }

    const url = `ws://${this.host}:${this.port}/ws`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.resetPongTimeout();
      this.emit({ type: 'connected' });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsServerMessage;
        this.handleServerMessage(msg);
      } catch {
        // Malformed message — ignore.
      }
    });

    this.ws.on('close', () => {
      this.clearPongTimeout();
      if (!this.disposed) {
        this.emit({ type: 'disconnected' });
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', () => {
      // The 'close' event will fire after this, which handles reconnection.
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.clearPongTimeout();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private handleServerMessage(msg: WsServerMessage): void {
    switch (msg.type) {
      case 'ping':
        this.sendPong();
        this.resetPongTimeout();
        break;
      case 'session_updated':
        this.emit({
          type: 'session_updated',
          session: msg.session,
        });
        break;
      case 'tool_call_event':
        this.emit({
          type: 'tool_call_event',
          event: msg.event,
        });
        break;
      case 'sessions_list_updated':
        this.emit({
          type: 'sessions_list_updated',
          sessions: msg.sessions,
        });
        break;
    }
  }

  private sendPong(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  private resetPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimer = setTimeout(() => {
      // Server hasn't sent a ping in a while — connection may be stale.
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.terminate();
      }
    }, PONG_TIMEOUT_MS);
  }

  private clearPongTimeout(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }

    this.reconnectAttempt++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1),
      RECONNECT_MAX_DELAY_MS
    );

    this.emit({ type: 'reconnecting', attempt: this.reconnectAttempt });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
