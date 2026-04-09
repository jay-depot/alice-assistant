import { AlicePlugin } from '../../lib.js';
import { RemindersSchedule } from './db-schemas/RemindersSchedule.js';

type Reminder = {
  id: string;
  reminderMessage: string;
  scheduledFor: Date;
  source: string; // the name of the plugin that provided this reminder
};

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'reminders-broker': {
      /**
       * Creates a new reminder with the given details and returns the ID of the newly created reminder. 
       * The returned ID can be used to manage the reminder in the future (e.g. update, delete, etc.). 
       * The plugin that creates the reminder is expected to provide all necessary details for the 
       * reminder, including its reminderMessage, scheduledFor, and source (the name of the plugin that 
       * provided this reminder). The reminders-broker plugin will take care of storing the reminder 
       * and ensuring it gets delivered to the user at the appropriate time via the notifications-broker 
       * plugin.
       */
      createNewReminder: (reminder: Omit<Reminder, 'id'>) => Promise<string>;

      /**
       * Updates an existing reminder with the given ID and new details. The plugin can update any 
       * details of the reminder, including its reminderMessage, scheduledFor, and source (the name of 
       * the plugin that provided this reminder). The reminders-broker plugin will take care of 
       * updating the stored reminder and ensuring the updated reminder gets delivered to the user 
       * at the appropriate time via the notifications-broker plugin.
       */
      updateReminder: (id: string, updatedDetails: Partial<Omit<Reminder, 'id'>>) => Promise<void>;

      /**
       * Deletes an existing reminder with the given ID. The reminders-broker plugin will take care 
       * of deleting the stored reminder and ensuring it does not get delivered to the user in the 
       * future.
       */
      deleteReminder: (id: string) => Promise<void>;
    }
  }
}

const remindersBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'reminders-broker',
    name: 'Reminders Broker Plugin',
    description: 'Provides an API for other plugins to create, manage, and receive reminders. This ' +
      'plugin does not implement any reminder storage or notification mechanism itself, but rather ' +
      'serves as a central repository for all reminders from any plugins that wish to create them.' +
      'As reminders come up in the schedule, they are forwarded to the notifications-broker plugin ' +
      'to be dispatched into all notification sinks for delivery to the user.',
    version: 'LATEST',
    dependencies: [
      { id: 'datetime', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
      { id: 'notifications-broker', version: 'LATEST' },
    ],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const { registerDatabaseModels, onDatabaseReady } = plugin.request('memory')!;
    const { sendNotification } = plugin.request('notifications-broker')!;
    const awaitForOrm = onDatabaseReady(async (orm) => orm);
    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    let activePollingCycle: Promise<void> | null = null;
    let isShuttingDown = false;
    const inFlightNotificationPromises = new Set<Promise<void>>();

    const pollDueReminders = async (reason: 'startup' | 'interval' | 'shutdown-final') => {
      const orm = await awaitForOrm;
      const em = orm.em.fork();
      const dueReminders = await em.find(RemindersSchedule, {
        scheduledFor: { $lte: new Date() },
      }, {
        orderBy: { scheduledFor: 'ASC', id: 'ASC' },
      });

      if (dueReminders.length === 0) {
        if (process.env.ALICE_DEBUG) {
          console.log(`Reminders Broker: No due reminders found during ${reason} cycle.`);
        }
        return;
      }

      console.log(`Reminders Broker: Processing ${dueReminders.length} due reminder(s) during ${reason} cycle.`);

      for (const reminder of dueReminders) {
        const notificationPromise = sendNotification({
          title: `Reminder from ${reminder.source}`,
          message: reminder.reminderMessage,
          source: reminder.source,
        });

        inFlightNotificationPromises.add(notificationPromise);

        try {
          await notificationPromise;
          await em.remove(reminder).flush();
        } catch (error) {
          console.error(`Reminders Broker: Failed to deliver reminder ${reminder.id}.`, error);
        } finally {
          inFlightNotificationPromises.delete(notificationPromise);
        }
      }
    };

    const runPollingCycle = (reason: 'startup' | 'interval' | 'shutdown-final') => {
      if (reason !== 'shutdown-final' && isShuttingDown) {
        return Promise.resolve();
      }

      if (activePollingCycle) {
        if (process.env.ALICE_DEBUG) {
          console.log(`Reminders Broker: Skipping overlapping ${reason} cycle.`);
        }
        return activePollingCycle;
      }

      const cyclePromise = pollDueReminders(reason)
        .catch((error) => {
          console.error(`Reminders Broker: ${reason} cycle failed.`, error);
        })
        .finally(() => {
          if (activePollingCycle === cyclePromise) {
            activePollingCycle = null;
          }
        });

      activePollingCycle = cyclePromise;
      return cyclePromise;
    };

    registerDatabaseModels([RemindersSchedule]);

    plugin.offer<'reminders-broker'>({
      createNewReminder: async (reminder) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const reminderEntry = em.create(RemindersSchedule, {
          reminderMessage: reminder.reminderMessage,
          scheduledFor: reminder.scheduledFor,
          source: reminder.source,
        });

        em.persist(reminderEntry);

        await em.flush();

        return `${reminderEntry.id}`  ;
      },

      updateReminder: async (id, updatedDetails) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const reminderEntry = await em.findOne(RemindersSchedule, { id: parseInt(id) });

        if (!reminderEntry) {
          throw new Error(`Reminder with ID ${id} not found`);
        }

        if (updatedDetails.reminderMessage !== undefined) {
          reminderEntry.reminderMessage = updatedDetails.reminderMessage;
        }
        if (updatedDetails.scheduledFor !== undefined) {
          reminderEntry.scheduledFor = updatedDetails.scheduledFor;
        }
        if (updatedDetails.source !== undefined) {
          reminderEntry.source = updatedDetails.source;
        }

        await em.flush();
      },
      
      deleteReminder: async (id) => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const reminderEntry = await em.findOne(RemindersSchedule, { id: parseInt(id) });

        if (!reminderEntry) {
          throw new Error(`Reminder with ID ${id} not found`);
        }

        await em.remove(reminderEntry).flush();
      }
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      if (pollingInterval) {
        return;
      }

      console.log('Reminders Broker: Starting due-reminder polling loop.');
      pollingInterval = setInterval(() => {
        void runPollingCycle('interval');
      }, 60 * 1000);

      void runPollingCycle('startup');
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      isShuttingDown = true;

      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }

      console.log('Reminders Broker: Stopping due-reminder polling loop.');

      if (activePollingCycle) {
        await activePollingCycle;
      }

      if (inFlightNotificationPromises.size > 0) {
        console.log(`Reminders Broker: Waiting for ${inFlightNotificationPromises.size} in-flight reminder notification(s).`);
        await Promise.allSettled([...inFlightNotificationPromises]);
      }

      await runPollingCycle('shutdown-final');
    });
  }
};

export default remindersBrokerPlugin;
