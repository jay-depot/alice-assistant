import { defineEntity, p } from '@mikro-orm/core';

/**
 * An *exceedingly simple* schedule schema for single-instance reminders. 
 */
const RemindersScheduleSchema = defineEntity({
  name: 'RemindersSchedule',
  properties: {
    id: p.integer().primary(),
    reminderMessage: p.string(),
    scheduledFor: p.datetime(),
    source: p.string(), // the name of the plugin that provided this reminder
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  }
});

export class RemindersSchedule extends RemindersScheduleSchema.class {}

RemindersScheduleSchema.setClass(RemindersSchedule);
