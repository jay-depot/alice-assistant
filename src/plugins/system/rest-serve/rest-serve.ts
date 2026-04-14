import { AlicePlugin } from '../../../lib.js';
import express, { Express } from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { UserConfig } from '../../../lib/user-config.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'rest-serve': {
      express: Express;
      server: Server;
    };
  }
}

const restServePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'rest-serve',
    name: 'REST Serve',
    brandColor: '#123456',
    description:
      'Provides the shared Express server used by plugins to register HTTP endpoints.',
    version: 'LATEST',
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const PORT = UserConfig.getConfig().webInterface.port;
    const HOST = UserConfig.getConfig().webInterface.bindToAddress;

    const app = express();
    const server = createServer(app);
    let serverListening = false;
    const activeSockets = new Set<Socket>();

    app.use(express.json());

    server.on('connection', socket => {
      activeSockets.add(socket);
      socket.on('close', () => {
        activeSockets.delete(socket);
      });
    });

    plugin.offer<'rest-serve'>({
      express: app,
      server,
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        `onAssistantAcceptsRequests: Starting REST server startup on ${HOST}:${PORT}.`
      );

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, HOST, () => {
          serverListening = true;
          plugin.logger.log(`REST server running at http://${HOST}:${PORT}/`);
          resolve();
        });
      });

      plugin.logger.log(
        'onAssistantAcceptsRequests: Completed REST server startup request.'
      );
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Starting REST server shutdown.'
      );
      if (!serverListening) {
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Skipping REST server shutdown because server is not listening.'
        );
        return;
      }

      serverListening = false;
      const closingServer = server;

      await new Promise<void>(resolve => {
        let finished = false;
        const finish = () => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(forceCloseTimer);
          resolve();
        };

        const forceCloseTimer = setTimeout(() => {
          plugin.logger.warn(
            `onAssistantWillStopAcceptingRequests: REST server shutdown timed out with ${activeSockets.size} open socket(s). Forcing close.`
          );

          for (const socket of activeSockets) {
            socket.destroy();
          }

          if (typeof closingServer.closeAllConnections === 'function') {
            closingServer.closeAllConnections();
          }

          finish();
        }, 5000);

        // Stops accepting new connections and resolves once existing ones drain.
        closingServer.close(serverErr => {
          if (serverErr) {
            plugin.logger.error('Error shutting down REST server:', serverErr);
          }
          finish();
        });

        // Proactively prune idle keep-alive sockets when available.
        if (typeof closingServer.closeIdleConnections === 'function') {
          closingServer.closeIdleConnections();
        }
      });

      plugin.logger.log('REST server shut down.');
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Completed REST server shutdown.'
      );
    });
  },
};

export default restServePlugin;
