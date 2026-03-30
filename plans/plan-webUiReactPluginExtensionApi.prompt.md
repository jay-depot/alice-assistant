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

1. Install `react`, `react-dom`, `react-router-dom` + their `@types/*` as deps
2. Install `esbuild` as a dev dep
3. Create `src/plugins/web-ui/client/tsconfig.client.json` extending root but with `"jsx": "react-jsx"`, `"lib": ["ES2022","DOM"]`, `"moduleResolution": "bundler"`, `"module": "ESNext"`
4. Add npm scripts to `package.json`:
   - `build:server` — existing tsc + copyfiles logic
   - `build:client` — esbuild bundle command targeting `src/plugins/web-ui/client/index.tsx` → `dist/plugins/web-ui/client/alice-client.js`
   - `build` — runs both in sequence
5. Update `index.html`: change `<script type="module" src="alice-client.js">` stays the same; add `<div id="root">` as the only body child inside `#app` (clear the old static markup, or adjust index.html appropriately after React is wired up)

---

## Phase 2 — Type & API Layer (depends on Phase 1)

Create `src/plugins/web-ui/client/types/index.ts`:
- Port existing interfaces: `Message`, `Session`, `SessionSummary`, `MoodResponse`
- Add new: `UIRegion` union type, `ExtensionRegistration`, `PluginClientExport`

Create `src/plugins/web-ui/client/api/`:
- `client.ts` — `apiFetch<T>()` wrapper (port from alice-client.ts)
- `sessions.ts` — `fetchSessions()`, `fetchSession()`, `createSession()`, `patchSession()`, `endSession()`
- `mood.ts` — `fetchMood()`
- `extensions.ts` — `fetchExtensions()` → GET /api/extensions

---

## Phase 3 — React Hooks (depends on Phase 2)

Create `src/plugins/web-ui/client/hooks/`:
- `useSessions.ts` — list + CRUD for sessions
- `useSession.ts` — active session state, message sending, loading flag
- `useMood.ts` — 3-second polling, stops when tab hidden (port logic from alice-client.ts)
- `useExtensions.ts` — fetches GET /api/extensions at mount, and dynamically imports each `scriptUrl`. Each script will then have to implement onAliceUIReady() where it may register its components and routes. Updates the ExtensionContext registry with loaded extensions on the fly so regions can be re-rendered with new components. Blocker: Need to determine contract for how these extension scripts should look, and how they register their components + routes once loaded.

---

## Phase 4 — React Components (depends on Phase 3)

Create `src/plugins/web-ui/client/components/`:
- `RegionSlot.tsx` — reads `ExtensionContext`, renders all components registered for a given region id
- `MoodBox.tsx` — mood class on a div (port mood polling display, temporary until it's moved into the mood plugin itself)
- `SessionItem.tsx` — single session in sidebar with relative timestamp
- `SessionsList.tsx` — renders session items, handles selection
- `Sidebar.tsx` — sidebar-header (logo, new-chat btn), RegionSlot('sidebar-top'), SessionsList, RegionSlot('sidebar-bottom'), plugin page nav links
- `ChatHeader.tsx` — session title, end-session btn, RegionSlot('chat-header'), settings gear button (triggers settings panel)
- `WelcomeScreen.tsx` — welcome logo + hint overlay
- `MessageBubble.tsx` — user/assistant bubble with timestamp, escapeHtml, preserves newlines
- `TypingIndicator.tsx` — animated dots
- `MessagesArea.tsx` — scroll container, RegionSlot('message-prefix'), message list, TypingIndicator, RegionSlot('message-suffix'), auto-scroll behaviour
- `InputArea.tsx` — RegionSlot('input-prefix'), textarea (auto-resize up to 150px), send button, Enter/Shift+Enter handling
- `SettingsPanel.tsx` — slide-over or modal drawer, RegionSlot('settings-panel')
- `ErrorToast.tsx` — port existing toast notification

---

## Phase 5 — Context & App Root (depends on Phase 4)

Create `src/plugins/web-ui/client/context/ExtensionContext.tsx`:
- `ExtensionRegistry` type: `Record<string, React.ComponentType[]>` (region id → components)
- `ExtensionProvider` — uses `useExtensions()`, exposes registry + custom routes via context
- `useExtensionRegistry()` helper hook

Create `src/plugins/web-ui/client/App.tsx`:
- Wraps everything in `ExtensionProvider` + `BrowserRouter` (react-router-dom)
- Route `/` — main chat layout (Sidebar + ChatHeader + MessagesArea + InputArea + SettingsPanel)
- Additional routes from `ExtensionProvider.routes` registered dynamically
- Session state housed here (or in a SessionContext if complexity warrants)

Create `src/plugins/web-ui/client/index.tsx`:
- `ReactDOM.createRoot(document.getElementById('root')!).render(<App />)`

Delete old `alice-client.ts` (after React version is complete)

---

## Phase 6 — Server-Side Extension API (parallel with Phase 4/5)

**`src/lib/types/alice-plugin-interface.ts`** — extend `PluginCapabilities['web-ui']`:
```
registerScript(absPath: string): void;
```
Also export `UIRegion` type from this file.

**`src/plugins/web-ui/web-ui.ts`**:
- Internal `registrations: ExtensionRegistration[]` array
- `registerScript()` implementation:
  - Validates `absPath` is an existing file
  - Derives a stable URL path: `/plugin-scripts/{hash-or-sanitized-filename}`
  - Registers an Express `GET` route to serve the file (before `app.listen`)
- Add `GET /api/extensions` route returning `{ extensions: registrations }`
- Include `registerScript` in `plugin.offer<'web-ui'>({ express: app, registerScript })`
- `registerScript` must be callable **before** `onAssistantAcceptsRequests` fires (i.e. it queues registrations, routes are applied when the server starts)

---

## Phase 7 — index.html Cleanup (depends on Phase 5)

Update `src/plugins/web-ui/client/index.html`:
- Remove all static DOM markup inside `<body>` (sidebar, main, etc.)
- Replace with `<div id="root"></div>`
- Keep `<link rel="stylesheet" href="style.css" />` and `/user-style.css`

---

## Relevant Files

| File | Action |
|---|---|
| `src/plugins/web-ui/client/alice-client.ts` | DELETE after React port |
| `src/plugins/web-ui/client/index.html` | Simplify to just `<div id="root">` |
| `src/plugins/web-ui/client/style.css` | Keep as-is (CSS custom properties + mood classes reused) |
| `src/plugins/web-ui/web-ui.ts` | Add `registerScript`, `GET /api/extensions`, update `plugin.offer` |
| `src/lib/types/alice-plugin-interface.ts` | Add `UIRegion`, extend `PluginCapabilities['web-ui']` |
| `package.json` | Add React deps, esbuild, build scripts |
| `tsconfig.json` | No changes needed |
| `src/plugins/web-ui/client/tsconfig.client.json` | NEW — JSX + DOM lib |

---

## Plugin Author Contract (how a plugin uses registerScript)

Server-side in their plugin:
```ts
const { registerScript } = plugin.request('web-ui');
registerScript(path.join(currentDir, 'client-bundle.js'), {
  regions: ['sidebar-bottom'],
  routes: [{ path: '/my-page', title: 'My Page' }]
});
```

Their pre-built `client-bundle.js` default-exports:
```ts
export default {
  regions: {
    'sidebar-bottom': MySidebarWidget,    // React.ComponentType
  },
  routes: [
    { path: '/my-page', component: MyPage }
  ]
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
