import { AlicePlugin } from '../../../lib.js';
import express, { Express } from 'express';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { UserConfig } from '../../../lib/user-config.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'rest-serve': {
      express: Express;
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
    let server: Server | null = null;
    const activeSockets = new Set<Socket>();

    app.use(express.json());

    plugin.offer<'rest-serve'>({
      express: app,
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        `onAssistantAcceptsRequests: Starting REST server startup on ${HOST}:${PORT}.`
      );

      server = app.listen(PORT, HOST, err => {
        if (err) {
          plugin.logger.error('Error starting REST server:', err);
          process.exit(1);
        }

        plugin.logger.log(`REST server running at http://${HOST}:${PORT}/`);
      });

      server.on('connection', socket => {
        activeSockets.add(socket);
        socket.on('close', () => {
          activeSockets.delete(socket);
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
      if (!server) {
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Skipping REST server shutdown because no active server was found.'
        );
        return;
      }

      const closingServer = server;
      server = null;

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
