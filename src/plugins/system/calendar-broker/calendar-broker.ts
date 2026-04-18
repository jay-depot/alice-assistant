/**
 * @file calendar-broker.ts
 *
 * Calendar Broker plugin for A.L.I.C.E. Assistant.
 *
 * System broker that owns three LLM tools (getCalendarEvents,
 * createCalendarEvent, updateCalendarEvent) and provides a provider
 * registration API. Downstream provider plugins (like google-calendar)
 * register themselves with this broker to handle calendar operations.
 *
 * Follows the web-search-broker pattern: dispatch read operations to all
 * providers in parallel, dispatch write operations (create, update) to a
 * specific provider or the first registered provider.
 */

import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type {
  CalendarEvent,
  CalendarActionResult,
  CalendarDateTime,
  CalendarGetEventsParams,
  CalendarCreateEventParams,
  CalendarUpdateEventParams,
  CalendarProvider,
} from './calendar-types.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const CalendarBrokerPluginConfigSchema = Type.Object({
  /** Preferred calendar provider ID. If empty, the first registered provider is used. */
  defaultProvider: Type.Optional(
    Type.String({
      description:
        'The ID of the default calendar provider. If empty, the first registered provider is used.',
    })
  ),
  /** Default timezone for events. If empty, the system timezone is used. */
  defaultTimeZone: Type.Optional(
    Type.String({
      description:
        'IANA timezone ID for the default timezone (e.g. "America/New_York"). If empty, the system timezone is used.',
    })
  ),
});

type CalendarBrokerPluginConfig = Static<
  typeof CalendarBrokerPluginConfigSchema
>;

// ---------------------------------------------------------------------------
// LLM tool parameter schemas
// ---------------------------------------------------------------------------

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

type GetCalendarEventsToolParameters = Static<
  typeof GetCalendarEventsToolParameters
>;

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

type CreateCalendarEventToolParameters = Static<
  typeof CreateCalendarEventToolParameters
>;

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

type UpdateCalendarEventToolParameters = Static<
  typeof UpdateCalendarEventToolParameters
>;

// ---------------------------------------------------------------------------
// Plugin capabilities type augmentation
// ---------------------------------------------------------------------------

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'calendar-broker': {
      /** Register a calendar provider with the broker. */
      registerCalendarProvider: (
        name: string,
        provider: CalendarProvider
      ) => void;

      /** Get calendar events from all providers. Returns results keyed by provider name. */
      requestCalendarEvents: (
        params: CalendarGetEventsParams
      ) => Promise<Record<string, CalendarEvent[]>>;

      /** Create a calendar event via a specific provider (or default/first provider). */
      requestCalendarEventCreate: (
        params: CalendarCreateEventParams
      ) => Promise<Record<string, CalendarActionResult>>;

      /** Update a calendar event. If provider is specified, use it; otherwise try all providers. */
      requestCalendarEventUpdate: (
        params: CalendarUpdateEventParams
      ) => Promise<Record<string, CalendarActionResult>>;
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const calendarBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'calendar-broker',
    name: 'Calendar Broker Plugin',
    brandColor: '#4285f4',
    description:
      'Provides standardized calendar tools (getCalendarEvents, createCalendarEvent, ' +
      'updateCalendarEvent) and a provider registration API for calendar plugins. ' +
      'Downstream provider plugins (like google-calendar) implement the actual calendar operations.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const config = await plugin.config<CalendarBrokerPluginConfig>(
      CalendarBrokerPluginConfigSchema,
      {}
    );

    // Provider registry: name → provider implementation
    const calendarProviders: Record<string, CalendarProvider> = {};

    // -------------------------------------------------------------------------
    // Helper: resolve default timezone
    // -------------------------------------------------------------------------

    const resolveTimeZone = (tz?: string): string => {
      if (tz) return tz;
      const configTz = config.getPluginConfig().defaultTimeZone;
      if (configTz) return configTz;
      // Fallback to the system timezone
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return 'UTC';
      }
    };

    // -------------------------------------------------------------------------
    // Dispatch functions
    // -------------------------------------------------------------------------

    /**
     * Get calendar events from all registered providers in parallel.
     * Returns results keyed by provider name.
     */
    const requestCalendarEvents = async (
      params: CalendarGetEventsParams
    ): Promise<Record<string, CalendarEvent[]>> => {
      const providerNames = Object.keys(calendarProviders);
      if (providerNames.length === 0) {
        return {};
      }

      const results: Record<string, CalendarEvent[]> = {};
      await Promise.all(
        providerNames.map(async name => {
          try {
            const providerResults =
              await calendarProviders[name].getEvents(params);
            results[name] = providerResults;
          } catch (err) {
            plugin.logger.error(
              `requestCalendarEvents: Provider "${name}" failed: ${err instanceof Error ? err.message : String(err)}`
            );
            // Don't include failed providers — graceful degradation
          }
        })
      );
      return results;
    };

    /**
     * Create a calendar event via a specific provider.
     * If params.provider is specified, use that provider.
     * Otherwise, use the configured default provider, or the first registered provider.
     */
    const requestCalendarEventCreate = async (
      params: CalendarCreateEventParams
    ): Promise<Record<string, CalendarActionResult>> => {
      const providerNames = Object.keys(calendarProviders);
      if (providerNames.length === 0) {
        return {};
      }

      // Determine which provider to use
      let targetProvider: string | undefined = params.provider;
      if (!targetProvider) {
        targetProvider =
          config.getPluginConfig().defaultProvider || providerNames[0];
      }

      if (!targetProvider || !calendarProviders[targetProvider]) {
        const fallback = providerNames[0];
        plugin.logger.warn(
          `requestCalendarEventCreate: Provider "${targetProvider}" not found, falling back to "${fallback}".`
        );
        targetProvider = fallback;
      }

      try {
        const result =
          await calendarProviders[targetProvider].createEvent(params);
        return { [targetProvider]: result };
      } catch (err) {
        return {
          [targetProvider]: {
            provider: targetProvider,
            success: false,
            message: `Failed to create event: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    };

    /**
     * Update a calendar event.
     * If params.provider is specified, use that provider.
     * Otherwise, try each provider until one succeeds (since event IDs are provider-scoped,
     * only the owning provider will recognize the event).
     */
    const requestCalendarEventUpdate = async (
      params: CalendarUpdateEventParams
    ): Promise<Record<string, CalendarActionResult>> => {
      const providerNames = Object.keys(calendarProviders);
      if (providerNames.length === 0) {
        return {};
      }

      // If a specific provider is requested, use it
      if (params.provider && calendarProviders[params.provider]) {
        try {
          const result =
            await calendarProviders[params.provider].updateEvent(params);
          return { [params.provider]: result };
        } catch (err) {
          return {
            [params.provider]: {
              provider: params.provider,
              success: false,
              message: `Failed to update event: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
        }
      }

      // Otherwise, try each provider until one succeeds
      // (event IDs are provider-scoped, so only the owning provider will recognize the event)
      for (const name of providerNames) {
        try {
          const result = await calendarProviders[name].updateEvent(params);
          if (result.success) {
            return { [name]: result };
          }
        } catch {
          // This provider didn't recognize the event, try the next one
          continue;
        }
      }

      // No provider could update the event
      return {
        _none: {
          provider: '_none',
          success: false,
          message:
            'No calendar provider could update this event. The event ID may not exist in any connected calendar.',
        },
      };
    };

    // -------------------------------------------------------------------------
    // Offer capabilities
    // -------------------------------------------------------------------------

    plugin.offer<'calendar-broker'>({
      registerCalendarProvider: (name: string, provider: CalendarProvider) => {
        calendarProviders[name] = provider;
        plugin.logger.log(
          `registerCalendarProvider: Registered calendar provider "${name}".`
        );
      },
      requestCalendarEvents,
      requestCalendarEventCreate,
      requestCalendarEventUpdate,
    });

    // -------------------------------------------------------------------------
    // Register LLM tools
    // -------------------------------------------------------------------------

    plugin.registerTool({
      name: 'getCalendarEvents',
      description:
        'Get calendar events from all connected calendar accounts. Returns events within a time range.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment:
        "You can check the user's calendar using the getCalendarEvents tool. " +
        'Use it when the user asks about their schedule, upcoming events, or availability. ' +
        'Events are returned chronologically with time, title, location, and attendee information.',
      toolResultPromptIntro: 'Calendar events:\n',
      toolResultPromptOutro: '',
      taintStatus: 'tainted',
      parameters: GetCalendarEventsToolParameters,
      execute: async (parameters: GetCalendarEventsToolParameters) => {
        const results = await requestCalendarEvents({
          timeMin: parameters.timeMin,
          timeMax: parameters.timeMax,
          maxResults: parameters.maxResults ?? 25,
        });

        const providerNames = Object.keys(results);
        if (providerNames.length === 0) {
          return 'No calendar providers are currently available. Please connect a calendar account to use calendar features.';
        }

        const allResultsEmpty = providerNames.every(
          name => results[name].length === 0
        );
        if (allResultsEmpty) {
          const timeRange =
            parameters.timeMin && parameters.timeMax
              ? ` between ${parameters.timeMin} and ${parameters.timeMax}`
              : ' for the requested time range';
          return `No calendar events found${timeRange}.`;
        }

        // Collect all events from all providers and sort chronologically
        const allEvents: Array<{ provider: string; event: CalendarEvent }> = [];
        for (const [provider, events] of Object.entries(results)) {
          for (const event of events) {
            allEvents.push({ provider, event });
          }
        }

        // Sort by start time
        allEvents.sort((a, b) => {
          const timeA = new Date(a.event.start.dateTime).getTime();
          const timeB = new Date(b.event.start.dateTime).getTime();
          return timeA - timeB;
        });

        const outputParts: string[] = [];
        for (const { provider, event } of allEvents) {
          const parts: string[] = [];
          parts.push(`### ${event.title}`);
          parts.push(
            `Start: ${event.start.dateTime} (${event.start.timeZone})`
          );
          parts.push(`End: ${event.end.dateTime} (${event.end.timeZone})`);
          if (event.location) {
            parts.push(`Location: ${event.location}`);
          }
          if (event.attendees && event.attendees.length > 0) {
            const attendeeList = event.attendees
              .map(a => {
                const name = a.displayName
                  ? `${a.displayName} <${a.email}>`
                  : a.email;
                const status = a.responseStatus ? ` (${a.responseStatus})` : '';
                return `${name}${status}`;
              })
              .join(', ');
            parts.push(`Attendees: ${attendeeList}`);
          }
          if (event.status !== 'confirmed') {
            parts.push(`Status: ${event.status}`);
          }
          if (event.isRecurring) {
            parts.push('Recurring event');
          }
          parts.push(`Provider: ${provider}`);
          parts.push(`Event ID: ${event.id}`);
          outputParts.push(parts.join('\n'));
        }

        return outputParts.join('\n\n---\n\n');
      },
    });

    plugin.registerTool({
      name: 'createCalendarEvent',
      description:
        'Create a new calendar event. You MUST confirm the details with the user before creating any event.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment:
        'You can create calendar events using the createCalendarEvent tool. ' +
        'CRITICAL SAFETY RULES: ' +
        '1. ALWAYS confirm event details (title, time, location, attendees) with the user before creating. ' +
        '2. When inviting other people (attendees), be especially careful — calendar invitations are sent automatically. ' +
        '3. Make sure the time zone is correct. ' +
        '4. Only create events when the user explicitly asks you to.',
      toolResultPromptIntro: '',
      toolResultPromptOutro:
        'Remember: calendar events may trigger notifications and invitations to attendees.',
      taintStatus: 'tainted',
      parameters: CreateCalendarEventToolParameters,
      execute: async (parameters: CreateCalendarEventToolParameters) => {
        const providerNames = Object.keys(calendarProviders);
        if (providerNames.length === 0) {
          return 'No calendar providers are currently available. Please connect a calendar account to use calendar features.';
        }

        const start: CalendarDateTime = {
          dateTime: parameters.startDateTime,
          timeZone: parameters.startTimeZone || resolveTimeZone(),
        };
        const end: CalendarDateTime = {
          dateTime: parameters.endDateTime,
          timeZone: parameters.endTimeZone || resolveTimeZone(),
        };

        const createParams: CalendarCreateEventParams = {
          title: parameters.title,
          start,
          end,
          description: parameters.description,
          location: parameters.location,
          attendees: parameters.attendees,
        };

        const results = await requestCalendarEventCreate(createParams);
        const resultProviderNames = Object.keys(results);
        if (resultProviderNames.length === 0) {
          return 'Failed to create calendar event. No providers are available.';
        }

        const [providerName, result] = Object.entries(results)[0];

        if (result.success) {
          let confirmation = `Event created successfully via ${providerName}.\n`;
          confirmation += `Title: ${parameters.title}\n`;
          confirmation += `Start: ${start.dateTime} (${start.timeZone})\n`;
          confirmation += `End: ${end.dateTime} (${end.timeZone})`;
          if (parameters.location) {
            confirmation += `\nLocation: ${parameters.location}`;
          }
          if (parameters.attendees && parameters.attendees.length > 0) {
            confirmation += `\nAttendees: ${parameters.attendees.join(', ')}`;
          }
          if (result.eventId) {
            confirmation += `\nEvent ID: ${result.eventId}`;
          }
          return confirmation;
        } else {
          return `Failed to create calendar event via ${providerName}: ${result.message}`;
        }
      },
    });

    plugin.registerTool({
      name: 'updateCalendarEvent',
      description:
        'Update an existing calendar event. You MUST confirm the changes with the user before updating.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment:
        'You can update calendar events using the updateCalendarEvent tool. ' +
        'CRITICAL SAFETY RULES: ' +
        '1. ALWAYS confirm the proposed changes with the user before updating an event. ' +
        '2. Be especially careful when modifying events that have other attendees — they may receive notification emails. ' +
        '3. You need the event ID, which you can get from getCalendarEvents results.',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      taintStatus: 'tainted',
      parameters: UpdateCalendarEventToolParameters,
      execute: async (parameters: UpdateCalendarEventToolParameters) => {
        const providerNames = Object.keys(calendarProviders);
        if (providerNames.length === 0) {
          return 'No calendar providers are currently available. Please connect a calendar account to use calendar features.';
        }

        const updateParams: CalendarUpdateEventParams = {
          eventId: parameters.eventId,
          title: parameters.title,
          start: parameters.startDateTime
            ? {
                dateTime: parameters.startDateTime,
                timeZone: parameters.startTimeZone || resolveTimeZone(),
              }
            : undefined,
          end: parameters.endDateTime
            ? {
                dateTime: parameters.endDateTime,
                timeZone: parameters.endTimeZone || resolveTimeZone(),
              }
            : undefined,
          description: parameters.description,
          location: parameters.location,
          addAttendees: parameters.addAttendees,
          removeAttendees: parameters.removeAttendees,
        };

        const results = await requestCalendarEventUpdate(updateParams);
        const resultProviderNames = Object.keys(results);
        if (resultProviderNames.length === 0) {
          return 'Failed to update calendar event. No providers are available.';
        }

        const [providerName, result] = Object.entries(results)[0];

        if (result.success) {
          let confirmation = `Event updated successfully via ${providerName}.\n`;
          confirmation += `Event ID: ${parameters.eventId}`;
          const changes: string[] = [];
          if (parameters.title) changes.push(`title → "${parameters.title}"`);
          if (parameters.startDateTime)
            changes.push(`start → ${parameters.startDateTime}`);
          if (parameters.endDateTime)
            changes.push(`end → ${parameters.endDateTime}`);
          if (parameters.description !== undefined)
            changes.push('description updated');
          if (parameters.location !== undefined)
            changes.push(`location → "${parameters.location}"`);
          if (parameters.addAttendees)
            changes.push(
              `added attendees: ${parameters.addAttendees.join(', ')}`
            );
          if (parameters.removeAttendees)
            changes.push(
              `removed attendees: ${parameters.removeAttendees.join(', ')}`
            );
          if (changes.length > 0) {
            confirmation += `\nChanges: ${changes.join('; ')}`;
          }
          return confirmation;
        } else {
          return `Failed to update event via ${providerName}: ${result.message}`;
        }
      },
    });

    plugin.logger.log('registerPlugin: Calendar Broker plugin registered.');
  },
};

export default calendarBrokerPlugin;

// Re-export types for provider plugins to import
export type {
  CalendarEvent,
  CalendarActionResult,
  CalendarDateTime,
  CalendarAttendee,
  CalendarReminder,
  CalendarGetEventsParams,
  CalendarCreateEventParams,
  CalendarUpdateEventParams,
  CalendarProvider,
} from './calendar-types.js';
