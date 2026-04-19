# Implementation Plan: google-apis Phase 2 — Email & Calendar Brokers + Providers

## Overview

Phase 2 builds the **functional layer** on top of the `google-apis` auth broker from Phase 1. It introduces two new system broker plugins and two new community provider plugins:

| Plugin            | Category  | Role                                                                                                          |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `email-broker`    | system    | Broker: standardized email API + `readEmail` / `searchEmail` / `sendEmail` tools                              |
| `calendar-broker` | system    | Broker: standardized calendar API + `getCalendarEvents` / `createCalendarEvent` / `updateCalendarEvent` tools |
| `gmail`           | community | Provider: bridges Google Gmail into `email-broker`                                                            |
| `google-calendar` | community | Provider: bridges Google Calendar into `calendar-broker`                                                      |

This follows the established `web-search-broker` / `brave-web-search` pattern exactly: **the broker owns the tools and provides a provider registration API; the provider plugins register callbacks and own zero tools.**

## Requirements Summary

### Functional Requirements

| #     | Requirement                                                                                                  | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------ | -------- |
| FR-1  | `email-broker` registers `readEmail`, `searchEmail`, and `sendEmail` LLM tools                               | Must     |
| FR-2  | `email-broker` offers `registerEmailProvider` for provider plugins to register                               | Must     |
| FR-3  | `calendar-broker` registers `getCalendarEvents`, `createCalendarEvent`, and `updateCalendarEvent` LLM tools  | Must     |
| FR-4  | `calendar-broker` offers `registerCalendarProvider` for provider plugins to register                         | Must     |
| FR-5  | `gmail` plugin registers as an email provider, translating broker calls to Gmail API v1 calls                | Must     |
| FR-6  | `google-calendar` plugin registers as a calendar provider, translating broker calls to Calendar API v3 calls | Must     |
| FR-7  | Both brokers dispatch to all registered providers and merge results                                          | Must     |
| FR-8  | `gmail` and `google-calendar` both support multi-account via `google-apis`                                   | Must     |
| FR-9  | `calendar-broker` integrates with `reminders-broker` for event notifications                                 | Should   |
| FR-10 | `calendar-broker` integrates with `location-broker` for location-aware event context                         | Should   |
| FR-11 | `email-broker` integrates with `location-broker` for location-aware email drafting                           | Should   |
| FR-12 | Existing `appointments` plugin can eventually register as a calendar provider (out of scope for this phase)  | Future   |

### Non-Functional Requirements

| #     | Requirement                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| NFR-1 | Email bodies are always marked `tainted` (untrusted external content)                                                   |
| NFR-2 | No email content is logged or stored outside of tool result passing                                                     |
| NFR-3 | Sending email requires the LLM to construct the draft, but the tool should confirm before sending in sensitive contexts |
| NFR-4 | Calendar event creation/update includes timezone handling                                                               |
| NFR-5 | Both brokers degrade gracefully: no providers = tools return "no providers" messages                                    |

## Architecture & Design

### High-Level Dependency Graph

```
credential-store (system, required)
    └── google-apis (community, optional) ── Phase 1
            ├── gmail (community, optional) ──────── Phase 2
            │       └── email-broker (system, optional) ── Phase 2
            │               ├── datetime (system, required)
            │               └── location-broker (system, required)
            │
            └── google-calendar (community, optional) ── Phase 2
                    └── calendar-broker (system, optional) ── Phase 2
                            ├── datetime (system, required)
                            ├── reminders-broker (system, required)
                            └── location-broker (system, required)
```

### Data Flow: Email

```
LLM calls readEmail / searchEmail / sendEmail
         │
         ▼
  email-broker (owns the tools)
         │
    dispatches to all providers
         │
    ┌────┴────┐
    ▼         ▼
  gmail    [future: outlook, etc.]
  plugin    plugin
    │
    ▼
  google-apis (OAuth client)
    │
    ▼
  Gmail API v1
```

### Data Flow: Calendar

```
LLM calls getCalendarEvents / createCalendarEvent / updateCalendarEvent
         │
         ▼
  calendar-broker (owns the tools)
         │
    dispatches to all providers
         │
    ┌────────────┐
    ▼            ▼
  google-   [future: appointments,
  calendar    caldav, outlook, etc.]
  plugin
    │
    ▼
  google-apis (OAuth client)
    │
    ▼
  Calendar API v3
```

### Component Breakdown

#### `email-broker` — System Broker Plugin

| Component              | Responsibility                                                              |
| ---------------------- | --------------------------------------------------------------------------- |
| `email-broker.ts`      | Plugin definition, provider registration, tool execution, result formatting |
| `email-broker.test.ts` | Unit tests                                                                  |

#### `calendar-broker` — System Broker Plugin

| Component                 | Responsibility                                                              |
| ------------------------- | --------------------------------------------------------------------------- |
| `calendar-broker.ts`      | Plugin definition, provider registration, tool execution, result formatting |
| `calendar-broker.test.ts` | Unit tests                                                                  |

#### `gmail` — Community Provider Plugin

| Component  | Responsibility                                                                    |
| ---------- | --------------------------------------------------------------------------------- |
| `gmail.ts` | Register as `email-broker` provider; translate broker calls to Gmail API v1 calls |

#### `google-calendar` — Community Provider Plugin

| Component            | Responsibility                                                                          |
| -------------------- | --------------------------------------------------------------------------------------- |
| `google-calendar.ts` | Register as `calendar-broker` provider; translate broker calls to Calendar API v3 calls |

### Data Models

#### Email Models (standardized broker types)

```typescript
/** Standardized email message shape passed between broker and providers */
export type EmailMessage = {
  id: string;
  threadId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string; // plain text body
  bodyHtml?: string; // HTML body (optional, providers Best-effort)
  date: string; // ISO 8601
  labels?: string[]; // e.g. ['INBOX', 'UNREAD', 'IMPORTANT']
  hasAttachments: boolean;
  attachmentNames?: string[];
};

/** Result shape for email operations */
export type EmailActionResult = {
  provider: string; // provider name that handled the operation
  success: boolean;
  message: string; // human-readable result
  messageId?: string; // ID of the created/modified message
};

/** Parameters for searching emails */
export type EmailSearchParams = {
  query: string; // search query (provider-specific syntax allowed)
  maxResults?: number; // default 10
  includeSpamTrash?: boolean;
};

/** Parameters for reading a specific email */
export type EmailReadParams = {
  messageId: string;
  format?: 'full' | 'metadata' | 'minimal'; // default 'full'
};

/** Parameters for sending an email */
export type EmailSendParams = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string; // if set, sends as a reply in the thread
};
```

#### Calendar Models (standardized broker types)

```typescript
/** Standardized calendar event shape */
export type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  location?: string;
  attendees?: CalendarAttendee[];
  isRecurring: boolean;
  recurrenceRule?: string; // RRULE string if recurring
  reminders?: CalendarReminder[];
  status: 'confirmed' | 'tentative' | 'cancelled';
  providerId: string; // which provider owns this event
  calendarId?: string; // calendar/subcalendar identifier
};

export type CalendarDateTime = {
  dateTime: string; // ISO 8601 datetime
  timeZone: string; // IANA timezone ID (e.g. 'America/New_York')
};

export type CalendarAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
};

export type CalendarReminder = {
  method: 'email' | 'popup';
  minutesBefore: number;
};

/** Parameters for fetching events */
export type CalendarGetEventsParams = {
  timeMin?: string; // ISO 8601, default: now
  timeMax?: string; // ISO 8601, default: now + 7 days
  calendarId?: string; // specific calendar, default: primary
  maxResults?: number; // default 25
};

/** Parameters for creating an event */
export type CalendarCreateEventParams = {
  title: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  description?: string;
  location?: string;
  attendees?: string[]; // email addresses
  reminders?: CalendarReminder[];
  calendarId?: string;
};

/** Parameters for updating an event */
export type CalendarUpdateEventParams = {
  eventId: string;
  calendarId?: string;
  title?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  description?: string;
  location?: string;
  addAttendees?: string[];
  removeAttendees?: string[];
  reminders?: CalendarReminder[];
};

/** Result shape for calendar operations */
export type CalendarActionResult = {
  provider: string;
  success: boolean;
  message: string;
  eventId?: string;
};
```

### API Contracts

#### `email-broker` Offered Capability

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'email-broker': {
      registerEmailProvider: (name: string, provider: EmailProvider) => void;

      requestEmailSearch: (
        params: EmailSearchParams
      ) => Promise<Record<string, EmailMessage[]>>;

      requestEmailRead: (
        params: EmailReadParams
      ) => Promise<Record<string, EmailMessage>>;

      requestEmailSend: (
        params: EmailSendParams
      ) => Promise<Record<string, EmailActionResult>>;
    };
  }
}
```

Where `EmailProvider` is:

```typescript
export type EmailProvider = {
  searchEmails: (params: EmailSearchParams) => Promise<EmailMessage[]>;
  readEmail: (params: EmailReadParams) => Promise<EmailMessage | null>;
  sendEmail: (params: EmailSendParams) => Promise<EmailActionResult>;
};
```

**Key design decision:** Unlike the data-only brokers (`web-search-broker`, `news-broker`) that take a simple callback function, the `email-broker` provider is an **object with multiple methods**. This is because email has three semantically distinct operations (search, read, send) that all need to go through the same provider. This mirrors the `notifications-broker` pattern where sinks register as objects with a `sendNotification` method.

#### `calendar-broker` Offered Capability

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'calendar-broker': {
      registerCalendarProvider: (
        name: string,
        provider: CalendarProvider
      ) => void;

      requestCalendarEvents: (
        params: CalendarGetEventsParams
      ) => Promise<Record<string, CalendarEvent[]>>;

      requestCalendarEventCreate: (
        params: CalendarCreateEventParams
      ) => Promise<Record<string, CalendarActionResult>>;

      requestCalendarEventUpdate: (
        params: CalendarUpdateEventParams
      ) => Promise<Record<string, CalendarActionResult>>;
    };
  }
}
```

Where `CalendarProvider` is:

```typescript
export type CalendarProvider = {
  getEvents: (params: CalendarGetEventsParams) => Promise<CalendarEvent[]>;
  createEvent: (
    params: CalendarCreateEventParams
  ) => Promise<CalendarActionResult>;
  updateEvent: (
    params: CalendarUpdateEventParams
  ) => Promise<CalendarActionResult>;
};
```

### LLM Tools Registered by Brokers

#### `email-broker` Tools

**`readEmail`**

```typescript
const ReadEmailToolParameters = Type.Object({
  messageId: Type.String({
    description: 'The ID of the email message to read.',
  }),
});
```

| Field                   | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `name`                  | `readEmail`                                                        |
| `availableFor`          | `['chat', 'voice', 'autonomy']`                                    |
| `taintStatus`           | `'tainted'`                                                        |
| `systemPromptFragment`  | Explains email reading capability and when to use it               |
| `toolResultPromptOutro` | Reminder about handling personal info carefully                    |
| `execute`               | Dispatches to all providers via `requestEmailRead`, merges results |

**`searchEmail`**

```typescript
const SearchEmailToolParameters = Type.Object({
  query: Type.String({
    description:
      'Search query for finding emails. Supports provider-specific search syntax.',
  }),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of results to return. Default: 10.',
      default: 10,
    })
  ),
});
```

| Field                  | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| `name`                 | `searchEmail`                                                        |
| `availableFor`         | `['chat', 'voice', 'autonomy']`                                      |
| `taintStatus`          | `'tainted'`                                                          |
| `systemPromptFragment` | Explains email search capability                                     |
| `execute`              | Dispatches to all providers via `requestEmailSearch`, merges results |

**`sendEmail`**

```typescript
const SendEmailToolParameters = Type.Object({
  to: Type.Array(Type.String(), {
    description: 'Email addresses of the recipients.',
  }),
  subject: Type.String({
    description: 'Subject line of the email.',
  }),
  body: Type.String({
    description: 'Plain text body of the email.',
  }),
  cc: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Email addresses to CC.',
    })
  ),
  replyToMessageId: Type.Optional(
    Type.String({
      description:
        'If set, sends this email as a reply to the specified message.',
    })
  ),
});
```

| Field                   | Value                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `name`                  | `sendEmail`                                                                             |
| `availableFor`          | `['chat', 'voice', 'autonomy']`                                                         |
| `taintStatus`           | `'tainted'`                                                                             |
| `systemPromptFragment`  | **Strong warning**: only send when user explicitly asks, always confirm with user first |
| `toolResultPromptOutro` | Confirmation reminder with provider name                                                |

**`sendEmail` safety constraint:** The `systemPromptFragment` must instruct the LLM to:

1. Never send emails without explicit user confirmation
2. Show the full draft (to, subject, body) before sending
3. Only send when the user requests it, not as a convenience action

#### `calendar-broker` Tools

**`getCalendarEvents`**

```typescript
const GetCalendarEventsToolParameters = Type.Object({
  timeMin: Type.Optional(
    Type.String({
      description: 'Start of time range (ISO 8601). Default: now.',
    })
  ),
  timeMax: Type.Optional(
    Type.String({
      description: 'End of time range (ISO 8601). Default: 7 days from now.',
    })
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of events to return. Default: 25.',
      default: 25,
    })
  ),
});
```

| Field                  | Value                             |
| ---------------------- | --------------------------------- |
| `name`                 | `getCalendarEvents`               |
| `availableFor`         | `['chat', 'voice', 'autonomy']`   |
| `taintStatus`          | `'tainted'`                       |
| `systemPromptFragment` | Explains calendar event retrieval |

**`createCalendarEvent`**

```typescript
const CreateCalendarEventToolParameters = Type.Object({
  title: Type.String({ description: 'Title/summary of the event.' }),
  startDateTime: Type.String({
    description: 'Start date and time in ISO 8601 format.',
  }),
  startTimeZone: Type.String({
    description:
      'IANA timezone ID for the start time (e.g. "America/New_York").',
  }),
  endDateTime: Type.String({
    description: 'End date and time in ISO 8601 format.',
  }),
  endTimeZone: Type.String({
    description: 'IANA timezone ID for the end time.',
  }),
  description: Type.Optional(
    Type.String({
      description: 'Description or notes for the event.',
    })
  ),
  location: Type.Optional(
    Type.String({
      description:
        'Location of the event (physical address or video call URL).',
    })
  ),
  attendees: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Email addresses of attendees to invite.',
    })
  ),
});
```

| Field                  | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| `name`                 | `createCalendarEvent`                                                     |
| `availableFor`         | `['chat', 'voice', 'autonomy']`                                           |
| `taintStatus`          | `'tainted'`                                                               |
| `systemPromptFragment` | Confirm with user before creating events, especially when inviting others |

**`updateCalendarEvent`**

```typescript
const UpdateCalendarEventToolParameters = Type.Object({
  eventId: Type.String({ description: 'ID of the event to update.' }),
  title: Type.Optional(Type.String({ description: 'New title.' })),
  startDateTime: Type.Optional(
    Type.String({ description: 'New start time (ISO 8601).' })
  ),
  startTimeZone: Type.Optional(
    Type.String({ description: 'New start timezone.' })
  ),
  endDateTime: Type.Optional(
    Type.String({ description: 'New end time (ISO 8601).' })
  ),
  endTimeZone: Type.Optional(Type.String({ description: 'New end timezone.' })),
  description: Type.Optional(Type.String({ description: 'New description.' })),
  location: Type.Optional(Type.String({ description: 'New location.' })),
  addAttendees: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Email addresses to add as attendees.',
    })
  ),
  removeAttendees: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Email addresses to remove from attendees.',
    })
  ),
});
```

| Field                  | Value                                     |
| ---------------------- | ----------------------------------------- |
| `name`                 | `updateCalendarEvent`                     |
| `availableFor`         | `['chat', 'voice', 'autonomy']`           |
| `taintStatus`          | `'tainted'`                               |
| `systemPromptFragment` | Confirm with user before modifying events |

### Calendar-Broker + Reminders-Broker Integration

When a `calendar-broker` consumer plugin creates an event with reminders, the broker itself does **not** handle notification dispatch. Instead, each provider is responsible for configuring reminders on the remote calendar service (e.g., Google Calendar has its own reminder/notification system). This avoids duplicating the `reminders-broker` logic for remote calendars.

However, for **local-first** calendar providers (like the existing `appointments` plugin in the future), the provider should register reminders with `reminders-broker` so notifications are dispatched through the standard sink pipeline.

The `calendar-broker` itself declares a soft dependency on `reminders-broker` to ensure the polling infrastructure is available, but does not directly call `createNewReminder`.

### Multi-Account Dispatch

Both `gmail` and `google-calendar` support multi-account via `google-apis`. The broker dispatch functions accept no account parameter — they call **all providers** (matching `web-search-broker` pattern). Each Google account is registered as a **separate provider** with a distinct name:

```
For google-apis accounts: ["personal", "work"]

gmail registers:
  registerEmailProvider('gmail:personal', personalProvider)
  registerEmailProvider('gmail:work', workProvider)

google-calendar registers:
  registerCalendarProvider('google-calendar:personal', personalProvider)
  registerCalendarProvider('google-calendar:work', workProvider)
```

The broker tool results are keyed by provider name, so the LLM sees results from each account separately and can distinguish them.

## New Package Dependencies

No new npm packages are required. Both `gmail` and `google-calendar` use the `@googleapis/gmail`, `@googleapis/calendar`, and `google-auth-library` packages installed in Phase 1.

## Project Structure

```
src/plugins/system/email-broker/
  ├── email-broker.ts              # Broker plugin + tools
  ├── email-broker.test.ts         # Unit tests
  └── email-types.ts               # Shared email types (EmailMessage, EmailProvider, etc.)

src/plugins/system/calendar-broker/
  ├── calendar-broker.ts           # Broker plugin + tools
  ├── calendar-broker.test.ts      # Unit tests
  └── calendar-types.ts            # Shared calendar types (CalendarEvent, CalendarProvider, etc.)

src/plugins/community/gmail/
  └── gmail.ts                     # Provider plugin

src/plugins/community/google-calendar/
  └── google-calendar.ts           # Provider plugin
```

Why separate `*-types.ts` files? The broker types (`EmailMessage`, `EmailProvider`, `CalendarEvent`, `CalendarProvider`, etc.) are needed by both the broker and the provider plugins. Placing them in a separate file that the broker exports allows providers to import them without circular dependencies. This is the same pattern used by `location-broker` which exports `LocationData` from its main file, but extracted here for cleaner separation since the type surface is larger.

## Implementation Steps

### Step 1: Create `email-types.ts` — Shared Email Type Definitions ✅

**Description:** Define all standardized email types that both `email-broker` and provider plugins will use. This file is the contract between broker and providers.

Types to define (see Data Models section above):

- `EmailMessage` — standardized email representation
- `EmailActionResult` — result of send/delete operations
- `EmailSearchParams` — search query parameters
- `EmailReadParams` — read-by-ID parameters
- `EmailSendParams` — send/draft parameters
- `EmailProvider` — the interface provider plugins implement

**Files to create:**

- `src/plugins/system/email-broker/email-types.ts`

**Dependencies:** None

**Estimated complexity:** Low

---

### Step 2: Create `email-broker.ts` — Email Broker Plugin ✅

**Description:** The system broker that owns the email tools and provides the provider registration API. Follow the `web-search-broker` pattern closely.

Key structure:

1. Import email types from `email-types.ts`
2. Declare `PluginCapabilities` augmentation for `'email-broker'`
3. Define TypeBox config schema with optional `defaultAccount` field (for future use)
4. In `registerPlugin()`:
   - Maintain `Record<string, EmailProvider>` for provider registry
   - Implement `registerEmailProvider`, `requestEmailSearch`, `requestEmailRead`, `requestEmailSend` dispatch functions
   - Register three tools: `searchEmail`, `readEmail`, `sendEmail`
   - Request `location-broker` for location context in email drafts (optional, soft dependency)

**Dispatch behavior:**

- `requestEmailSearch`: Call all providers' `searchEmails()` in parallel, merge results into `Record<string, EmailMessage[]>`
- `requestEmailRead`: Call all providers' `readEmail()` in parallel. If multiple providers return a message for the same ID, use the first non-null result (this shouldn't normally happen — message IDs are provider-scoped)
- `requestEmailSend`: Call all providers' `sendEmail()` in parallel. This seems wrong — you don't want to send the same email from every account. The solution: **for `sendEmail`, the broker calls ALL providers but each provider is responsible for knowing which account should send.** This is achieved by having the provider name embedded in the tool result, and the LLM choosing the right one.

**Actually, `sendEmail` needs a different dispatch model.** Email sending is not a "broadcast to all providers" operation like search. The broker should:

- For `searchEmail` / `readEmail`: call ALL providers (read-only, safe to merge)
- For `sendEmail`: call the provider specified by the user, or the first provider if none specified

To handle this, add an optional `provider?: string` parameter to `EmailSendParams`. If not specified, the broker sends via the first registered provider. This matches how the real world works — you choose which account to send from.

**Tool result formatting:**

- `searchEmail`: List results grouped by provider, showing subject, from, date, snippet, and labels
- `readEmail`: Full email with headers, body, attachment info
- `sendEmail`: Confirmation with provider name and message ID

**Files to create:**

- `src/plugins/system/email-broker/email-broker.ts`

**Dependencies:** Step 1 (email-types.ts)

**Estimated complexity:** High

---

### Step 3: Create `calendar-types.ts` — Shared Calendar Type Definitions ✅

**Description:** Define all standardized calendar types. Same purpose as `email-types.ts`.

Types to define (see Data Models section above):

- `CalendarEvent` — standardized event representation
- `CalendarDateTime` — timezone-aware datetime
- `CalendarAttendee` — attendee with response status
- `CalendarReminder` — reminder specification
- `CalendarActionResult` — result of create/update/delete
- `CalendarGetEventsParams` — event listing parameters
- `CalendarCreateEventParams` — event creation parameters
- `CalendarUpdateEventParams` — event modification parameters
- `CalendarProvider` — the interface provider plugins implement

**Files to create:**

- `src/plugins/system/calendar-broker/calendar-types.ts`

**Dependencies:** None

**Estimated complexity:** Low

---

### Step 4: Create `calendar-broker.ts` — Calendar Broker Plugin ✅

**Description:** The system broker that owns the calendar tools and provides the provider registration API.

Key structure:

1. Import calendar types from `calendar-types.ts`
2. Declare `PluginCapabilities` augmentation for `'calendar-broker'`
3. In `registerPlugin()`:
   - Maintain `Record<string, CalendarProvider>` for provider registry
   - Implement `registerCalendarProvider`, `requestCalendarEvents`, `requestCalendarEventCreate`, `requestCalendarEventUpdate`
   - Register three tools: `getCalendarEvents`, `createCalendarEvent`, `updateCalendarEvent`
   - Declare soft dependencies on `datetime`, `reminders-broker`, `location-broker`

**Dispatch behavior:**

- `requestCalendarEvents`: Call all providers' `getEvents()` in parallel, merge results into `Record<string, CalendarEvent[]>`. Events are read-only queries, safe to merge.
- `requestCalendarEventCreate`: Similar to `sendEmail`, this is a write operation. Add optional `provider?: string` to `CalendarCreateEventParams`. If not specified, create on the first provider. The LLM should confirm which calendar to use.
- `requestCalendarEventUpdate`: Same — add optional `provider?: string`. If not specified, the broker must determine which provider owns the event (by matching the event ID prefix or checking all providers). The simplest approach: try each provider until one succeeds, since event IDs are provider-scoped.

**Tool result formatting:**

- `getCalendarEvents`: Chronologically sorted events with time, title, location, attendees
- `createCalendarEvent`: Confirmation with event link, provider name, and reminder info
- `updateCalendarEvent`: Confirmation of changes made

**Timezone handling:** The `calendar-broker` resolves the user's timezone from `datetime` plugin if not explicitly provided. The tool parameters accept explicit timezone strings, but default to the system timezone when absent.

**Files to create:**

- `src/plugins/system/calendar-broker/calendar-broker.ts`

**Dependencies:** Step 3 (calendar-types.ts)

**Estimated complexity:** High

---

### Step 5: Create `gmail.ts` — Gmail Provider Plugin ✅

**Description:** Community plugin that bridges `google-apis` Gmail client into the `email-broker`.

Key structure:

1. Depend on `google-apis` and `email-broker`
2. Request capabilities from both plugins
3. For each authenticated Google account, register a separate `email-broker` provider named `gmail:{accountId}`
4. Each provider implements the `EmailProvider` interface:
   - `searchEmails`: Call `gmail.users.messages.list()` with query, then `gmail.users.messages.get()` for each result to build `EmailMessage` objects
   - `readEmail`: Call `gmail.users.messages.get()` by ID, parse headers and body
   - `sendEmail`: Construct MIME message (RFC 2822), base64-encode, call `gmail.users.messages.send()`

**Gmail API mapping:**

| Broker operation | Gmail API call                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchEmails`   | `gmail.users.messages.list({ userId: 'me', q: query, maxResults })` + batch `messages.get()`                                                          |
| `readEmail`      | `gmail.users.messages.get({ userId: 'me', id: messageId, format })`                                                                                   |
| `sendEmail`      | `gmail.users.messages.send({ userId: 'me', requestBody: { raw: base64MimeMessage } })`                                                                |
| (reply)          | If `replyToMessageId` is set, set `In-Reply-To` and `References` headers in the MIME message, plus `gmail.users.messages.insert()` with the thread ID |

**MIME message construction:** The Gmail API requires raw MIME messages base64url-encoded. We need a utility to construct:

```
From: me
To: recipient@example.com
Subject: Hello
Content-Type: text/plain; charset="UTF-8"

Body text here
```

This can be built inline without an external MIME library since we're only constructing simple text messages. For replies, we include the necessary `In-Reply-To` and `References` headers.

**Gmail header parsing:** Gmail returns headers as an array of `{ name, value }` pairs. We need a utility to extract `From`, `To`, `Cc`, `Subject`, `Date` from this array.

**Gmail body decoding:** Gmail returns body parts as base64url-encoded data in the `payload` field. We need a recursive function to walk `payload.parts` and extract the text/plain and text/html parts.

**Error handling:** All Gmail API errors should be caught and returned as `EmailActionResult` with `success: false` and a descriptive message. The provider should never throw into the broker.

**Plugin metadata:**

```typescript
pluginMetadata: {
  id: 'gmail',
  name: 'Gmail Plugin',
  brandColor: '#EA4335',  // Gmail Red
  description:
    'Provides Gmail email functionality through the email-broker plugin. ' +
    'Requires the google-apis plugin with an authenticated Google account.',
  version: 'LATEST',
  dependencies: [
    { id: 'google-apis', version: 'LATEST' },
    { id: 'email-broker', version: 'LATEST' },
  ],
  required: false,
}
```

**Files to create:**

- `src/plugins/community/gmail/gmail.ts`

**Dependencies:** Steps 2, 4 (brokers must exist), Phase 1 (google-apis must be complete)

**Estimated complexity:** High (Gmail API quirks with MIME encoding, body parsing, header extraction)

---

### Step 6: Create `google-calendar.ts` — Google Calendar Provider Plugin ✅

**Description:** Community plugin that bridges `google-apis` Calendar client into `calendar-broker`.

Key structure:

1. Depend on `google-apis` and `calendar-broker`
2. Request capabilities from both plugins
3. For each authenticated Google account, register a separate `calendar-broker` provider named `google-calendar:{accountId}`
4. Each provider implements the `CalendarProvider` interface:
   - `getEvents`: Call `calendar.events.list()` with time range
   - `createEvent`: Call `calendar.events.insert()` with event details
   - `updateEvent`: Call `calendar.events.patch()` with updated fields

**Calendar API mapping:**

| Broker operation | Calendar API v3 call                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `getEvents`      | `calendar.events.list({ calendarId, timeMin, timeMax, maxResults, singleEvents: true })` |
| `createEvent`    | `calendar.events.insert({ calendarId, requestBody: eventResource })`                     |
| `updateEvent`    | `calendar.events.patch({ calendarId, eventId, requestBody: partialUpdate })`             |

**Google Calendar → `CalendarEvent` mapping:**

| Google field                        | CalendarEvent field              | Notes                                                            |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `id`                                | `id`                             | Direct map                                                       |
| `summary`                           | `title`                          | Rename                                                           |
| `description`                       | `description`                    | Direct map                                                       |
| `start.dateTime` + `start.timeZone` | `start`                          | Combine into `CalendarDateTime`                                  |
| `end.dateTime` + `end.timeZone`     | `end`                            | Combine into `CalendarDateTime`                                  |
| `location`                          | `location`                       | Direct map                                                       |
| `attendees[]`                       | `attendees[]`                    | Map `{ email, displayName, responseStatus }`                     |
| `recurrence[]`                      | `isRecurring` + `recurrenceRule` | `isRecurring = !!recurrence`, `recurrenceRule = recurrence[0]`   |
| `reminders.overrides[]`             | `reminders[]`                    | Map `{ method, minutes }` → `{ method, minutesBefore: minutes }` |
| `status`                            | `status`                         | Direct map                                                       |

**Important:** `singleEvents: true` in the list call makes Google expand recurring events into individual instances. This is what users expect when asking "what's on my calendar today."

**`createEvent` details:**

- Convert `CalendarCreateEventParams` to Google's `event` resource format
- Set `reminders.useDefault = false` if custom reminders are provided, otherwise `true`
- If attendees are provided, Google sends invitations automatically

**`updateEvent` details:**

- Use `patch` (not `update`) to send only changed fields
- Handle attendee adds/removes: Google requires the full `attendees` array in update calls (you can't just add/remove — you must send the modified full list)

**Error handling:** All Calendar API errors caught and returned as `CalendarActionResult` with descriptive messages.

**Plugin metadata:**

```typescript
pluginMetadata: {
  id: 'google-calendar',
  name: 'Google Calendar Plugin',
  brandColor: '#4285F4',  // Google Blue (same as google-apis)
  description:
    'Provides Google Calendar functionality through the calendar-broker plugin. ' +
    'Requires the google-apis plugin with an authenticated Google account.',
  version: 'LATEST',
  dependencies: [
    { id: 'google-apis', version: 'LATEST' },
    { id: 'calendar-broker', version: 'LATEST' },
  ],
  required: false,
}
```

**Files to create:**

- `src/plugins/community/google-calendar/google-calendar.ts`

**Dependencies:** Steps 4 (calendar-broker must exist), Phase 1 (google-apis must be complete)

**Estimated complexity:** Medium-High (Calendar API is cleaner than Gmail, but timezone and attendee handling requires care)

---

### Step 7: Register All Plugins in `system-plugins.json` and `enabled-plugins.json` ✅

**Description:** Add the four new plugins to the built-in registry and default config.

Add to `src/plugins/system-plugins.json`:

```json
{
  "id": "email-broker",
  "name": "Email Broker",
  "category": "system",
  "required": false
},
{
  "id": "calendar-broker",
  "name": "Calendar Broker",
  "category": "system",
  "required": false
},
{
  "id": "gmail",
  "name": "Gmail",
  "category": "community",
  "required": false
},
{
  "id": "google-calendar",
  "name": "Google Calendar",
  "category": "community",
  "required": false
}
```

Add to `config-default/plugin-settings/enabled-plugins.json`:

```json
"email-broker": false,
"calendar-broker": false,
"gmail": false,
"google-calendar": false
```

All four are **disabled by default** — they require `google-apis` + OAuth setup to be useful.

**Files to modify:**

- `src/plugins/system-plugins.json`
- `config-default/plugin-settings/enabled-plugins.json`

**Dependencies:** Steps 2, 4, 5, 6

**Estimated complexity:** Low

---

### Step 8: Create Plugin Config Scaffolds ✅

**Description:** Add default config files for the new plugins.

`config-default/plugin-settings/email-broker/email-broker.json`:

```json
{
  "defaultProvider": ""
}
```

`config-default/plugin-settings/calendar-broker/calendar-broker.json`:

```json
{
  "defaultProvider": "",
  "defaultTimeZone": ""
}
```

`config-default/plugin-settings/gmail/gmail.json`:

```json
{
  "preferredAccount": "",
  "maxResultsPerSearch": 10,
  "defaultSendAccount": ""
}
```

`config-default/plugin-settings/google-calendar/google-calendar.json`:

```json
{
  "preferredAccount": "",
  "defaultCalendarId": "primary",
  "maxResultsPerQuery": 25
}
```

**Files to create:**

- `config-default/plugin-settings/email-broker/email-broker.json`
- `config-default/plugin-settings/calendar-broker/calendar-broker.json`
- `config-default/plugin-settings/gmail/gmail.json`
- `config-default/plugin-settings/google-calendar/google-calendar.json`

**Dependencies:** Step 7

**Estimated complexity:** Low

---

### Step 9: Write Unit Tests ✅

**Description:** Co-located test files for all new modules.

**`email-broker.test.ts`** — Tests for:

- Provider registration: `registerEmailProvider` stores providers correctly
- Search dispatch: `requestEmailSearch` calls all providers, merges results
- Read dispatch: `requestEmailRead` calls providers, returns first result
- Send dispatch: `requestEmailSend` routes to correct provider
- Tool execution: `searchEmail`, `readEmail`, `sendEmail` format results correctly
- Empty providers: tools return "no providers" message
- Graceful degradation: provider returning empty array doesn't break other providers

**`calendar-broker.test.ts`** — Tests for:

- Provider registration: `registerCalendarProvider` stores providers correctly
- Events dispatch: `requestCalendarEvents` calls all providers, merges results
- Create dispatch: `requestCalendarEventCreate` routes to correct provider
- Update dispatch: `requestCalendarEventUpdate` routes to correct provider
- Tool execution: `getCalendarEvents`, `createCalendarEvent`, `updateCalendarEvent` format results
- Empty providers: tools return "no providers" message
- Timezone handling: default timezone resolution

**`gmail.test.ts`** — Tests for:

- Gmail header parsing utility
- Gmail body decoding utility (text/plain and text/html extraction)
- MIME message construction utility
- Provider registration with multiple accounts
- Graceful degradation when `google-apis` has no accounts

**`google-calendar.test.ts`** — Tests for:

- Google Calendar event to `CalendarEvent` mapping
- `CalendarCreateEventParams` to Google event resource mapping
- Provider registration with multiple accounts
- Graceful degradation when no accounts

Use `vi.mock()` at the top level for all external dependencies.

**Files to create:**

- `src/plugins/system/email-broker/email-broker.test.ts`
- `src/plugins/system/calendar-broker/calendar-broker.test.ts`
- `src/plugins/community/gmail/gmail.test.ts`
- `src/plugins/community/google-calendar/google-calendar.test.ts`

**Dependencies:** Steps 2, 4, 5, 6

**Estimated complexity:** Medium

---

### Step 10: Verify Build, Lint, and Tests ✅

**Description:** Run the full CI pipeline.

```bash
npm run build
npm run lint
npm test
```

Particular attention to:

- ESM import paths with `.js` extensions
- Type exports from `email-types.ts` and `calendar-types.ts` are reachable by provider plugins
- TypeBox schemas align with TypeScript types in the `execute` functions
- No `any` in production code
- `PluginCapabilities` augmentations don't conflict

**Dependencies:** All previous steps

**Estimated complexity:** Low-Medium

## File Changes Summary

| File                                                                  | Action | Description                                                              |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `src/plugins/system/email-broker/email-types.ts`                      | Create | Shared email type definitions (EmailMessage, EmailProvider, etc.)        |
| `src/plugins/system/email-broker/email-broker.ts`                     | Create | Email broker plugin + 3 LLM tools                                        |
| `src/plugins/system/email-broker/email-broker.test.ts`                | Create | Unit tests                                                               |
| `src/plugins/system/calendar-broker/calendar-types.ts`                | Create | Shared calendar type definitions (CalendarEvent, CalendarProvider, etc.) |
| `src/plugins/system/calendar-broker/calendar-broker.ts`               | Create | Calendar broker plugin + 3 LLM tools                                     |
| `src/plugins/system/calendar-broker/calendar-broker.test.ts`          | Create | Unit tests                                                               |
| `src/plugins/community/gmail/gmail.ts`                                | Create | Gmail provider plugin                                                    |
| `src/plugins/community/gmail/gmail.test.ts`                           | Create | Unit tests                                                               |
| `src/plugins/community/google-calendar/google-calendar.ts`            | Create | Google Calendar provider plugin                                          |
| `src/plugins/community/google-calendar/google-calendar.test.ts`       | Create | Unit tests                                                               |
| `src/plugins/system-plugins.json`                                     | Modify | Add 4 plugin entries                                                     |
| `config-default/plugin-settings/enabled-plugins.json`                 | Modify | Add 4 entries (all `false`)                                              |
| `config-default/plugin-settings/email-broker/email-broker.json`       | Create | Default config                                                           |
| `config-default/plugin-settings/calendar-broker/calendar-broker.json` | Create | Default config                                                           |
| `config-default/plugin-settings/gmail/gmail.json`                     | Create | Default config                                                           |
| `config-default/plugin-settings/google-calendar/google-calendar.json` | Create | Default config                                                           |

## Testing Strategy

### Unit Tests

| Module            | Key Test Cases                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email-broker`    | Provider registration, dispatch to all providers for search/read, single-provider dispatch for send, empty providers graceful degradation, tool result formatting          |
| `calendar-broker` | Provider registration, dispatch to all providers for get, single-provider for create, multi-provider try for update, timezone defaults, tool result formatting             |
| `gmail`           | Gmail header parsing, body decoding (multipart, base64url), MIME construction, multi-account registration, no-account graceful exit                                        |
| `google-calendar` | Event mapping (Google → CalendarEvent), create mapping (CalendarCreateEventParams → Google resource), update mapping, multi-account registration, no-account graceful exit |

### Integration Tests (Manual)

1. **Email search**: Enable `google-apis` + `email-broker` + `gmail`, authenticate Google account, ask assistant "search my email for [subject]"
2. **Email read**: From search results, ask "read the email from [sender]"
3. **Email send**: Ask "send an email to test@example.com saying hello", verify draft is shown, confirm send, check Gmail outbox
4. **Calendar events**: Enable `google-apis` + `calendar-broker` + `google-calendar`, ask "what's on my calendar this week"
5. **Calendar create**: Ask "schedule a meeting tomorrow at 2pm for 1 hour", confirm creation, verify in Google Calendar
6. **Calendar update**: Ask "move my 2pm meeting to 3pm", confirm update
7. **Multi-account emails**: With two accounts, search should return results from both, labeled by provider (`gmail:personal`, `gmail:work`)
8. **Multi-account calendar**: With two accounts, events from both calendars should appear in `getCalendarEvents` results

### Manual Testing Steps

1. `npm run build && npm start`
2. Enable `google-apis`, `gmail`, `google-calendar`, `email-broker`, `calendar-broker` in settings
3. Restart assistant
4. Authenticate at least one Google account via `/google-apis`
5. Test email: "search my inbox for messages from alice"
6. Test email read: "read the most recent email"
7. Test email send: "send an email to bob@example.com with the subject 'Test from ALICE' and body 'Hello world'"
8. Test calendar: "what's on my calendar today?"
9. Test calendar create: "create a meeting called 'ALICE Test' tomorrow at 3pm for 30 minutes"
10. Test calendar update: "move the ALICE Test meeting to 4pm"
11. Verify all results show provider names and correctly formatted content

## Definition of Done

- [x] `npm run build` completes with zero errors
- [x] `npm run lint` completes with zero errors
- [x] `npm test` passes with all new test cases
- [x] `email-broker` plugin registers and offers `'email-broker'` capability
- [x] `calendar-broker` plugin registers and offers `'calendar-broker'` capability
- [x] `gmail` plugin registers as an `email-broker` provider for each authenticated Google account
- [x] `google-calendar` plugin registers as a `calendar-broker` provider for each authenticated Google account
- [x] `searchEmail` tool returns results from all registered email providers
- [x] `readEmail` tool returns full email content from the correct provider
- [x] `sendEmail` tool sends from the specified provider (or default) and returns confirmation
- [x] `getCalendarEvents` tool returns events from all providers, chronologically sorted
- [x] `createCalendarEvent` tool creates an event on the specified provider
- [x] `updateCalendarEvent` tool updates an event on the correct provider
- [x] All four plugins are disabled by default in `enabled-plugins.json`
- [x] All four plugins appear in `system-plugins.json`
- [x] Email bodies are marked as `tainted` in all tool results
- [x] `sendEmail` systemPromptFragment includes user-confirmation instruction
- [x] `createCalendarEvent` systemPromptFragment includes user-confirmation instruction
- [x] No secrets or email bodies appear in log output
- [x] Multi-account provider naming convention works (`gmail:personal`, `google-calendar:work`, etc.)
- [x] Graceful degradation when no providers are registered (tools return informative message)
- [x] Graceful degradation when `google-apis` has no authenticated accounts (`gmail` and `google-calendar` skip registration with warning)

## Risks & Mitigations

| Risk                                                                                                       | Impact                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gmail API MIME encoding is error-prone                                                                     | High — emails may send with broken formatting                                           | Build a dedicated `buildMimeMessage()` utility with thorough test coverage. Test with special characters, long subjects, non-ASCII content. Consider adding `mailparser` or `emailjs-mime-builder` if inline construction proves unreliable.                                                                                                     |
| Gmail API base64url encoding differs from standard base64                                                  | Medium — Gmail API requires URL-safe base64 (no `+`, `/`, `=` padding)                  | Use `Buffer.from(str).toString('base64url')` (Node.js built-in since v15). Test round-trip encoding.                                                                                                                                                                                                                                             |
| Gmail body parsing (multipart MIME) is complex                                                             | Medium — some emails have deeply nested parts, alternative representations, attachments | Implement recursive `walkParts` utility. Start with `text/plain` only — `text/html` can be a future enhancement. Handle edge cases: no body, multiple text parts, base64-encoded parts.                                                                                                                                                          |
| `sendEmail` could be abused by the LLM (auto-sending emails without user intent)                           | High — privacy and safety risk                                                          | Strong `systemPromptFragment` instructions. Consider adding a `confirmRequired: true` flag on the tool that requires explicit user approval before the broker executes the send. This is an enhancement beyond the current tool system — document as future work.                                                                                |
| Calendar API timezone handling is subtle                                                                   | Medium — events created with wrong timezone, or displayed at wrong times                | Default to the system timezone (from `datetime` plugin). Require explicit timezone in tool params. Test with different timezones. Use IANA timezone IDs (not offset-based) throughout.                                                                                                                                                           |
| Google Calendar API attendee handling in updates                                                           | Medium — PATCH requires full attendee array; can't just add/remove one                  | On update, fetch the current event first, modify the attendees array, then PATCH with the new full array. This requires an extra API call but is the only correct approach.                                                                                                                                                                      |
| Google API rate limits (especially Gmail)                                                                  | Medium — aggressive searching could hit Gmail API limits                                | Add `maxResults` defaults (10 for email, 25 for calendar). Implement basic rate-limit awareness (log 429 responses, return user-friendly error). Consider request caching for repeated searches.                                                                                                                                                 |
| `email-broker` and `calendar-broker` are disabled by default — users may not know to enable the full chain | Low — broken experience if only some plugins are enabled                                | The system should log clear dependency warnings. `gmail` depends on both `google-apis` and `email-broker` — the plugin engine enforces dependency resolution, so if `email-broker` is missing as a dependency, the plugin won't load at all. But if it's just disabled, the user gets no error. Consider adding a startup suggestion in the log. |
| `appointments` plugin (stub) may conflict with `calendar-broker` conceptually                              | Low — user confusion about which to use                                                 | Future work: refactor `appointments` to register as a `calendar-broker` provider (local-only events). The broker architecture explicitly supports this — `appointments` would implement `CalendarProvider` with local storage instead of Google.                                                                                                 |

## Timeline Estimate

| Step                       | Estimate       | Notes                                                  |
| -------------------------- | -------------- | ------------------------------------------------------ |
| Step 1: email-types.ts     | 1 hr           | Type definitions only                                  |
| Step 2: email-broker.ts    | 3-4 hrs        | Broker logic + 3 tools + dispatch models               |
| Step 3: calendar-types.ts  | 1 hr           | Type definitions only                                  |
| Step 4: calendar-broker.ts | 3-4 hrs        | Broker logic + 3 tools + timezone handling             |
| Step 5: gmail.ts           | 4-5 hrs        | Gmail API quirks: MIME, base64url, header/body parsing |
| Step 6: google-calendar.ts | 3-4 hrs        | Calendar API mapping, attendee handling, timezone      |
| Step 7: Plugin registry    | 30 min         | JSON edits                                             |
| Step 8: Config scaffold    | 30 min         | JSON stubs                                             |
| Step 9: Unit tests         | 4-5 hrs        | Comprehensive test coverage for all modules            |
| Step 10: Build/lint/fix    | 1-2 hrs        | Integration verification                               |
| **Total**                  | **~22-28 hrs** | Assumes Phase 1 is complete and working                |

Assumptions:

- Phase 1 (`google-apis` + `google-location`) is fully complete and passing tests
- `@googleapis/gmail` and `@googleapis/calendar` packages work as documented
- Developer has a Google Cloud project with Gmail and Calendar API access for manual testing
- No changes to the existing plugin engine's `Tool` type or `PluginCapabilities` system are needed
