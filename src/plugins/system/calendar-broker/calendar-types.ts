/**
 * @file calendar-types.ts
 *
 * Shared calendar type definitions for the calendar-broker plugin and its providers.
 *
 * These types define the contract between the calendar-broker (which owns the
 * LLM tools) and provider plugins (like google-calendar) that implement the
 * actual calendar operations.
 */

/** Timezone-aware datetime. */
export type CalendarDateTime = {
  /** ISO 8601 datetime string */
  dateTime: string;
  /** IANA timezone ID (e.g. 'America/New_York') */
  timeZone: string;
};

/** Attendee with response status. */
export type CalendarAttendee = {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
};

/** Reminder specification. */
export type CalendarReminder = {
  method: 'email' | 'popup';
  minutesBefore: number;
};

/** Standardized calendar event shape. */
export type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  location?: string;
  attendees?: CalendarAttendee[];
  isRecurring: boolean;
  /** RRULE string if recurring */
  recurrenceRule?: string;
  reminders?: CalendarReminder[];
  status: 'confirmed' | 'tentative' | 'cancelled';
  /** Which provider owns this event */
  providerId: string;
  /** Calendar/subcalendar identifier */
  calendarId?: string;
};

/** Result shape for calendar operations. */
export type CalendarActionResult = {
  provider: string;
  success: boolean;
  /** Human-readable result */
  message: string;
  eventId?: string;
};

/** Parameters for fetching events. */
export type CalendarGetEventsParams = {
  /** ISO 8601 datetime. Default: now */
  timeMin?: string;
  /** ISO 8601 datetime. Default: now + 7 days */
  timeMax?: string;
  /** Specific calendar, default: primary */
  calendarId?: string;
  /** Default: 25 */
  maxResults?: number;
};

/** Parameters for creating an event. */
export type CalendarCreateEventParams = {
  title: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  description?: string;
  location?: string;
  /** Attendee email addresses */
  attendees?: string[];
  reminders?: CalendarReminder[];
  calendarId?: string;
  /** If specified, create on this provider. Otherwise, use the first registered provider. */
  provider?: string;
};

/** Parameters for updating an event. */
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
  /** If specified, update on this provider. Otherwise, try all providers. */
  provider?: string;
};

/**
 * The interface that calendar provider plugins implement.
 *
 * Each provider must provide all three methods. The broker dispatches
 * read operations (getEvents) to ALL providers in parallel, but
 * write operations (create, update) to a specific provider.
 */
export type CalendarProvider = {
  getEvents: (params: CalendarGetEventsParams) => Promise<CalendarEvent[]>;
  createEvent: (
    params: CalendarCreateEventParams
  ) => Promise<CalendarActionResult>;
  updateEvent: (
    params: CalendarUpdateEventParams
  ) => Promise<CalendarActionResult>;
};
