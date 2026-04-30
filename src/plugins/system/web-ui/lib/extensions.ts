// lib/extensions.ts — UI extension registration for the web-ui plugin.
// Handles registerScript, registerStylesheet, and the /api/extensions route.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { WebUiContext, RegisteredUiExtension } from '../context.js';
import type { AliceUiScriptRegistration } from '../../../../lib/types/alice-plugin-interface.js';

// ── registerScript ───────────────────────────────────────────────────────

/** Called by registerScript: creates the Express route for serving a plugin
 *  client script and returns the AliceUiScriptRegistration record. */
function registerScriptRoute(
  ctx: WebUiContext,
  resolvedPath: string,
  groupKey: string
): AliceUiScriptRegistration {
  const scriptId = createHash('sha1')
    .update(resolvedPath)
    .digest('hex')
    .slice(0, 12);
  const safeFileName = path
    .basename(resolvedPath)
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  const scriptUrl = `/plugin-scripts/${scriptId}-${safeFileName}`;

  ctx.app.get(scriptUrl, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/javascript');
    res.sendFile(resolvedPath);
  });

  ctx.logger.log(
    `Registered web UI client script ${resolvedPath} at ${scriptUrl}`
  );

  return {
    id: scriptId,
    scriptUrl,
    styleUrls: [...(ctx.stylesheetUrlsByGroup.get(groupKey) ?? [])],
  };
}

export function registerScript(ctx: WebUiContext, scriptPath: string): void {
  const resolvedPath = path.resolve(scriptPath);
  const groupKey = path.dirname(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `web-ui plugin: registerScript could not find file: ${resolvedPath}`
    );
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error(
      `web-ui plugin: registerScript expected a file path, got: ${resolvedPath}`
    );
  }

  if (ctx.registeredScriptPaths.has(resolvedPath)) {
    return;
  }

  ctx.registeredScriptPaths.add(resolvedPath);
  const registration = registerScriptRoute(ctx, resolvedPath, groupKey);
  ctx.registeredScripts.push({
    ...registration,
    groupKey,
  });
}

// ── registerStylesheet ───────────────────────────────────────────────────

export function registerStylesheet(
  ctx: WebUiContext,
  stylesheetPath: string
): void {
  const resolvedPath = path.resolve(stylesheetPath);
  const groupKey = path.dirname(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `web-ui plugin: registerStylesheet could not find file: ${resolvedPath}`
    );
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error(
      `web-ui plugin: registerStylesheet expected a file path, got: ${resolvedPath}`
    );
  }

  if (ctx.registeredStylesheetPaths.has(resolvedPath)) {
    return;
  }

  const stylesheetId = createHash('sha1')
    .update(resolvedPath)
    .digest('hex')
    .slice(0, 12);
  const safeFileName = path
    .basename(resolvedPath)
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  const styleUrl = `/plugin-styles/${stylesheetId}-${safeFileName}`;

  ctx.registeredStylesheetPaths.add(resolvedPath);
  ctx.stylesheetUrlsByGroup.set(groupKey, [
    ...(ctx.stylesheetUrlsByGroup.get(groupKey) ?? []),
    styleUrl,
  ]);

  ctx.registeredScripts.forEach(registration => {
    if (
      registration.groupKey === groupKey &&
      !registration.styleUrls.includes(styleUrl)
    ) {
      registration.styleUrls.push(styleUrl);
    }
  });

  ctx.app.get(styleUrl, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/css');
    res.sendFile(resolvedPath);
  });

  ctx.logger.log(`Registered web UI stylesheet ${resolvedPath} at ${styleUrl}`);
}

// ── /api/extensions route ────────────────────────────────────────────────

export function addExtensionsRoute(ctx: WebUiContext): void {
  ctx.app.get('/api/extensions', async (_req, res) => {
    const groupsWithScripts = new Set(
      ctx.registeredScripts.map(
        (registration: RegisteredUiExtension) => registration.groupKey
      )
    );
    const styleOnlyExtensions: AliceUiScriptRegistration[] = [];

    ctx.stylesheetUrlsByGroup.forEach((styleUrls, groupKey) => {
      if (styleUrls.length === 0 || groupsWithScripts.has(groupKey)) {
        return;
      }

      const styleOnlyId = createHash('sha1')
        .update(`style-only:${groupKey}`)
        .digest('hex')
        .slice(0, 12);

      styleOnlyExtensions.push({
        id: styleOnlyId,
        styleUrls: [...styleUrls],
      });
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      extensions: [
        ...ctx.registeredScripts.map(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ groupKey: _groupKey, ...registration }) => registration
        ),
        ...styleOnlyExtensions,
      ],
    });
  });
}
