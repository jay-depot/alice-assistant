---
name: websocket-serve
description: Use when adding WebSocket endpoints to a plugin. Trigger phrases: "add a WebSocket", "new WS endpoint", "WebSocket server", "real-time", "ws://", "socket connection", "registerWebSocket".
---

# WebSocket Servers in Alice

Use `registerWebSocket(path)` from the plugin API — never construct `WebSocketServer` manually.

## Registration

```typescript
plugin.hooks.onAssistantAcceptsRequests(async () => {
  const wss = plugin.registerWebSocket('/my-ws');

  wss.on('connection', (ws: WebSocket) => {
    plugin.logger.info('Client connected.');
    // handle connection
  });
});
```

The `rest-serve` plugin must be listed in `dependencies` as `{ id: 'rest-serve', version: 'LATEST' }` for `registerWebSocket` to work.

## Connection Tracking

Track all active connections in a `Set<WebSocket>`:

```typescript
const wsConnections = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  wsConnections.add(ws);

  ws.on('close', () => wsConnections.delete(ws));
  ws.on('error', () => wsConnections.delete(ws));
});
```

## Message Handling

Use a discriminated union for message types and a switch dispatcher:

```typescript
type WsClientMessage =
  | { type: 'send_message'; payload: string }
  | { type: 'ping' }
  | { type: 'close' };

ws.on('message', (data: Buffer) => {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(data.toString()) as WsClientMessage;
  } catch {
    return; // malformed — ignore silently
  }

  switch (msg.type) {
    case 'send_message':
      void handleSendMessage(ws, msg.payload);
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      plugin.logger.warn(
        `Unknown WS message type: ${(msg as WsClientMessage).type}`
      );
  }
});
```

## Server-to-Client Messages

```typescript
type WsServerMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'assistant_message'; text: string }
  | { type: 'ping' };

function broadcast(msg: WsServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of wsConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// Send to a specific client
ws.send(JSON.stringify({ type: 'assistant_message', text: 'Hello!' }));
```

## Heartbeat

Standard pattern — 30 second interval with pong responses:

```typescript
const heartbeatInterval = setInterval(() => {
  for (const ws of wsConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
}, 30_000);
```

Handle pong responses:

```typescript
case 'pong':
  // client is alive — no action needed
  break;
```

## Lifecycle Shutdown

Clean up in `onAssistantWillStopAcceptingRequests`:

```typescript
plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  for (const ws of wsConnections) {
    ws.close();
  }
  wsConnections.clear();
  if (wss) {
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});
```

## Full Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';

type ClientMessage = { type: 'send_message'; text: string } | { type: 'pong' };

type ServerMessage =
  | { type: 'connected' }
  | { type: 'assistant_message'; text: string }
  | { type: 'ping' };

export const myFeaturePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-feature',
    name: 'My Feature',
    brandColor: '#4f46e5',
    description: 'WebSocket plugin.',
    version: '0.0.1',
    dependencies: [{ id: 'rest-serve', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    let wss: WebSocketServer | null = null;
    const wsConnections = new Set<WebSocket>();
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      wss = plugin.registerWebSocket('/my-feature');

      wss.on('connection', (ws: WebSocket) => {
        wsConnections.add(ws);
        ws.send(JSON.stringify({ type: 'connected' } as ServerMessage));

        ws.on('close', () => wsConnections.delete(ws));
        ws.on('error', () => wsConnections.delete(ws));

        ws.on('message', (data: Buffer) => {
          let msg: ClientMessage;
          try {
            msg = JSON.parse(data.toString()) as ClientMessage;
          } catch {
            return;
          }

          switch (msg.type) {
            case 'send_message':
              ws.send(
                JSON.stringify({
                  type: 'assistant_message',
                  text: `Echo: ${msg.text}`,
                } as ServerMessage)
              );
              break;
            case 'pong':
              break;
          }
        });
      });

      heartbeatInterval = setInterval(() => {
        for (const ws of wsConnections) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' } as ServerMessage));
          }
        }
      }, 30_000);
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      for (const ws of wsConnections) {
        ws.close();
      }
      wsConnections.clear();
      if (wss) {
        await new Promise<void>(resolve => wss.close(() => resolve()));
      }
    });
  },
};
```

After adding WebSocket endpoints, run `npm run build` and restart to test.
