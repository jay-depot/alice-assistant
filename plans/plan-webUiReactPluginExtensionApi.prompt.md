# Plan: React Web UI + Plugin Component Extension API

## TL;DR
Migrate the vanilla-TS web UI client to React 18 + esbuild. Add a server-side `registerScript()` API to the `web-ui` plugin capability so other plugins can ship pre-built client bundles that are served and dynamically imported by the React app, rendering their components into named region slots.

---

## Decisions
- **Bundler:** esbuild (client-side only; server still uses tsc)
- **React:** v18 + react-dom + react-router-dom (for custom page routes)
- **Plugin delivery:** Plugins ship a pre-built `.js` file; web-ui serves it as a static asset
- **Regions:** sidebar-top, sidebar-bottom, chat-header, message-prefix, message-suffix, input-prefix, settings-panel + custom full-page routes
- **No markdown docs file** (per user instruction)
- The main tsconfig.json stays NodeNext; a `tsconfig.client.json` in the client folder handles JSX + DOM lib

---

## Phase 1 — Project Setup (no code dependencies)

1. [x] Install `react`, `react-dom`, `react-router-dom` + their `@types/*` as deps
2. [x] Install `esbuild` as a dev dep
3. [x] Create `src/plugins/web-ui/client/tsconfig.client.json` extending root but with `"jsx": "react-jsx"`, `"lib": ["ES2022","DOM"]`, `"moduleResolution": "bundler"`, `"module": "ESNext"`
4. [x] Add npm scripts to `package.json`:
   - `build:server` — existing tsc + copyfiles logic
   - `build:client` — esbuild bundle command targeting `src/plugins/web-ui/client/index.tsx` → `dist/plugins/web-ui/client/alice-client.js`
   - `build` — runs both in sequence
5. [x] Update `index.html`: change `<script type="module" src="alice-client.js">` stays the same; add `<div id="root">` as the only body child inside `#app` (clear the old static markup, or adjust appropriately while the React migration is in progress)

---

## Phase 2 — Type & API Layer (depends on Phase 1)

- [x] Create `src/plugins/web-ui/client/types/index.ts`:
  - Port existing interfaces: `Message`, `Session`, `SessionSummary`, `MoodResponse`
  - Add new: `UIRegion` union type, `ExtensionRegistration`, `PluginClientExport`

- [x] Create `src/plugins/web-ui/client/api/`:
  - `client.ts` — `apiFetch<T>()` wrapper (ported from `alice-client.ts`)
  - `sessions.ts` — `fetchSessions()`, `fetchSession()`, `createSession()`, `patchSession()`, `endSession()`
  - `mood.ts` — `fetchMood()`
  - `extensions.ts` — `fetchExtensions()` → `GET /api/extensions` (returns `[]` until Phase 6 lands)

---

## Phase 3 — React Hooks (depends on Phase 2)

- [x] Create `src/plugins/web-ui/client/hooks/`:
  - `useSessions.ts` — list + CRUD for sessions
  - `useSession.ts` — active session state, message sending, loading flag
  - `useMood.ts` — 3-second polling, stops when tab hidden (ported from `alice-client.ts`)
  - `useExtensions.ts` — fetches `GET /api/extensions` at mount, dynamically imports each `scriptUrl`, and exposes extension regions/routes through the context layer

---

## Phase 4 — React Components (depends on Phase 3)

- [x] Create `src/plugins/web-ui/client/components/`:
  - `RegionSlot.tsx` — reads `ExtensionContext`, renders all components registered for a given region id
  - `MoodBox.tsx` — mood class on a div (temporary until that UI is moved into the `mood` plugin itself)
  - `SessionItem.tsx` — single session in sidebar with relative timestamp
  - `SessionsList.tsx` — renders session items and handles selection
  - `Sidebar.tsx` — sidebar header, `RegionSlot('sidebar-top')`, sessions list, `RegionSlot('sidebar-bottom')`
  - `ChatHeader.tsx` — session title, end-session button, `RegionSlot('chat-header')`, settings button
  - `WelcomeScreen.tsx` — welcome logo + hint overlay
  - `MessageBubble.tsx` — user/assistant bubble with timestamp and preserved newlines
  - `TypingIndicator.tsx` — animated dots
  - `MessagesArea.tsx` — scroll container, `RegionSlot('message-prefix')`, message list, typing indicator, `RegionSlot('message-suffix')`, auto-scroll behavior
  - `InputArea.tsx` — `RegionSlot('input-prefix')`, textarea auto-resize, send button, `Enter`/`Shift+Enter` handling
  - `SettingsPanel.tsx` — slide-over drawer with `RegionSlot('settings-panel')`
  - `ErrorToast.tsx` — existing toast notification behavior, now as a component
---

## Phase 5 — Context & App Root (depends on Phase 4)

- [x] Create `src/plugins/web-ui/client/context/ExtensionContext.tsx`:
  - `ExtensionRegistry` type: `Record<string, React.ComponentType[]>` (region id → components)
  - `ExtensionProvider` — uses `useExtensions()`, exposes registry + custom routes via context
  - `useExtensionRegistry()` helper hook

- [x] Create `src/plugins/web-ui/client/App.tsx`:
  - Wraps the UI in `BrowserRouter` (react-router-dom)
  - Route `/` — main chat layout (Sidebar + ChatHeader + MessagesArea + InputArea + SettingsPanel)
  - Additional routes from `ExtensionProvider.routes` are registered dynamically and exposed in the sidebar
  - Session state remains housed in the React app shell

- [x] Create `src/plugins/web-ui/client/index.tsx`:
  - `ReactDOM.createRoot(document.getElementById('root')!).render(<ExtensionProvider><App /></ExtensionProvider>)`

- [x] Delete old `alice-client.ts` once the React shell was fully in place

---

## Phase 6 — Server-Side Extension API (parallel with Phase 4/5)

- [x] **`src/lib/types/alice-plugin-interface.ts`** exports shared web UI extension types, including `UIRegion`
- [x] **`src/plugins/web-ui/web-ui.ts`** now provides `registerScript(absPath: string): void` through `PluginCapabilities['web-ui']`
- [x] `registerScript()` validates the file, derives a stable `/plugin-scripts/{hash}-{filename}` URL, and serves it through Express
- [x] `GET /api/extensions` returns `{ extensions: registrations }`
- [x] `plugin.offer<'web-ui'>({ express: app, registerScript })` exposes the API to dependent plugins
- [x] Added an SPA fallback route so plugin pages registered in the React router also work on direct navigation/refresh

---

## Phase 7 — index.html Cleanup (depends on Phase 5)

Update `src/plugins/web-ui/client/index.html`:
- Remove all static DOM markup inside `<body>` (sidebar, main, etc.)
- Replace with `<div id="root"></div>`
- Keep `<link rel="stylesheet" href="style.css" />` and `/user-style.css`

---

## Phase 8 — Mood Plugin Cleanup
- [x] Move the `/api/mood` endpoint registration into the `mood` plugin
- [x] Move the mood polling logic into the mood plugin's own client script (`src/plugins/mood/mood-web-ui.js`)
- [x] Remove mood display from the default web UI and have the `mood` plugin register it into the `sidebar-top` region itself
- [x] Remove the remaining direct dependency on the `mood` plugin from `web-ui`
- [x] Reverse the dependency relationship so `mood` depends on `web-ui`
- [x] Make `mood` optional for the assistant in `src/plugins/system-plugins.json`

## Relevant Files

| File | Action |
|---|---|
| `src/plugins/web-ui/client/alice-client.ts` | DELETED (legacy vanilla client entry) |
| `src/plugins/web-ui/client/index.html` | Simplify to just `<div id="root">` |
| `src/plugins/web-ui/client/style.css` | Keep as-is (CSS custom properties + mood classes reused) |
| `src/plugins/web-ui/web-ui.ts` | Add `registerScript`, `GET /api/extensions`, update `plugin.offer` |
| `src/lib/types/alice-plugin-interface.ts` | Add `UIRegion`, extend `PluginCapabilities['web-ui']` |
| `package.json` | Add React deps, esbuild, build scripts |
| `tsconfig.json` | Add JSX support for the client `.tsx` files |
| `src/plugins/web-ui/client/tsconfig.client.json` | NEW — JSX + DOM lib |

---

## Plugin Author Contract (how a plugin uses registerScript)

Server-side in their plugin:
```ts
const { registerScript } = plugin.request('web-ui');
registerScript(path.join(currentDir, 'client-bundle.js'));
```

Their pre-built `client-bundle.js` can default-export static regions/routes and/or an `onAliceUIReady()` hook. For hook-based components, use the shared React instance exposed as `globalThis.React` by the host app:
```ts
export default {
  onAliceUIReady(api) {
    api.registerComponent('sidebar-bottom', MySidebarWidget);
    api.registerRoute({ path: '/my-page', title: 'My Page', component: MyPage });
  }
}
```

---

## Verification Steps

1. Run `npm run build` — both server (tsc) and client (esbuild) must succeed without errors
2. Start the assistant; open http://localhost:{PORT}/ — React app loads, existing chat functionality works identically to before (create session, send messages, session list, mood updates, delete session)
3. Create a minimal test plugin that calls `registerScript` with a tiny pre-built bundle exporting a sidebar-bottom component; verify it appears in the sidebar after restart
4. Verify `/api/extensions` returns the test registration
5. Verify custom route `/my-page` renders the registered component
6. Verify `GET /plugin-scripts/...` serves the bundle JS correctly
7. Verify user-style.css still applies
8. Run `tsc --noEmit` on server code to confirm no type regressions
