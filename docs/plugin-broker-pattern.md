# Broker Pattern

Several A.L.I.C.E. plugins use a "broker" pattern to decouple data providers from data consumers. This document explains the pattern and shows how to create a new broker plugin.

---

## Pattern Overview

A broker plugin:

1. **Offers an API** with two kinds of methods:
   - `register*Provider(name, callback)` — Allows provider plugins to register data sources
   - `request*Data(...)` — Allows consumer plugins to request data from all registered providers
2. **Optionally** offers a `getPreferredProviderId()` method for selecting among multiple providers
3. **May register tools** that use the broker's collected data to serve the LLM

The broker acts as a middleman — it doesn't know how to fetch data itself, but it knows how to collect data from providers and distribute it to consumers.

```
Provider Plugin A ──registerProvider──► Broker ◄──requestData──── Consumer Plugin X
Provider Plugin B ──registerProvider──► Broker ◄──requestData──── Consumer Plugin Y
```

---

## Existing Brokers

| Broker                 | Provider Method             | Data Method            | Provider Callback                                  | Data Return Type                    |
| ---------------------- | --------------------------- | ---------------------- | -------------------------------------------------- | ----------------------------------- |
| `location-broker`      | `registerLocationProvider`  | `requestLocationData`  | `() => Promise<LocationData>`                      | `LocationData`                      |
| `weather-broker`       | `registerWeatherProvider`   | `requestWeatherData`   | `(location: LocationData) => Promise<WeatherData>` | `Record<string, WeatherData>`       |
| `web-search-broker`    | `registerWebSearchProvider` | `requestWebSearchData` | `(query: string) => Promise<WebSearchResult[]>`    | `Record<string, WebSearchResult[]>` |
| `news-broker`          | `registerNewsProvider`      | `requestNewsData`      | `(query: string) => Promise<NewsItem[]>`           | `Record<string, NewsItem[]>`        |
| `notifications-broker` | `registerNotificationSink`  | `sendNotification`     | N/A (sink pattern)                                 | N/A                                 |

---

## How to Create a Broker

### Step 1: Define the Types

```typescript
// my-broker-types.ts
export type MyData = {
  value: string;
  timestamp: Date;
};
```

### Step 2: Declare the Plugin Capabilities

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'my-broker': {
      registerMyProvider: (
        name: string,
        callback: () => Promise<MyData>
      ) => void;
      requestMyData: () => Promise<Record<string, MyData> | undefined>;
    };
  }
}
```

### Step 3: Implement the Broker

```typescript
import { AlicePlugin } from '../../../lib.js';

const providerCallbacks: Record<string, () => Promise<MyData>> = {};

const myBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-broker',
    name: 'My Broker',
    version: '1.0.0',
    description: 'Brokers my-data from providers to consumers.',
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.offer<'my-broker'>({
      registerMyProvider: (name, callback) => {
        if (providerCallbacks[name]) {
          throw new Error(
            `my-broker: Provider "${name}" is already registered. ` +
              `Disable one of the conflicting plugins to fix this.`
          );
        }
        providerCallbacks[name] = callback;
      },
      requestMyData: async () => {
        if (Object.keys(providerCallbacks).length === 0) {
          return undefined;
        }
        const results: Record<string, MyData> = {};
        await Promise.all(
          Object.entries(providerCallbacks).map(async ([name, callback]) => {
            results[name] = await callback();
          })
        );
        return results;
      },
    });
  },
};

export default myBrokerPlugin;
```

### Step 4: Provider Plugin

```typescript
// A plugin that provides data to the broker
const myBroker = plugin.request('my-broker');
if (myBroker) {
  myBroker.registerMyProvider('my-provider', async () => {
    return { value: 'Hello from my provider', timestamp: new Date() };
  });
}
```

### Step 5: Consumer Plugin

```typescript
// A plugin that consumes data from the broker
const myBroker = plugin.request('my-broker');
if (myBroker) {
  const data = await myBroker.requestMyData();
  if (data) {
    // data is Record<string, MyData>, keyed by provider name
    for (const [providerName, providerData] of Object.entries(data)) {
      console.log(`${providerName}: ${providerData.value}`);
    }
  }
}
```

---

## Broker Variations

### Single-Provider Brokers

Some brokers only allow one provider (e.g., `location-broker`). They throw if a second provider tries to register:

```typescript
registerLocationProvider: (name, callback) => {
  if (locationProvider) {
    throw new Error(
      `location-broker: Provider "${name}" cannot register because ` +
      `"${locationProviderName}" is already the location provider. ` +
      `Disable one of these plugins to fix your assistant.`
    );
  }
  locationProvider = callback;
  locationProviderName = name;
},
```

### Sink Brokers

The `notifications-broker` uses a "sink" pattern instead of a "provider" pattern — it distributes data **to** sinks rather than collecting data **from** providers:

```typescript
sendNotification: async (notification) => {
  await Promise.all(
    Object.keys(notificationSinks).map(async name => {
      await notificationSinks[name](notification);
    })
  );
},
registerNotificationSink: async (name, sink) => {
  notificationSinks[name] = sink.sendNotification;
},
```

### Preferred Provider

Some brokers offer a `getPreferredProviderId()` method for selecting among multiple providers. This is currently a stub in most brokers (returns empty string) but is reserved for future configuration-based provider selection.

---

## Registration Timing

Provider registration typically happens during the `onAllPluginsLoaded` hook, after all plugins have loaded. This ensures the broker is available before providers try to register:

```typescript
plugin.hooks.onAllPluginsLoaded(async () => {
  const myBroker = plugin.request('my-broker');
  if (myBroker) {
    myBroker.registerMyProvider('my-provider', myCallback);
  }
});
```

Some brokers close provider registration after `onAllPluginsLoaded` to prevent late registration.
