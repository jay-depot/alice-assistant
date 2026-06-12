---
name: web-ui-extensions
description: Use when adding UI components, scripts, or stylesheets to the Alice web interface. Trigger phrases: "web UI", "add UI", "registerScript", "registerStylesheet", "sidebar", "chat header", "message prefix", "UI component", "React component", "browser bundle".
---

# Web UI Extensions in Alice

Use the `web-ui` plugin's offered API to register scripts, stylesheets, and UI components. The web UI is a React app; plugin UI code runs in the browser as separate esbuild bundles.

## Requesting the API

```typescript
const webUi = plugin.request('web-ui');
if (!webUi) {
  throw new Error('[my-plugin] web-ui plugin not available.');
}
```

Add `{ id: 'web-ui', version: 'LATEST' }` to `pluginMetadata.dependencies`.

## Registering Assets

```typescript
webUi.registerScript(path.join(import.meta.dirname, 'my-web-ui.js'));
webUi.registerStylesheet(path.join(import.meta.dirname, 'my-web-ui.css'));
```

These are built separately by `npm run build:plugin-ui` (or a custom esbuild config). The files must exist in `dist/` at runtime.

## Browser Bundle Pattern

Plugin UI code runs in the browser. Since React is provided by the host web-ui bundle, use `globalThis.React` instead of direct imports:

```typescript
// This file is built with esbuild into a standalone JS bundle that runs
// in the browser. It uses globalThis.React instead of importing React,
// since React is provided by the host web-ui bundle.

type ReactModule = typeof import('react');
const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;
```

## UI Regions (Slots)

Export an `onAliceUIReady(api)` function from your script. Register components into these slots:

| Slot name        | Location                    |
| ---------------- | --------------------------- |
| `sidebar-top`    | Top of the sidebar          |
| `sidebar-bottom` | Bottom of the sidebar       |
| `chat-header`    | Above the chat message list |
| `message-prefix` | Before each chat message    |
| `message-suffix` | After each chat message     |
| `input-prefix`   | Before the input area       |
| `settings-panel` | Inside the settings panel   |

## Full Example

```typescript
// my-plugin.ts (server-side)
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import path from 'node:path';

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#4f46e5',
    description: 'Plugin with web UI extensions.',
    version: '0.0.1',
    dependencies: [{ id: 'web-ui', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const webUi = plugin.request('web-ui');

    if (webUi) {
      webUi.registerScript(path.join(import.meta.dirname, 'my-web-ui.js'));
      webUi.registerStylesheet(path.join(import.meta.dirname, 'my-web-ui.css'));
    }
  },
};
```

```typescript
// my-web-ui.ts (browser bundle entry point)
type ReactModule = typeof import('react');
const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

export function onAliceUIReady(api: {
  registerComponent: (
    slot: string,
    component: () => React.ReactElement
  ) => void;
}) {
  api.registerComponent('sidebar-bottom', () => {
    return React.createElement(
      'div',
      { className: 'my-plugin-panel' },
      React.createElement('h3', null, 'My Plugin'),
      React.createElement('p', null, 'Hello from my plugin!')
    );
  });
}
```

Build the browser bundle with esbuild (add to `package.json` scripts or use `npm run build:plugin-ui` as a template).
