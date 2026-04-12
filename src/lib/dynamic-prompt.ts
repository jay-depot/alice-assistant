import { ConversationTypeId } from './conversation-types.js';

export type DynamicPromptConversationType = ConversationTypeId;
export type DynamicPromptContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  toolCallsAllowed?: boolean;
  /** Set when this context is for a task assistant conversation. */
  taskAssistantId?: string;
};

export type DynamicPrompt = {
  // Sorting weight for this prompt. Lower numbers are sent first. Prompts with the same
  // weight are sorted alphabetically by their "name" property.
  weight: number;
  // A unique name for this prompt. Only used as a last resort for sorting, and labeling
  // application log entries. One word, or somethingCamelCase will make your life easier
  // later when searching logs.
  name: string;
  // The function to generate the prompt text. Return or resolve to false if the prompt
  // should not be used in the current context.
  getPrompt: (
    context: DynamicPromptContext
  ) => Promise<string | false> | string | false;
};

export async function processDynamicPrompts(
  context: DynamicPromptContext,
  dynamicPrompts: DynamicPrompt[]
): Promise<string[]> {
  const applicablePrompts = await Promise.all(
    dynamicPrompts.map(async prompt => {
      const promptText = await prompt.getPrompt(context);
      return { ...prompt, promptText };
    })
  )
    .then(prompts => prompts.filter(prompt => prompt.promptText !== false))
    .then(prompts =>
      prompts.sort((a, b) => {
        if (a.weight === b.weight) {
          return a.name.localeCompare(b.name);
        }
        return a.weight - b.weight;
      })
    );
  return applicablePrompts.map(prompt => prompt.promptText as string);
}
