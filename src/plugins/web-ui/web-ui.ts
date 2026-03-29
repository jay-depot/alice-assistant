import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';
import express,  {Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { type Server } from 'http';
import { UserConfig } from '../../lib/user-config.js';
import { ChatSession, ChatSessionRound } from '../../plugins/memory/db-schemas/index.js';
import { startConversation } from '../../lib/conversation.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

declare module '../../lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'web-ui': {
      express: Express;
      // addCss: (path: string) => void; // This will be for plugins to add CSS files to be served by the web UI.
      // addJsx: {path: string) => void; // This will be for plugins to add React components to be served by the web UI. This script should load all other components you need, and call the appropriate front-end hooks to add itself to the UI.
    }
  }
}

const webUiPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'web-ui',
    name: 'Web UI Plugin',
    description: 'Provides the web interface for the assistant, and manages all interactions ' +
      'between the assistant and the web interface.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'mood', version: 'LATEST' },
    ], // probably no plugins should depend on this one, since it's so core to the assistant's functionality. Should we enforce that somehow?
    required: true,
    system: true,
  },


  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(webUiPlugin.pluginMetadata); 
    const { registerDatabaseModels, onDatabaseReady, saveMemory } = plugin.request('memory');
    const { getMood } = plugin.request('mood');

    const PORT = UserConfig.getConfig().webInterface.port;
    const HOST = UserConfig.getConfig().webInterface.bindToAddress;
    const userWebInterfaceDir = path.join(UserConfig.getConfigPath(), 'web-interface');
    const userStylePath = path.join(userWebInterfaceDir, 'user-style.css');
    
    fs.mkdirSync(userWebInterfaceDir, { recursive: true });

    const app = express();
    app.use(express.json());

    app.get('/user-style.css', (_req, res) => {
      console.log(`Serving user style from ${userStylePath}`);
      res.setHeader('Cache-Control', 'no-store');
      if (!fs.existsSync(userStylePath)) {
        res.status(204).end();
        return;
      }
  
      res.type('text/css');
      const customStyle = fs.readFileSync(userStylePath, 'utf-8');
  
      res.send(customStyle);
    });
  
    app.use(express.static(path.join(currentDir, 'client'), { fallthrough: true }));

    plugin.offer<'web-ui'>({
      express: app,
      // addCss: (cssPath: string) => {
      //   // Create an express route for this CSS file, and then add it to the list of 
      //   // CSS files the front-end should load. Those will need to make their way into
      //   // the HTML payload we send somehow, but we'll handle that later.
      // },
      // addJsx: (jsxPath: string) => {
      //   // Create an express route for this JSX file, and then add it to the list of 
      //   // JSX files the front-end should load. For this, we can be a little lazier, 
      //   // and make an endpoint that lists these, and have the front-end's bootstrap
      //   // script load them dynamically. After all, the less we have to muck with the
      //   // HTML payload, the better.`
      // },
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      // TODO: Organize this crap into files.
      console.log(`Starting web UI on ${UserConfig.getConfig().webInterface.bindToAddress}:${UserConfig.getConfig().webInterface.port}...`);
      const orm = await onDatabaseReady(async (orm) => orm);
    
      
      app.post('/api/chat', async (req, res) => {
        // Creates a new chat sessions with the assistant. Sends an initial "You've been 
        // activated through an alternative text-based interface. Greet the user" prompt 
        // and returns the answer to it.
    
        const em = orm.em.fork();
        const conversationRecord = em.create(ChatSession, { title: 'New Conversation', rounds: [], createdAt: new Date(), updatedAt: new Date() });
        const conversation = startConversation('chat');
        const response = await conversation.sendUserMessage();
        const assistantRound = em.create(ChatSessionRound, { chatSession: conversationRecord, role: 'assistant', timestamp: new Date(), content: response });
        conversationRecord.rounds.add(assistantRound);
    
        await em.flush();
    
        res.json({ session: {
          id: conversationRecord.id,
          title: conversationRecord.title,
          createdAt: conversationRecord.createdAt,
          messages: [
            { role: assistantRound.role, content: assistantRound.content, timestamp: assistantRound.timestamp }
          ]
        }});
      });
    
      app.patch('/api/chat/:id', async (req, res) => {
        // This should send the message to the assistant as part of the chat session with the given
        // id, and return the assistant's reply. The message should be added to the conversation 
        // history for that chat session in the database, and the assistant's reply should also be 
        // added to the conversation history in the database.

        const { id } = req.params;
        const { message } = req.body;

        const em = orm.em.fork();
        const session = await em.findOne(ChatSession, { id: parseInt(id) }, { populate: ['rounds'] });
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }
    
        const userRound = em.create(ChatSessionRound, { chatSession: session, role: 'user', timestamp: new Date(), content: message });
        session.rounds.add(userRound);

        const llmTransaction = startConversation('chat');
        llmTransaction.restoreContext(session.rounds.getItems().map(round => ({ role: round.role, content: round.content })));
        const response = await llmTransaction.sendUserMessage(message);
        const assistantRound = em.create(ChatSessionRound, { chatSession: session, role: 'assistant', timestamp: new Date(), content: response });
        session.rounds.add(assistantRound);

        const titleSummary = await llmTransaction.requestTitle();
        session.title = titleSummary.length > 0 ? titleSummary : 'New Conversation';
        session.updatedAt = new Date();

        await em.flush();

        res.json({ session: {
          id,
          title: session.title,
          createdAt: session.createdAt,
          messages: session.rounds.getItems()
            .filter(round => round.role !== 'system')
            .map(round => ({ role: round.role, content: round.content, timestamp: round.timestamp }))
        }});
      });

      app.get('/api/chat', async (req, res) => {
        // This should return a list of open chat sessions. Each session should include 
        // the id, the creation timestamp, the last message timestamp, an LLM-provided 
        // title for the conversation, and the last message from the user and the assistant.

        const em = orm.em.fork();

        const sessions = await em.find(ChatSession, {}, { populate: ['rounds'] });

        res.json({ sessions: sessions.map(session => ({
          id: session.id,
          title: session.title,
            createdAt: session.createdAt,
            lastMessageAt: session.rounds.getItems().length > 0 ? session.rounds.getItems()[session.rounds.getItems().length - 1].timestamp : session.createdAt,
            lastUserMessage: session.rounds.getItems().length > 0 ? session.rounds.getItems()[session.rounds.getItems().length - 1].content : '',
            lastAssistantMessage: session.rounds.getItems().length > 1 ? session.rounds.getItems()[session.rounds.getItems().length - 2].content : '' 
          }) 
        )});
      });

      app.get('/api/chat/:id', async (req, res) => {
        const { id } = req.params;
        // This should return the full message history for the chat session with the given id, 
        // including both user and assistant messages, in chronological order, as well as the 
        // conversation title, and creation timestamp.

        const em = orm.em.fork();
        const session = await em.findOne(ChatSession, { id: parseInt(id) }, { populate: ['rounds'] });
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        res.json({ session: {
          id,
          title: session.title,
          createdAt: session.createdAt,
          assistantMood: 'happy', // This will pull from the global "mood" state the assistant can set through tools. It's common across all assistant conversations.
          messages: session.rounds.getItems().filter(round => round.role !== 'system').map(round => ({ role: round.role, content: round.content, timestamp: round.timestamp }))
        }});
      });

      app.delete('/api/chat/:id', async (req, res) => {
        const { id } = req.params;
        // TODO: wire up to Alice assistant logic.

        // This should tell the LLM to summarize the chat, so we can save it to memory, and remove the
        // session from the database.

        // Step 1. Check if there are any user messages in the chat. If not, we''' just delete it.
        const em = orm.em.fork();
        const session = await em.findOne(ChatSession, { id: parseInt(id) }, { populate: ['rounds'] });
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        const userMessages = session.rounds.getItems().filter(round => round.role === 'user');
        if (userMessages.length === 0) {
          session.rounds.removeAll();
          em.remove(session);
          await em.flush();
          res.json({ reply: `Chat session with id ${id} deleted successfully` });
          return;
        }

        res.json({ reply: `This is a placeholder for deleting the chat session with id ${id}` });
      });

      app.get('/api/mood', async (req, res) => {
        // TODO: wire up to Alice assistant logic. 
    
        // This should return the assistant's current "mood", which is a global state that the 
        // assistant can set through tools. The mood can be used to influence the assistant's 
        // responses, and can be displayed in the UI to give the user a sense of the assistant's 
        // current state of mind.
        res.setHeader('Cache-Control', 'no-store');
        res.json({ mood: (await getMood()).mood }); // Don't send the reason to the client.
      });
    
      const server: Server = app.listen(PORT, HOST, () => {
        console.log(`Server running at http://${HOST}:${PORT}/`);
      });
      
      await new Promise<void>((resolve, reject) => {
        let shuttingDown = false;
        
        const cleanupSignalHandlers = () => {
          process.off('SIGINT', shutdown);
          process.off('SIGTERM', shutdown);
        };
        
        const shutdown = async (signal: NodeJS.Signals) => {
          if (shuttingDown) {
            return;
          }
          shuttingDown = true;
          console.log(`Received ${signal}, shutting down gracefully...`);
          cleanupSignalHandlers();
          
          server.close(async (serverErr?: Error) => {
            if (serverErr) {
              reject(serverErr);
              return;
            }
            
            try {
              // TODO: Move this to memory plugin
              await orm.close(true);
              resolve();
            } catch (ormErr) {
              reject(ormErr instanceof Error ? ormErr : new Error(String(ormErr)));
            }
          });
        };
        
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        
        server.on('error', (err) => {
          cleanupSignalHandlers();
          reject(err);
        });
      });
    });
  }
};

export default webUiPlugin;
