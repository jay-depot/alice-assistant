---
name: rest-serve
description: Use when adding REST API endpoints to a plugin. Trigger phrases: "new endpoint", "REST API", "HTTP route", "GET", "POST", "PUT", "DELETE", "express", "rest-serve".
---

# REST API Endpoints in Alice

Use the `rest-serve` plugin to register Express routes. All routes are added to a shared Express app — do not create your own HTTP server.

## Requesting the Express App

```typescript
const restServe = plugin.request('rest-serve');
if (!restServe) {
  throw new Error('[my-feature] rest-serve plugin not available.');
}
const app = restServe.express;
```

The `rest-serve` plugin must be listed in `dependencies` as `{ id: 'rest-serve', version: 'LATEST' }`.

## Registering Routes

Routes are registered directly in `registerPlugin` — the Express app accepts routes before the server starts listening, so there's no need to wait for a lifecycle hook:

```typescript
async registerPlugin(pluginInterface) {
  const plugin = await pluginInterface.registerPlugin();
  const restServe = plugin.request('rest-serve');

  if (restServe) {
    restServe.express.get('/api/my-feature/health', async (_req, res) => {
      res.json({ ok: true });
    });
  }
}
```

## Response Patterns

**JSON success:**

```typescript
res.json({ ok: true, data: something });
```

**Error with status:**

```typescript
res.status(400).json({ error: 'Invalid request.' });
res.status(404).json({ error: 'Resource not found.' });
res.status(500).json({ error: 'Internal error.' });
```

**Status with no body:**

```typescript
res.status(204).send();
```

## Request Data

**Query params:**

```typescript
const mode = (req.query.mode as string) || 'normal';
```

**Path params:**

```typescript
app.delete('/api/my-feature/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid ID.' });
    return;
  }
});
```

**JSON body:**

```typescript
const body = (req.body ?? {}) as MyRequestBody;
const name = body.name?.trim();
if (!name) {
  res.status(400).json({ error: 'name is required.' });
  return;
}
```

## Middleware

### Authentication Middleware

```typescript
function requireAuth() {
  return (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ): void => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !isValid(token)) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    next();
  };
}

// Usage:
app.get('/api/my-feature/protected', requireAuth(), async (req, res) => {
  res.json({ ok: true });
});
```

### CORS Middleware

```typescript
app.use('/api/my-feature', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    res.status(204).send();
    return;
  }
  next();
});
```

## Typed Request/Response

Import Express types from the `rest-serve` context type:

```typescript
import type { Request, Response, NextFunction } from 'express';

app.post('/api/my-feature/items', async (req: Request, res: Response) => {
  const body = req.body as { name: string };
  if (!body.name) {
    res.status(400).json({ error: 'name is required.' });
    return;
  }
  res.json({ created: true });
});
```

## Full Plugin Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import type { Request, Response } from 'express';

type CreateItemBody = { name: string; description?: string };

export const myFeaturePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-feature',
    name: 'My Feature',
    brandColor: '#4f46e5',
    description: 'REST API plugin.',
    version: '0.0.1',
    dependencies: [{ id: 'rest-serve', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const restServe = plugin.request('rest-serve');

    if (!restServe) {
      throw new Error('[my-feature] rest-serve plugin not available.');
    }

    const app = restServe.express;

    app.get('/api/my-feature/health', async (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    app.post('/api/my-feature/items', async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as CreateItemBody;
      const name = body.name?.trim();
      if (!name) {
        res.status(400).json({ error: 'name is required.' });
        return;
      }
      plugin.logger.info(`Created item: ${name}`);
      res.status(201).json({ id: 1, name });
    });

    app.delete(
      '/api/my-feature/items/:id',
      async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ error: 'Invalid ID.' });
          return;
        }
        plugin.logger.info(`Deleted item: ${id}`);
        res.status(204).send();
      }
    );
  },
};
```

After adding REST endpoints, run `npm run build` and restart to test with `curl` or a browser.
