# Plugin Offered APIs Reference

System and community plugins can expose APIs to other plugins via the `offer()`/`request()` mechanism. This document catalogs every offered API, its full type signature, and usage examples.

> **Source of truth:** Each plugin's `declare module` augmentation and `offer()` call in `src/plugins/`.

---

## How `offer()`/`request()` Works

1. A plugin declares a dependency: `dependencies: [{ id: 'other-plugin', version: 'LATEST' }]`
2. The dependency plugin calls `plugin.offer({ ... })` during registration
3. The dependent plugin calls `plugin.request('other-plugin')` to get the API
4. TypeScript typing is provided via module augmentation of `PluginCapabilities`

```typescript
// In the offering plugin:
declare module '@/lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'my-plugin': { myMethod(): void };
  }
}

// In the consuming plugin:
const api = plugin.request('my-plugin');
if (api) {
  api.myMethod();
}
```

**Rules:**

- `offer()` may only be called **once** per plugin, during registration
- `request()` may only be called for **declared dependencies**
- `request()` returns `undefined` if the dependency doesn't offer an API

---

## `memory`

**Plugin ID:** `memory` | **Required:** yes | **Dependencies:** none

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    memory: {
      /** Register MikroORM entities for the shared database. Must be called before DB init. */
      registerDatabaseModels: (entities: EntityClass<AnyEntity>[]) => void;
      /** Wait for the database to be ready, then run a callback with the ORM instance. */
      onDatabaseReady: <T>(
        callback: (orm: MikroORM) => Promise<T>
      ) => Promise<T>;
      /** Save a memory string to the database. */
      saveMemory: (content: string) => Promise<void>;
    };
  }
}
```

**Usage:**

```typescript
const memory = plugin.request('memory');
if (memory) {
  await memory.saveMemory('Important information to remember');
}
```

---

## `location-broker`

**Plugin ID:** `location-broker` | **Required:** yes | **Dependencies:** none

```typescript
type LocationData = {
  coordinates?: { latitude: number; longitude: number };
  localityName?: string;
  regionName?: string;
  countryName?: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'location-broker': {
      /** Register a location provider. Only one provider is allowed; throws on conflict. */
      registerLocationProvider: (
        name: string,
        callback: () => Promise<LocationData>
      ) => void;
      /** Request current location data from the registered provider. Returns {} if no provider. */
      requestLocationData: () => Promise<LocationData>;
    };
  }
}
```

**Usage:**

```typescript
const locationBroker = plugin.request('location-broker');
if (locationBroker) {
  const location = await locationBroker.requestLocationData();
  console.log(location.localityName);
}
```

---

## `notifications-broker`

**Plugin ID:** `notifications-broker` | **Required:** yes | **Dependencies:** none

```typescript
type Notification = {
  title: string;
  message: string;
  source: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'notifications-broker': {
      /** Send a notification to all registered sinks. */
      sendNotification: (notification: Notification) => Promise<void>;
      /** Register a notification sink that will receive all notifications. */
      registerNotificationSink: (
        name: string,
        sink: {
          sendNotification: (notification: Notification) => Promise<void>;
        }
      ) => Promise<void>;
    };
  }
}
```

**Usage:**

```typescript
const notifications = plugin.request('notifications-broker');
if (notifications) {
  await notifications.sendNotification({
    title: 'Reminder',
    message: 'Time for your meeting!',
    source: 'reminders-broker',
  });
}
```

---

## `reminders-broker`

**Plugin ID:** `reminders-broker` | **Required:** yes | **Dependencies:** `datetime`, `memory`, `notifications-broker`

```typescript
type Reminder = {
  id: string;
  reminderMessage: string;
  scheduledFor: Date;
  source: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'reminders-broker': {
      /** Create a new reminder. Returns the reminder ID. */
      createNewReminder: (reminder: Omit<Reminder, 'id'>) => Promise<string>;
      /** Update an existing reminder by ID. */
      updateReminder: (
        id: string,
        updatedDetails: Partial<Omit<Reminder, 'id'>>
      ) => Promise<void>;
      /** Delete a reminder by ID. */
      deleteReminder: (id: string) => Promise<void>;
    };
  }
}
```

**Usage:**

```typescript
const reminders = plugin.request('reminders-broker');
if (reminders) {
  const id = await reminders.createNewReminder({
    reminderMessage: 'Take out the trash',
    scheduledFor: new Date('2026-04-14T08:00:00'),
    source: 'my-plugin',
  });
}
```

---

## `rest-serve`

**Plugin ID:** `rest-serve` | **Required:** yes | **Dependencies:** none

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'rest-serve': {
      /** The Express application instance. Add routes and middleware directly. */
      express: Express;
    };
  }
}
```

**Usage:**

```typescript
const restServe = plugin.request('rest-serve');
if (restServe) {
  restServe.express.get('/api/my-plugin', (req, res) => {
    res.json({ status: 'ok' });
  });
}
```

---

## `web-ui`

**Plugin ID:** `web-ui` | **Required:** yes | **Dependencies:** `memory`, `rest-serve`

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'web-ui': {
      /** The Express application instance (same as rest-serve). */
      express: Express;
      /** Register a CSS stylesheet to be loaded by the web UI. */
      registerStylesheet: (path: string) => void;
      /** Register a JavaScript bundle to be loaded by the web UI. */
      registerScript: (path: string) => void;
      /** Find or create a chat session for sending messages. */
      resolveTargetChatSession: (options: {
        title?: string;
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => Promise<number | null>;
      /** Send a message to a specific session by ID. */
      queueAssistantMessageToSession: (
        sessionId: number,
        message: {
          content: string;
          messageKind?: 'chat' | 'notification';
          senderName?: string;
        }
      ) => Promise<void>;
      /** Send a message, optionally creating a new session. Returns the session ID. */
      queueAssistantMessage: (message: {
        content: string;
        title?: string;
        messageKind?: 'chat' | 'notification';
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => Promise<number | null>;
      /** Send an interruption message. Returns the session ID. */
      queueAssistantInterruption: (interruption: {
        content: string;
      }) => Promise<number | null>;
    };
  }
}
```

See [Web UI Extension Guide](./plugin-web-ui.md) for details on `registerScript` and `registerStylesheet`.

---

## `weather-broker`

**Plugin ID:** `weather-broker` | **Required:** no | **Dependencies:** `location-broker`, `datetime`

```typescript
type WeatherAlert = {
  title: string;
  description: string;
  severity: 'advisory' | 'watch' | 'warning';
  effectiveDate: Date;
  expiryDate: Date;
};

type WeatherData = {
  temperature: number;
  temperatureUnit: string;
  condition: string;
  relativeHumidity: number;
  relativeHumidityUnit: string;
  precipitationChance: number;
  precipitationChanceUnit: string;
  forecast?: {
    day: string;
    temperatureHigh: number;
    temperatureLow: number;
    condition: string;
    relativeHumidity: number;
    relativeHumidityUnit: string;
    precipitationChance: number;
    precipitationChanceUnit: string;
  }[];
  alerts?: WeatherAlert[];
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'weather-broker': {
      /** Register a weather data provider. */
      registerWeatherProvider: (
        name: string,
        callback: (location: LocationData) => Promise<WeatherData>
      ) => void;
      /** Request weather data from all registered providers. */
      requestWeatherData: () => Promise<
        Record<string, WeatherData> | undefined
      >;
      /** Get the ID of the preferred weather provider. Currently returns empty string. */
      getPreferredProviderId: () => Promise<string>;
    };
  }
}
```

---

## `web-search-broker`

**Plugin ID:** `web-search-broker` | **Required:** no | **Dependencies:** none

```typescript
type WebSearchResult = {
  title: string;
  snippet: string;
  url: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'web-search-broker': {
      /** Register a web search provider. */
      registerWebSearchProvider: (
        name: string,
        callback: (query: string) => Promise<WebSearchResult[]>
      ) => void;
      /** Request web search results from all registered providers. */
      requestWebSearchData: (
        query: string
      ) => Promise<Record<string, WebSearchResult[]>>;
      /** Get the ID of the preferred search provider. */
      getPreferredProviderId: () => Promise<string>;
    };
  }
}
```

---

## `news-broker`

**Plugin ID:** `news-broker` | **Required:** no | **Dependencies:** `location-broker`, `datetime`

```typescript
type NewsItem = {
  headline: string;
  preview?: string;
  url: string;
  source: string;
  age: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    'news-broker': {
      /** Register a news provider. */
      registerNewsProvider: (
        name: string,
        callback: (query: string) => Promise<NewsItem[]>
      ) => void;
      /** Request news data from all registered providers. */
      requestNewsData: (query: string) => Promise<Record<string, NewsItem[]>>;
    };
  }
}
```

---

## `skills`

**Plugin ID:** `skills` | **Required:** no | **Dependencies:** none

```typescript
type RegisteredSkill = {
  id: string;
  recallWhen: string;
  contents: string;
};

declare module '@/lib.js' {
  export interface PluginCapabilities {
    skills: {
      /** Register a skill programmatically. */
      registerSkill: (skill: RegisteredSkill) => void;
      /** Register a skill from a markdown file path. */
      registerSkillFile: (path: string) => void;
    };
  }
}
```

**Usage:**

```typescript
const skills = plugin.request('skills');
if (skills) {
  skills.registerSkill({
    id: 'my-plugin/special-skill',
    recallWhen: 'The user asks about topic X',
    contents: 'Detailed instructions for handling topic X...',
  });
}
```

---

## `user-files`

**Plugin ID:** `user-files` | **Required:** no | **Dependencies:** none

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'user-files': {
      /** Register a handler for reading text-based file types. */
      registerFileTypeTextHandler: (
        fileTypes: string[],
        callback: (filePath: string) => Promise<string>
      ) => void;
      /** Register a handler for reading binary file types (e.g., images). */
      registerFileTypeVisionHandler: (
        fileTypes: string[],
        callback: (filePath: string) => Promise<Buffer>
      ) => void;
      /** Get the list of allowed file paths from config. */
      getAllowedFilePaths: () => Promise<string[]>;
      /** Get all possible file types that have handlers registered. */
      getPossibleFileTypes: () => Promise<string[]>;
      /** Get file types allowed for read-only access. */
      getAllowedFileTypesForReadOnly: () => Promise<string[]>;
      /** Get file types allowed for write access. */
      getAllowedFileTypesForWrite: () => Promise<string[]>;
    };
  }
}
```

---

## `mood`

**Plugin ID:** `mood` | **Required:** no | **Dependencies:** `rest-serve`, `web-ui`

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    mood: {
      /** Get the assistant's current mood and the reason for it. */
      getMood: () => Promise<{ mood: string; reason: string }>;
    };
  }
}
```

---

## `brave-search-api`

**Plugin ID:** `brave-search-api` | **Required:** no | **Dependencies:** none

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'brave-search-api': {
      /** Get the Brave Search API client, or null if no API key is configured. */
      getBraveSearchApiClient: () => BraveSearch | null;
    };
  }
}
```

---

## Reserved Capability Slots

The following plugins declare empty capability types for future use. They do not currently call `offer()`:

### `deep-dive`

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'deep-dive': Record<string, never>;
  }
}
```

### `test-agents`

```typescript
declare module '@/lib.js' {
  export interface PluginCapabilities {
    'test-agents': Record<string, never>;
  }
}
```

---

## Plugins Without Offered APIs

The following system and community plugins do **not** offer any API to other plugins:

| Plugin ID                         | Registers                                                                  |
| --------------------------------- | -------------------------------------------------------------------------- |
| `datetime`                        | Footer system prompt                                                       |
| `system-info`                     | Header system prompt                                                       |
| `personality`                     | Header system prompt, fallback personality provider                        |
| `scratch-files`                   | Tools, header system prompt                                                |
| `notifications-console`           | Notification sink (via `request('notifications-broker')`)                  |
| `notifications-chat-segue`        | Tool, header system prompt, notification sink                              |
| `notifications-chat-interruption` | Notification sink (via `request('notifications-broker')`)                  |
| `notifications-chat-initiate`     | Notification sink (via `request('notifications-broker')`)                  |
| `voice`                           | Tool, Express routes                                                       |
| `static-location`                 | Location provider (via `request('location-broker')`)                       |
| `troubleshooting`                 | Tool, footer system prompt                                                 |
| `application`                     | Tool                                                                       |
| `remind-me`                       | Tools (via `request('reminders-broker')`)                                  |
| `proficiencies`                   | Tools, header system prompt (via `request('memory')`, `request('skills')`) |
| `user-skills`                     | Skill file registration (via `request('skills')`)                          |
| `credential-clapback`             | Footer system prompt                                                       |
| `brainstorm`                      | Conversation type, task assistant, tools                                   |
| `agents`                          | Tools, conversation type wiring                                            |
