// routes/static.ts — Static file serving routes for the web-ui plugin.
// /user-style.css is registered directly in web-ui.ts at plugin-load time
// because it has no database dependency.

import * as path from 'node:path';
import { static as serveStatic } from 'express';
import type { WebUiContext } from '../context.js';

export function registerStaticRoutes(
  ctx: WebUiContext,
  currentDir: string
): void {
  ctx.app.use(
    serveStatic(path.join(currentDir, 'client'), { fallthrough: true })
  );

  // ── SPA catch-all ─────────────────────────────────────────────────────
  ctx.app.get(
    /^\/(?!api(?:\/|$)|plugin-scripts(?:\/|$)|plugin-styles(?:\/|$)).*/,
    (_req, res) => {
      res.sendFile(path.join(currentDir, 'client', 'index.html'));
    }
  );
}
