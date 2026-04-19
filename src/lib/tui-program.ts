/**
 * A.L.I.C.E. TUI — Terminal User Interface entry point.
 *
 * Thin orchestration layer that parses CLI arguments, connects to the
 * A.L.I.C.E. REST+WS backend, and launches either the blessed or readline
 * frontend. Follows the same "thin bin wrapper → full TS library" pattern
 * as the setup program.
 */

import { TuiApiClient } from './tui-api-client.js';
import { TuiWsClient } from './tui-ws-client.js';
import { TuiReadlineFrontend } from './tui-readline.js';
import type { TuiConfig } from './tui-types.js';

function parseArgs(argv: string[]): TuiConfig & { help: boolean } {
  const config: TuiConfig & { help: boolean } = {
    host: '127.0.0.1',
    port: 47153,
    plain: false,
    help: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case '--plain':
        config.plain = true;
        break;
      case '--help':
      case '-h':
        config.help = true;
        break;
      default:
        if (arg.startsWith('--host=')) {
          config.host = arg.slice('--host='.length);
        } else if (arg.startsWith('--port=')) {
          const port = parseInt(arg.slice('--port='.length), 10);
          if (!isNaN(port) && port > 0 && port < 65536) {
            config.port = port;
          } else {
            console.error(`Invalid port: ${arg}`);
            process.exit(1);
          }
        } else {
          console.error(`Unknown argument: ${arg}`);
          console.error('Use --help for usage information.');
          process.exit(1);
        }
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`A.L.I.C.E. TUI — Terminal User Interface

Usage: alice-tui [options]

Options:
  --plain         Use readline fallback instead of blessed TUI
  --host=<addr>   Connect to A.L.I.C.E. at this address (default: 127.0.0.1)
  --port=<num>    Connect to A.L.I.C.E. on this port (default: 47153)
  --help, -h      Show this help message

The TUI connects to a running A.L.I.C.E. instance via its REST and WebSocket
endpoints. Make sure Alice is running (e.g. "npm start") before launching the TUI.

Slash commands (in chat):
  /clear    Close current session and start a fresh one
  /compact  Compact conversation context to save space
  /help     Show available commands
  /quit     Exit the TUI
`);
}

export async function runTuiProgram(argv: string[]): Promise<void> {
  const config = parseArgs(argv);

  if (config.help) {
    printHelp();
    return;
  }

  const apiClient = new TuiApiClient(config.host, config.port);
  const wsClient = new TuiWsClient(config.host, config.port);

  // Check if Alice is reachable before starting the UI
  try {
    await apiClient.listSessions();
  } catch {
    console.error(
      `Cannot connect to A.L.I.C.E. at http://${config.host}:${config.port}.`
    );
    console.error('Is Alice running? Start it with "npm start".');
    process.exit(1);
  }

  // Connect the WebSocket
  wsClient.connect();

  let frontend;

  if (config.plain || !process.stdout.isTTY) {
    frontend = new TuiReadlineFrontend(apiClient, wsClient);
  } else {
    try {
      const { TuiBlessedFrontend } = await import('./tui-blessed.js');
      frontend = new TuiBlessedFrontend(apiClient, wsClient);
    } catch {
      console.warn(
        'Failed to initialize blessed TUI. Falling back to readline mode.'
      );
      frontend = new TuiReadlineFrontend(apiClient, wsClient);
    }
  }

  // Wire user input from frontend to API
  frontend.onUserInput = async (text: string) => {
    // Slash commands are handled inside the frontend
    if (text.startsWith('/')) {
      return;
    }

    // Send the message to the backend via the API client
    const sessionId = frontend.currentSessionId;
    if (sessionId === null) {
      console.error('No active session. Type /clear to start one.');
      return;
    }

    try {
      await apiClient.sendMessage(sessionId, text);
    } catch (err) {
      console.error(
        `Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  // Handle graceful shutdown
  const cleanup = async () => {
    await frontend.stop();
    wsClient.dispose();
    process.exit(0);
  };

  process.on('SIGINT', async () => {
    await cleanup();
  });

  process.on('SIGTERM', async () => {
    await cleanup();
  });

  await frontend.start();
}
