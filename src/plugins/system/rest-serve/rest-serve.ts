import { AlicePlugin } from '../../../lib.js';
import express, { Express } from 'express';
import type { Server } from 'node:http';
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

    app.use(express.json());

    plugin.offer<'rest-serve'>({
      express: app,
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      console.log(`Starting REST server on ${HOST}:${PORT}...`);

      server = app.listen(PORT, HOST, err => {
        if (err) {
          console.error('Error starting REST server:', err);
          process.exit(1);
        }

        console.log(`REST server running at http://${HOST}:${PORT}/`);
      });
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      if (!server) {
        return;
      }

      await new Promise<void>(resolve => {
        server!.close(serverErr => {
          if (serverErr) {
            console.error('Error shutting down REST server:', serverErr);
          }
          resolve();
        });
      });

      server = null;
    });
  },
};

export default restServePlugin;
