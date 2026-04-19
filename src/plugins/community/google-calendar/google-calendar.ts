/**
 * @file google-calendar.ts
 *
 * Google Calendar provider plugin for A.L.I.C.E. Assistant.
 *
 * Community plugin that bridges the Google Calendar API v3 into the
 * calendar-broker. For each authenticated Google account, it registers
 * a separate calendar provider named `google-calendar:{accountId}`.
 *
 * Dependencies: google-apis (for OAuth clients), calendar-broker (for provider registration).
 */

import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type { GoogleApisCapability } from '../google-apis/google-apis.js';
import type {
  CalendarEvent,
  CalendarActionResult,
  CalendarDateTime,
  CalendarAttendee,
  CalendarReminder,
  CalendarGetEventsParams,
  CalendarCreateEventParams,
  CalendarUpdateEventParams,
  CalendarProvider,
} from '../../system/calendar-broker/calendar-types.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const GoogleCalendarPluginConfigSchema = Type.Object({
  /** Preferred Google account ID to use. If empty, uses the first available account. */
  preferredAccount: Type.Optional(
    Type.String({
      description:
        'The Google account ID to prefer for calendar operations. If empty, the first available account is used.',
    })
  ),
  /** Default calendar ID. Default: 'primary' */
  defaultCalendarId: Type.Optional(
    Type.String({
      description:
        'The default calendar ID to use. "primary" uses the user\'s primary calendar.',
      default: 'primary',
    })
  ),
  /** Maximum number of results per query. Default: 25 */
  maxResultsPerQuery: Type.Optional(
    Type.Number({
      description: 'Maximum number of events to return per query. Default: 25.',
      default: 25,
    })
  ),
});

type GoogleCalendarPluginConfig = Static<
  typeof GoogleCalendarPluginConfigSchema
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalendarClient = any; // calendar_v3.Calendar from @googleapis/calendar

// ---------------------------------------------------------------------------
// Google Calendar → CalendarEvent mapping
// ---------------------------------------------------------------------------

/**
 * Convert a Google Calendar API event resource to our CalendarEvent format.
 */
function googleEventToCalendarEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gEvent: any,
  providerId: string,
  calendarId?: string
): CalendarEvent {
  // Map attendees
  const attendees: CalendarAttendee[] = (gEvent.attendees ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((att: any) => ({
      email: att.email ?? '',
      displayName: att.displayName ?? undefined,
      responseStatus: att.responseStatus ?? undefined,
    }));

  // Map reminders
  const reminders: CalendarReminder[] = [];
  if (gEvent.reminders?.overrides) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const rem of gEvent.reminders.overrides as any[]) {
      reminders.push({
        method: rem.method === 'email' ? 'email' : 'popup',
        minutesBefore: rem.minutes ?? 0,
      });
    }
  }

  // Determine start/end with timezone
  const start: CalendarDateTime = {
    dateTime: gEvent.start?.dateTime ?? gEvent.start?.date ?? '',
    timeZone: gEvent.start?.timeZone ?? 'UTC',
  };
  const end: CalendarDateTime = {
    dateTime: gEvent.end?.dateTime ?? gEvent.end?.date ?? '',
    timeZone: gEvent.end?.timeZone ?? 'UTC',
  };

  // Recurrence
  const recurrence: string[] = gEvent.recurrence ?? [];
  const isRecurring =
    !!(gEvent.recurrence && gEvent.recurrence.length > 0) ||
    !!gEvent.recurringEventId;

  return {
    id: gEvent.id ?? '',
    title: gEvent.summary ?? '(No title)',
    description: gEvent.description ?? undefined,
    start,
    end,
    location: gEvent.location ?? undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
    isRecurring,
    recurrenceRule: recurrence.length > 0 ? recurrence[0] : undefined,
    reminders: reminders.length > 0 ? reminders : undefined,
    status: gEvent.status ?? 'confirmed',
    providerId,
    calendarId,
  };
}

/**
 * Convert CalendarCreateEventParams to a Google Calendar event resource.
 */
function createParamsToGoogleEvent(
  params: CalendarCreateEventParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event: any = {
    summary: params.title,
    start: {
      dateTime: params.start.dateTime,
      timeZone: params.start.timeZone,
    },
    end: {
      dateTime: params.end.dateTime,
      timeZone: params.end.timeZone,
    },
  };

  if (params.description) {
    event.description = params.description;
  }

  if (params.location) {
    event.location = params.location;
  }

  if (params.attendees && params.attendees.length > 0) {
    event.attendees = params.attendees.map(email => ({ email }));
  }

  if (params.reminders && params.reminders.length > 0) {
    event.reminders = {
      useDefault: false,
      overrides: params.reminders.map(rem => ({
        method: rem.method,
        minutes: rem.minutesBefore,
      })),
    };
  } else {
    event.reminders = { useDefault: true };
  }

  return event;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const googleCalendarPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'google-calendar',
    name: 'Google Calendar Plugin',
    brandColor: '#4285F4', // Google Blue
    description:
      'Provides Google Calendar functionality through the calendar-broker plugin. ' +
      'Requires the google-apis plugin with an authenticated Google account.',
    version: 'LATEST',
    dependencies: [
      { id: 'google-apis', version: 'LATEST' },
      { id: 'calendar-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<GoogleCalendarPluginConfig>(
      GoogleCalendarPluginConfigSchema,
      { defaultCalendarId: 'primary', maxResultsPerQuery: 25 }
    );

    // Request capabilities from dependencies
    const googleApis = plugin.request('google-apis') as
      | GoogleApisCapability
      | undefined;
    const calendarBroker = plugin.request('calendar-broker');

    if (!googleApis) {
      plugin.logger.error(
        'registerPlugin: google-apis capability not available. ' +
          'Ensure the google-apis plugin is enabled and loaded before google-calendar.'
      );
      return;
    }

    if (!calendarBroker) {
      plugin.logger.error(
        'registerPlugin: calendar-broker capability not available. ' +
          'Ensure the calendar-broker plugin is enabled and loaded before google-calendar.'
      );
      return;
    }

    // Register providers after google-apis has restored accounts from the vault.
    // onAssistantAcceptsRequests fires after ALL onAssistantWillAcceptRequests
    // hooks have completed, so the account store will definitely be populated
    // by the time we call listAccounts().
    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        'onAssistantAcceptsRequests: Registering Google Calendar providers.'
      );

      const accountIds = googleApis.listAccounts();

      if (accountIds.length === 0) {
        plugin.logger.warn(
          'onAllPluginsLoaded: No Google accounts are connected. ' +
            'The google-calendar plugin requires at least one authenticated Google account. ' +
            'Please connect a Google account via the google-apis web UI.'
        );
        return;
      }

      for (const accountId of accountIds) {
        const accountInfo = googleApis.getAccountInfo(accountId);

        if (!accountInfo?.isAuthenticated) {
          plugin.logger.warn(
            `onAllPluginsLoaded: Google account "${accountId}" is not authenticated. Skipping.`
          );
          continue;
        }

        const providerName = `google-calendar:${accountId}`;

        const provider: CalendarProvider = {
          getEvents: (params: CalendarGetEventsParams) =>
            getEvents(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),

          createEvent: (params: CalendarCreateEventParams) =>
            createEvent(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),

          updateEvent: (params: CalendarUpdateEventParams) =>
            updateEvent(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),
        };

        calendarBroker.registerCalendarProvider(providerName, provider);

        plugin.logger.log(
          `onAllPluginsLoaded: Registered calendar provider "${providerName}".`
        );
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Google Calendar API operations
// ---------------------------------------------------------------------------

async function getEvents(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: CalendarGetEventsParams,
  pluginConfig: GoogleCalendarPluginConfig,
  logger: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }
): Promise<CalendarEvent[]> {
  try {
    const calendarClient = (await googleApis.getCalendarClient(
      accountId
    )) as CalendarClient | null;

    if (!calendarClient) {
      logger.error(
        `getEvents: Could not get Calendar client for account "${accountId}".`
      );
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listParams: any = {
      calendarId:
        params.calendarId ?? pluginConfig.defaultCalendarId ?? 'primary',
      maxResults: params.maxResults ?? pluginConfig.maxResultsPerQuery ?? 25,
      singleEvents: true, // Expand recurring events into instances
      orderBy: 'startTime',
    };

    if (params.timeMin) {
      listParams.timeMin = params.timeMin;
    } else {
      // Default: now
      listParams.timeMin = new Date().toISOString();
    }

    if (params.timeMax) {
      listParams.timeMax = params.timeMax;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await calendarClient.events.list(listParams);

    const events = response.data?.items ?? [];

    return events.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) =>
        googleEventToCalendarEvent(
          e,
          `google-calendar:${accountId}`,
          params.calendarId ?? pluginConfig.defaultCalendarId ?? 'primary'
        )
    );
  } catch (err) {
    logger.error(
      `getEvents: Google Calendar events.list failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

async function createEvent(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: CalendarCreateEventParams,
  pluginConfig: GoogleCalendarPluginConfig,
  logger: { error: (...args: unknown[]) => void }
): Promise<CalendarActionResult> {
  try {
    const calendarClient = (await googleApis.getCalendarClient(
      accountId
    )) as CalendarClient | null;
    if (!calendarClient) {
      return {
        provider: `google-calendar:${accountId}`,
        success: false,
        message: `Could not get Calendar client for account "${accountId}".`,
      };
    }

    const eventResource = createParamsToGoogleEvent(params);
    const calendarId =
      params.calendarId ?? pluginConfig.defaultCalendarId ?? 'primary';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await calendarClient.events.insert({
      calendarId,
      requestBody: eventResource,
    });

    return {
      provider: `google-calendar:${accountId}`,
      success: true,
      message: 'Calendar event created successfully.',
      eventId: response.data?.id ?? undefined,
    };
  } catch (err) {
    logger.error(
      `createEvent: Failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      provider: `google-calendar:${accountId}`,
      success: false,
      message: `Failed to create calendar event: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function updateEvent(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: CalendarUpdateEventParams,
  pluginConfig: GoogleCalendarPluginConfig,
  logger: { error: (...args: unknown[]) => void }
): Promise<CalendarActionResult> {
  try {
    const calendarClient = (await googleApis.getCalendarClient(
      accountId
    )) as CalendarClient | null;
    if (!calendarClient) {
      return {
        provider: `google-calendar:${accountId}`,
        success: false,
        message: `Could not get Calendar client for account "${accountId}".`,
      };
    }

    const calendarId =
      params.calendarId ?? pluginConfig.defaultCalendarId ?? 'primary';

    // Build a partial update object — only include fields that are defined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateBody: any = {};

    if (params.title !== undefined) {
      updateBody.summary = params.title;
    }
    if (params.description !== undefined) {
      updateBody.description = params.description;
    }
    if (params.location !== undefined) {
      updateBody.location = params.location;
    }
    if (params.start) {
      updateBody.start = {
        dateTime: params.start.dateTime,
        timeZone: params.start.timeZone,
      };
    }
    if (params.end) {
      updateBody.end = {
        dateTime: params.end.dateTime,
        timeZone: params.end.timeZone,
      };
    }

    // Handle attendee changes
    // For patch operations, we need the full attendees array.
    // Google requires fetching the current event first to handle add/remove properly.
    if (params.addAttendees || params.removeAttendees) {
      // Fetch the current event to get its attendees
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentEvent: any = await calendarClient.events.get({
        calendarId,
        eventId: params.eventId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentAttendees: any[] = currentEvent.data?.attendees ?? [];

      // Build the updated attendees list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatedAttendees: any[] = currentAttendees.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (att: any) => {
          if (params.removeAttendees) {
            return !params.removeAttendees.includes(att.email);
          }
          return true;
        }
      );

      if (params.addAttendees) {
        for (const email of params.addAttendees) {
          if (!updatedAttendees.some(att => att.email === email)) {
            updatedAttendees.push({ email });
          }
        }
      }

      updateBody.attendees = updatedAttendees;
    }

    // Handle reminders
    if (params.reminders) {
      updateBody.reminders = {
        useDefault: false,
        overrides: params.reminders.map(rem => ({
          method: rem.method,
          minutes: rem.minutesBefore,
        })),
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await calendarClient.events.patch({
      calendarId,
      eventId: params.eventId,
      requestBody: updateBody,
    });

    return {
      provider: `google-calendar:${accountId}`,
      success: true,
      message: 'Calendar event updated successfully.',
      eventId: response.data?.id ?? params.eventId,
    };
  } catch (err) {
    // If the event doesn't exist on this provider, return failure
    // so the broker can try other providers
    const error: Error | null = err instanceof Error ? err : null;
    const is404 =
      error?.message?.includes('404') || String(err).includes('not found');
    if (is404) {
      return {
        provider: `google-calendar:${accountId}`,
        success: false,
        message: 'Event not found on this provider.',
      };
    }

    logger.error(
      `updateEvent: Failed for account "${accountId}": ${error?.message ?? String(err)}`
    );
    return {
      provider: `google-calendar:${accountId}`,
      success: false,
      message: `Failed to update calendar event: ${error?.message ?? String(err)}`,
    };
  }
}

export default googleCalendarPlugin;
