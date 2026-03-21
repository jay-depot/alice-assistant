import express from 'express';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import { UserConfig } from '../../lib/user-config.js';
import { getORM } from '../../lib/memory.js';
import { ChatSession, ChatSessionRound } from '../../lib/db-schemas/index.js';
import { LlmTransaction } from '../../lib/llm-transaction.js';
import { createMemory } from '../../tools/recall-memory.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function startServer() {
  const app = express();
  const PORT = UserConfig.getConfig().webInterface.port;
  const HOST = UserConfig.getConfig().webInterface.bindToAddress;

  app.use(express.json());
  app.use(express.static(path.join(currentDir, '../client')));

  app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    // TODO: wire up to Alice assistant logic
 
    // Creates a new chat sessions with the assistant. Sends an initial "You've been 
    // activated through an alternative text-based interface. Greet the user" prompt 
    // and returns the answer to it.

    res.json({ session: {
      id: 42,
      title: `Chat Session 42`,
      createdAt: new Date().toISOString(),
      messages: [
        { role: 'user', content: 'Hello, assistant!', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hello, user! How can I assist you today?', timestamp: new Date().toISOString() },
        { role: 'user', content: 'What\'s the weather like?', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'The weather is sunny and warm today.', timestamp: new Date().toISOString() },
        { role: 'user', content: message, timestamp: new Date().toISOString() },
      ]
    }});
  });

  app.patch('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    // TODO: wire up to Alice assistant logic

    // This should send the message to the assistant as part of the chat session with the given
    // id, and return the assistant's reply. The message should be added to the conversation 
    // history for that chat session in the database, and the assistant's reply should also be 
    // added to the conversation history in the database.

    res.json({ session: {
      id,
      title: `Chat Session ${id}`,
      createdAt: new Date().toISOString(),
      messages: [
        { role: 'user', content: 'Hello, assistant!', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hello, user! How can I assist you today?', timestamp: new Date().toISOString() },
        { role: 'user', content: 'What\'s the weather like?', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'The weather is sunny and warm today.', timestamp: new Date().toISOString() }
      ]
    }});
  });

  app.get('/api/chat', async (req, res) => {
    // TODO: wire up to Alice assistant logic
  
    // This should return a list of open chat sessions. Each session should include 
    // the id, the creation timestamp, the last message timestamp, an LLM-provided 
    // title for the conversation, and the last message from the user and the assistant.
    res.json({ sessions: [
      {
        id: 1,
        title: 'Chat Session 1',
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        lastUserMessage: 'Hello, assistant!',
        lastAssistantMessage: 'Hello, user! How can I assist you today?'
      },
      {
        id: 2,
        title: 'Chat Session 2',
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        lastUserMessage: 'What\'s the weather like?',
        lastAssistantMessage: 'The weather is sunny and warm today.'
      }
    ] });
  });

  app.get('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    // TODO: wire up to Alice assistant logic

    // This should return the full message history for the chat session with the given id, 
    // including both user and assistant messages, in chronological order, as well as the 
    // conversation title, and creation timestamp.
    res.json({ session: {
      id,
      title: `Chat Session ${id}`,
      createdAt: new Date().toISOString(),
      messages: [
        { role: 'user', content: 'Hello, assistant!', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hello, user! How can I assist you today?', timestamp: new Date().toISOString() },
        { role: 'user', content: 'What\'s the weather like?', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'The weather is sunny and warm today.', timestamp: new Date().toISOString() }
      ]
    }});
  });

  app.delete('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    // TODO: wire up to Alice assistant logic.

    // This should tell the LLM to summarize the chat, so we can save it to memory, and remove the
    // session from the database.
    res.json({ reply: `This is a placeholder for deleting the chat session with id ${id}` });
  });

  const server: Server = app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}/`);
  });

  return server;
}
