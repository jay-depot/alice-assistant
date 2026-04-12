import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';

const CreateReminderToolParametersSchema = Type.Object({
  reminderMessage: Type.String({
    description: 'The message to be included in the reminder.',
  }),
  scheduledFor: Type.String({
    description:
      'The date and time when the reminder should be delivered, in ISO 8601 format.',
  }),
});

const UpdateReminderToolParametersSchema = Type.Object({
  id: Type.String({ description: 'The ID of the reminder to update.' }),
  updatedDetails: Type.Partial(
    Type.Object({
      reminderMessage: Type.String({
        description: 'The updated message for the reminder.',
      }),
      scheduledFor: Type.String({
        description:
          'The updated date and time for the reminder, in ISO 8601 format.',
      }),
    })
  ),
});

const CancelReminderToolParametersSchema = Type.Object({
  id: Type.String({ description: 'The ID of the reminder to cancel.' }),
});

export type CreateReminderToolParameters = Type.Static<
  typeof CreateReminderToolParametersSchema
>;
export type UpdateReminderToolParameters = Type.Static<
  typeof UpdateReminderToolParametersSchema
>;
export type CancelReminderToolParameters = Type.Static<
  typeof CancelReminderToolParametersSchema
>;

const remindMePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'remind-me',
    name: 'Remind Me Plugin',
    description:
      'A plugin that allows the assistant to directly create reminders on behalf ' +
      'of the user. It is basically a simple front-end to reminders-broker for one-shot ' +
      'reminders, and will (eventually) have enough internal state to manage recurring reminders.',
    version: 'LATEST',
    dependencies: [{ id: 'reminders-broker', version: 'LATEST' }],
    required: false,
  },

  registerPlugin: async pluginInterface => {
    const plugin = await pluginInterface.registerPlugin();

    const { createNewReminder, updateReminder, deleteReminder } =
      plugin.request('reminders-broker')!;

    plugin.registerTool({
      name: 'createReminder',
      description:
        'Creates a new one-shot reminder with the given message and schedule.',
      parameters: CreateReminderToolParametersSchema,
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (params: CreateReminderToolParameters) => {
        const reminderId = await createNewReminder({
          reminderMessage: params.reminderMessage,
          scheduledFor: new Date(params.scheduledFor),
          source: 'remind-me',
        });

        return `You have successfully scheduled a reminder with ID ${reminderId} for ${params.scheduledFor} to remind the user: "${params.reminderMessage}"`;
      },
    });

    plugin.registerTool({
      name: 'updateReminder',
      description:
        'Updates an existing one-shot reminder with the given ID and new details.',
      parameters: UpdateReminderToolParametersSchema,
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (params: UpdateReminderToolParameters) => {
        const newDate = params.updatedDetails.scheduledFor
          ? new Date(params.updatedDetails.scheduledFor)
          : undefined;
        const updatedDetails = {
          ...params.updatedDetails,
          scheduledFor: newDate,
        };

        await updateReminder(params.id, updatedDetails);

        return `You have successfully updated the reminder with ID ${params.id}`;
      },
    });

    plugin.registerTool({
      name: 'cancelReminder',
      description: 'Cancels an existing one-shot reminder with the given ID.',
      parameters: CancelReminderToolParametersSchema,
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (params: CancelReminderToolParameters) => {
        await deleteReminder(params.id);
        return `You have successfully canceled the reminder with ID ${params.id}`;
      },
    });
  },
};

export default remindMePlugin;
