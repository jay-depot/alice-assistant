import * as express from 'express';
import * as path from 'path';
import type { Server } from 'http';
import { UserConfig } from '../../lib/user-config';


export function startServer() {
  const app = express();
  const PORT = UserConfig.getConfig().webInterface.port;
  const HOST = UserConfig.getConfig().webInterface.bindToAddress;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../client')));

  app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    // TODO: wire up to Alice assistant logic
    res.json({ reply: `Echo: ${message}` });
  });

  const server: Server = app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}/`);
  });

  return server;
}
