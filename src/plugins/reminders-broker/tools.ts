import { Static, Type } from '@sinclair/typebox';
import { Tool } from '../../lib/tool-system.js';
import { UserConfig } from '../../lib/user-config.js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { simpleExpandTilde } from '../../lib/simple-tilde-expansion.js';

const ReminderRecord = Type.Object({
  id: Type.String(),
  title: Type.String(),
  dueAt: Type.String(),
  recurrence: Type.Optional(Type.String()),
  completed: Type.Boolean(),
  createdAt: Type.String()
});

const parameters = Type.Object({
  action: Type.Union([
    Type.Literal('create'),
    Type.Literal('list'),
    Type.Literal('complete'),
    Type.Literal('delete'),
    Type.Literal('updateDescription'),
    Type.Literal('rescheduleOne'),
    Type.Literal('rescheduleAll')
  ]),
  title: Type.Optional(Type.String({ description: 'Reminder title (required for create)' })),
  dueAt: Type.Optional(Type.String({ description: 'ISO 8601 datetime (required for create)' })),
  recurrence: Type.Optional(Type.String({ 
    description: 'Recurrence pattern: daily, weekly, monthly (optional)' 
  })),
  id: Type.Optional(Type.String({ 
    description: 'Reminder ID (required for complete/delete/updateDescription/rescheduleOne/rescheduleAll)' 
  })),
  description: Type.Optional(Type.String({
     description: 'Additional details about the reminder (optional)' 
  }))
});

interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  recurrence?: string;
  completed: boolean;
  createdAt: string;
}

function getReminderPath(): string {
  const config = UserConfig.getConfig();
  const baseDir = simpleExpandTilde(config.toolSettings.manageReminders?.storageDirectory || 
    path.join(config.configDirectory || process.env.HOME, 'reminders'));
  
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  
  return path.join(baseDir, 'reminders.json');
}

function loadReminders(): Reminder[] {
  const filePath = getReminderPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Reminder[];
  } catch (err) {
    return [];
  }
}

function saveReminders(reminders: Reminder[]): void {
  const filePath = getReminderPath();
  fs.writeFileSync(filePath, JSON.stringify(reminders, null, 2), 'utf-8');
}

export async function getRemindersComingSoon(minutesAhead: number): Promise<Reminder[]> {
  const reminders = loadReminders();
  const now = new Date();
  const upcoming = reminders.filter(r => {
    if (r.completed) return false;
    const dueDate = new Date(r.dueAt);
    return dueDate > now && dueDate <= new Date(now.getTime() + minutesAhead * 60000);
  });
  return upcoming;
}

const manageRemindersTool: Tool = {
  name: 'manageReminders',
  availableFor: ['chat-session', 'voice-session', 'autonomy'],
  dependencies: [],
  description: `Allows the assistant to create, list, complete, and delete reminders with optional recurrence patterns. ` +
    `Reminders are stored locally and persist between sessions.`,
  systemPromptFragment: `Call manageReminders to help the user manage reminders. Use the "action" parameter to specify ` +
    `what you want to do: "create" to add a new reminder, "list" to see all reminders, "complete" to mark one done, ` +
    `or "delete" to remove one. When creating a reminder, provide "title" and "dueAt" (ISO 8601 format, e.g., ` +
    `"2024-03-20T14:30:00"). Optionally add "recurrence" set to "daily", "weekly", or "monthly" for repeating reminders. ` +
    `When completing or deleting, provide the reminder "id". For example, if the user says "remind me to call Mom next ` +
    `Tuesday at 2pm", you would call manageReminders with action="create", title="Call Mom", and the appropriate dueAt ` +
    `timestamp. Always call manageReminders with action="list" first to check for existing reminders if the user asks ` +
    `to set a reminder about something that might already be tracked.`,
  callSignature: 'manageReminders',
  parameters,
  toolResultPromptIntro: `You have just performed a reminder operation. The response contains the result of your action. ` +
    `If you created a reminder, confirm it with the user. If you listed reminders, summarize them naturally. If you ` +
    `completed or deleted a reminder, confirm the action. Remember that your response will be synthesized into speech, ` +
    `so keep it conversational and brief.`,
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const action = args.action;

    switch (action) {
      case 'create': {
        if (!args.title || !args.dueAt) {
          return JSON.stringify({
            error: 'create action requires "title" and "dueAt" parameters'
          });
        }

        try {
          new Date(args.dueAt); // Validate ISO 8601 format
        } catch (err) {
          return JSON.stringify({
            error: 'Invalid dueAt format. Use ISO 8601 (e.g., "2024-03-20T14:30:00")'
          });
        }

        const reminders = loadReminders();
        const newReminder: Reminder = {
          id: randomUUID(),
          title: args.title,
          dueAt: args.dueAt,
          recurrence: args.recurrence,
          completed: false,
          createdAt: new Date().toISOString()
        };

        reminders.push(newReminder);
        saveReminders(reminders);

        return JSON.stringify({
          action: 'created',
          reminder: newReminder
        });
      }

      case 'list': {
        const reminders = loadReminders();
        const pending = reminders.filter(r => !r.completed);
        const completed = reminders.filter(r => r.completed);

        return JSON.stringify({
          action: 'list',
          pendingCount: pending.length,
          completedCount: completed.length,
          pending,
          completed
        });
      }

      case 'complete': {
        if (!args.id) {
          return JSON.stringify({
            error: 'complete action requires "id" parameter'
          });
        }

        const reminders = loadReminders();
        const reminder = reminders.find(r => r.id === args.id);

        if (!reminder) {
          return JSON.stringify({
            error: `Reminder with id ${args.id} not found`
          });
        }

        reminder.completed = true;
        saveReminders(reminders);

        return JSON.stringify({
          action: 'completed',
          reminder
        });
      }

      case 'delete': {
        if (!args.id) {
          return JSON.stringify({
            error: 'delete action requires "id" parameter'
          });
        }

        const reminders = loadReminders();
        const index = reminders.findIndex(r => r.id === args.id);

        if (index === -1) {
          return JSON.stringify({
            error: `Reminder with id ${args.id} not found`
          });
        }

        const deleted = reminders.splice(index, 1)[0];
        saveReminders(reminders);

        return JSON.stringify({
          action: 'deleted',
          reminder: deleted
        });
      }

      default:
        return JSON.stringify({
          error: `Unknown action: ${action}`
        });
    }
  }
};

export default manageRemindersTool;
