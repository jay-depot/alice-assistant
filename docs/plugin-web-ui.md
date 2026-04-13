# Web UI Extension Guide

Plugins can extend the A.L.I.C.E. web interface by registering JavaScript bundles and CSS stylesheets, then exporting React components that are mounted into predefined UI regions. This guide covers the complete extension flow from server-side registration to client-side rendering.

> **Source of truth:** `src/plugins/system/web-ui/web-ui.ts`, `src/plugins/system/web-ui/client/`

---

## Overview

The web UI extension system works in three stages:

1. **Server-side registration** — A plugin calls `webUi.registerScript()` and/or `webUi.registerStylesheet()` to register asset paths.
2. **Client-side discovery** — The React app fetches `GET /api/extensions` to get a list of all registered extensions.
3. **Client-side rendering** — Each extension script is dynamically imported. Exported components are mounted into UI regions.

```
Plugin server code
  └─ webUi.registerScript(absPath)     → serves at /plugin-scripts/{id}-{name}
  └─ webUi.registerStylesheet(absPath) → serves at /plugin-styles/{id}-{name}
  └─ Both grouped by directory; styles auto-attached to scripts in same dir

Client bootstrap (useExtensions)
  └─ GET /api/extensions → [{id, scriptUrl?, styleUrls[]}]
  └─ For each extension:
      ├─ Inject <link> for each styleUrls entry
      ├─ If scriptUrl: dynamic import()
      ├─ Read module.default.regions → registerComponent() for each
      ├─ Read module.default.routes → registerRoute() for each
      └─ Call module.default.onAliceUIReady(api) if defined

React rendering
  └─ <RegionSlot region="sidebar-top" /> → renders all components in that region
  └─ <RegionSlot region="chat-header" /> → etc.
  └─ Plugin routes → rendered as <Route> in <BrowserRouter>
```

---

## Server-Side Registration

### `webUi.registerScript(scriptPath: string): void`

Registers a JavaScript bundle to be loaded by the web UI client.

**Behavior:**

- Resolves the path to an absolute path using `path.resolve()`
- Validates that the file exists and is a file (not a directory)
- Deduplicates — calling with the same path twice is a no-op
- Generates a deterministic ID from a SHA-1 hash of the resolved path (first 12 hex characters)
- Serves the file at `/plugin-scripts/{id}-{safeFileName}` with `Cache-Control: no-store` and `Content-Type: application/javascript`
- Groups scripts by their **directory** — scripts in the same directory share a `groupKey`
- Automatically attaches any stylesheets registered from the same directory to the script's `styleUrls`

**Example:**

```typescript
import path from 'node:path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const webUi = plugin.request('web-ui');
if (webUi) {
  webUi.registerScript(path.join(currentDir, 'my-plugin-web-ui.js'));
}
```

### `webUi.registerStylesheet(stylesheetPath: string): void`

Registers a CSS stylesheet to be loaded by the web UI client.

**Behavior:**

- Same path resolution, validation, deduplication, and ID generation as `registerScript`
- Serves the file at `/plugin-styles/{id}-{safeFileName}` with `Cache-Control: no-store` and `Content-Type: text/css`
- Groups stylesheets by directory — stylesheets are **automatically associated** with scripts from the same directory
- If a stylesheet is registered **after** a script in the same directory, it's retroactively added to that script's `styleUrls`
- Stylesheets in directories with no script get their own extension entry (with no `scriptUrl`)

**Example:**

```typescript
webUi.registerStylesheet(path.join(currentDir, 'my-plugin-web-ui.css'));
```

### Grouping Behavior

Scripts and stylesheets in the **same directory** are automatically grouped together. This means:

- If you register `my-plugin-web-ui.js` and `my-plugin-web-ui.css` from the same directory, the CSS will be included in the script's `styleUrls` array
- The client loads stylesheets before importing the script, ensuring styles are available when the component renders
- You don't need to manually associate stylesheets with scripts — just put them in the same directory

### `/api/extensions` Endpoint

The server exposes `GET /api/extensions` which returns:

```typescript
type AliceUiScriptRegistration = {
  id: string;
  scriptUrl?: string;
  styleUrls: string[];
};

// Response:
{ extensions: AliceUiScriptRegistration[] }
```

---

## Client-Side Extension Protocol

### `PluginClientExport`

Each extension script must export a `PluginClientExport` object (as the default export):

```typescript
interface PluginClientExport {
  /** Static component-to-region mapping. */
  regions?: Partial<Record<UIRegion, ComponentType>>;
  /** Static route definitions. */
  routes?: PluginClientRoute[];
  /** Dynamic registration callback. Called after regions and routes are processed. */
  onAliceUIReady?: (api: AliceUIExtensionApi) => void | Promise<void>;
}
```

### `AliceUIExtensionApi`

The `onAliceUIReady` callback receives an API object:

```typescript
interface AliceUIExtensionApi {
  /** Register a React component into a UI region. */
  registerComponent: (region: UIRegion, component: ComponentType) => void;
  /** Register a route with a component. */
  registerRoute: (route: PluginClientRoute) => void;
}
```

### `PluginClientRoute`

```typescript
interface PluginClientRoute extends ExtensionRouteDefinition {
  component: ComponentType;
}

interface ExtensionRouteDefinition {
  path: string;
  title?: string;
}
```

### Two Registration Patterns

**Pattern 1: Static exports** — Export `regions` and/or `routes` directly:

```typescript
const MyWidget: React.FC = () => {
  /* ... */
};
const SettingsPanel: React.FC = () => {
  /* ... */
};

const extension: PluginClientExport = {
  regions: {
    'sidebar-top': MyWidget,
    'settings-panel': SettingsPanel,
  },
};

export default extension;
```

**Pattern 2: Dynamic registration** — Use `onAliceUIReady` for conditional or async registration:

```typescript
const extension: PluginClientExport = {
  onAliceUIReady(api) {
    api.registerComponent('sidebar-top', MyWidget);
    api.registerRoute({
      path: '/my-plugin',
      title: 'My Plugin',
      component: MyPage,
    });
  },
};

export default extension;
```

You can combine both patterns in the same export.

### Stylesheet Loading

Stylesheets are loaded by creating `<link>` elements in the document `<head>`:

```html
<link
  rel="stylesheet"
  href="/plugin-styles/{id}-{name}"
  data-alice-plugin-style-url="/plugin-styles/{id}-{name}"
/>
```

The `data-alice-plugin-style-url` attribute is used for deduplication — if a stylesheet with the same URL is already loaded, it won't be loaded again.

---

## UI Regions

Components can be mounted into any of the following regions:

| Region           | Location                    | Description                                                        |
| ---------------- | --------------------------- | ------------------------------------------------------------------ |
| `sidebar-top`    | Top of the sidebar          | Before the logo and "New Chat" button. Good for status widgets.    |
| `sidebar-bottom` | Bottom of the sidebar       | After navigation items. Good for settings or info widgets.         |
| `chat-header`    | Above the chat message list | Inside the chat header actions area. Good for chat-level controls. |
| `message-prefix` | Before all messages         | Rendered before the message list. Good for announcements.          |
| `message-suffix` | After all messages          | Rendered after the message list. Good for status indicators.       |
| `input-prefix`   | Before the input area       | Before the text input. Good for input accessories.                 |
| `settings-panel` | Inside the settings panel   | Inside the settings panel body. Good for plugin configuration UI.  |

### `RegionSlot` Component

Each region is rendered by a `<RegionSlot>` component:

```tsx
<RegionSlot region="sidebar-top" className="my-custom-class" />
```

The `RegionSlot` reads from the `ExtensionContext` registry and renders all registered components for the given region inside a `<div className="region-slot region-slot--{region}">`.

---

## Plugin Routes

Plugins can register full-page routes that appear in the sidebar navigation:

```typescript
const extension: PluginClientExport = {
  routes: [{ path: '/my-plugin', title: 'My Plugin', component: MyPluginPage }],
  onAliceUIReady(api) {
    // Can also register routes dynamically
    api.registerRoute({
      path: '/my-plugin/settings',
      title: 'Settings',
      component: SettingsPage,
    });
  },
};
```

Routes appear as navigation links in the sidebar. Each route renders its component as a `<PluginRoutePage>` within the main `<BrowserRouter>`.

---

## Build Setup

Plugin web UI bundles must be built as standalone JavaScript files that work with the main client bundle's React instance.

### Key Requirements

1. **Externalize React and React-DOM** — The main client bundle provides `globalThis.React` and `globalThis.ReactDOM`. Your bundle must NOT bundle its own copy.
2. **ESM output** — The client uses dynamic `import()` to load your script.
3. **Default export** — Your bundle must export a `PluginClientExport` as the default export.

### esbuild Configuration

Here's a typical esbuild config for a plugin web UI:

```javascript
import esbuild from 'esbuild';
import path from 'node:path';

const currentDir = path.dirname(import.meta.url.replace('file://', ''));

esbuild.build({
  entryPoints: [path.join(currentDir, 'my-plugin-web-ui.tsx')],
  bundle: true,
  outfile: path.join(currentDir, 'my-plugin-web-ui.js'),
  format: 'esm',
  external: ['react', 'react-dom'],
  // Do NOT minify during development for easier debugging
  minify: false,
});
```

### Accessing React

In your plugin web UI code, access React from `globalThis`:

```typescript
type ReactModule = typeof import('react');
const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

if (!React) {
  throw new Error('My plugin requires globalThis.React to be available.');
}

const { useState, useEffect, useCallback } = React;
```

### CSS

Write a separate CSS file and register it alongside your script:

```typescript
webUi.registerStylesheet(path.join(currentDir, 'my-plugin-web-ui.css'));
```

CSS class names should be prefixed with your plugin ID to avoid collisions:

```css
.my-plugin-widget {
  padding: 8px;
}
.my-plugin-widget__title {
  font-weight: bold;
}
```

---

## Complete Working Example: The Mood Plugin

The `mood` plugin is a real working example of web UI extension. Here's how it works:

### Server Side (`src/plugins/community/mood/mood.ts`)

```typescript
import path from 'node:path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// ... plugin registration ...

const webUi = plugin.request('web-ui');
if (webUi) {
  // Register both files from the same directory — they'll be grouped automatically
  webUi.registerStylesheet(path.join(currentDir, 'mood-web-ui.css'));
  webUi.registerScript(path.join(currentDir, 'mood-web-ui.js'));
}

// Also expose a REST endpoint for the widget to poll
const restServe = plugin.request('rest-serve');
if (restServe) {
  restServe.express.get('/api/mood', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ mood: currentMood.mood, face: getMoodFace(currentMood.mood) });
  });
}
```

### Client Side (`src/plugins/community/mood/mood-web-ui.tsx`)

```typescript
import type {
  AliceUIExtensionApi,
  PluginClientExport,
} from '../../system/web-ui/client/types/index.js';

type ReactModule = typeof import('react');
const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

function MoodWidget() {
  const [state, setState] = React.useState({ mood: 'neutral', face: '(-_-)' });

  React.useEffect(() => {
    const intervalId = window.setInterval(async () => {
      const response = await fetch('/api/mood');
      const data = await response.json();
      setState({ mood: data.mood ?? 'neutral', face: data.face ?? '(-_-)' });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, []);

  return React.createElement(
    'div',
    { className: 'mood-widget' },
    React.createElement('span', { className: 'mood-face' }, state.face),
    React.createElement('span', { className: 'mood-label' }, state.mood)
  );
}

const moodUiExtension: PluginClientExport = {
  onAliceUIReady(api: AliceUIExtensionApi) {
    api.registerComponent('sidebar-top', MoodWidget);
  },
};

export default moodUiExtension;
```

### Build (`package.json` scripts)

```json
{
  "scripts": {
    "build:plugin-ui": "esbuild src/plugins/community/mood/mood-web-ui.tsx --bundle --outfile=src/plugins/community/mood/mood-web-ui.js --format=esm --external:react --external:react-dom"
  }
}
```

### Result

When the web UI loads:

1. It fetches `/api/extensions` and finds the mood extension
2. It injects `mood-web-ui.css` as a `<link>` in the document head
3. It dynamically imports `mood-web-ui.js`
4. It calls `onAliceUIReady(api)` which registers `MoodWidget` into the `sidebar-top` region
5. The `MoodWidget` component renders in the sidebar, polling `/api/mood` every 3 seconds
