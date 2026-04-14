import { useCallback, useEffect } from 'react';
import type { WsServerMessage } from '../../ws-types.js';

type WsMessageHandler = (message: WsServerMessage) => void;

// ── Module-level WebSocket singleton ──────────────────────────────────────────
// One persistent connection per browser tab, shared across all hook consumers.

const subscribers = new Set<WsMessageHandler>();
let currentWs: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;

function connectWs(): void {
  if (
    currentWs &&
    (currentWs.readyState === WebSocket.CONNECTING ||
      currentWs.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  currentWs = ws;

  ws.onopen = () => {
    reconnectAttempts = 0;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = event => {
    let msg: WsServerMessage;
    try {
      msg = JSON.parse(event.data as string) as WsServerMessage;
    } catch {
      console.error('[ws] Failed to parse message:', event.data);
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    for (const handler of subscribers) {
      handler(msg);
    }
  };

  ws.onclose = () => {
    if (currentWs === ws) {
      currentWs = null;
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose fires after onerror; reconnect scheduling happens there.
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) {
    return;
  }
  // Exponential back-off: 1 s, 2 s, 4 s, … capped at 30 s
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
  reconnectAttempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket() {
  useEffect(() => {
    connectWs();
  }, []);

  const subscribe = useCallback((handler: WsMessageHandler) => {
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  }, []);

  return { subscribe };
}
