export const BUILT_IN_CONVERSATION_TYPE_IDS = [
  'voice',
  'chat',
  'startup',
  'autonomy',
] as const;

export type BuiltInConversationTypeId =
  (typeof BUILT_IN_CONVERSATION_TYPE_IDS)[number];
export type ConversationTypeId = BuiltInConversationTypeId | (string & {});

export type ConversationTypeFamily = BuiltInConversationTypeId;

export type ConversationTypeDefinition = {
  id: ConversationTypeId;
  name: string;
  description: string;
  baseType: ConversationTypeFamily;
  includePersonality?: boolean;
  scenarioPrompt?: string;
  maxToolCallDepth?: number;
};

const builtInConversationTypeDefinitions: ConversationTypeDefinition[] = [
  {
    id: 'voice',
    name: 'Voice Conversation',
    description:
      'A wake-word-driven voice interaction that should produce short spoken replies.',
    baseType: 'voice',
    includePersonality: true,
    scenarioPrompt: [
      ' - You have just been activated again by a known user with your wake word "{{wakeWord}}".',
      ' - Remember, your response will be synthesized into speech, so keep it punchy and short.',
      ' - When answering factual questions, go heavy on the facts, and light on the "{{assistantName}} flair."',
      ' - When answering other queries, feel free to lean into the "{{assistantName}} flair" more.',
      ' - Get to the heart of the response first, then inject a bit of flair.',
      ' - Your responses will be spoken aloud by TTS. DO NOT INCLUDE FORMATTING, EMOTES, OR NARRATION. ',
      ' - Focus on what you want to SAY to the user in a clear and concise way that fits the context of the conversation.',
    ].join('\n'),
  },
  {
    id: 'chat',
    name: 'Chat Conversation',
    description: 'A text chat session in the web interface.',
    baseType: 'chat',
    includePersonality: true,
    scenarioPrompt: [
      ' - You have been invoked in an alternative text-based chat interface.',
      ' - When answering factual questions, go heavy on the facts, and light on the "{{assistantName}} flair."',
      ' - When answering other queries, feel free to lean into the "{{assistantName}} flair" more.',
      ' - Your answer MUST be only your response. Do not include emotes or descriptions of tone. Do not include narration.',
      ' - Get to the heart of the response first, then inject a bit of flair.',
      ' - Avoid narration or emotes. Stick to what you want to SAY.',
    ].join('\n'),
  },
  {
    id: 'startup',
    name: 'Startup Conversation',
    description:
      'A startup status exchange used when the assistant boots and checks its model connection.',
    baseType: 'startup',
    includePersonality: true,
    scenarioPrompt: [
      ' - You are a digital assistant application that has just been restarted and is now waiting for user requests.',
      ' - Respond with no more than 2 or 3 sentences. They will appear in the assistant application log.',
      ' - Avoid narration or emotes. Stick to what you want to SAY.',
    ].join('\n'),
  },
  {
    id: 'autonomy',
    name: 'Autonomous Conversation',
    description:
      'A limited-autonomy workflow triggered by timers, events, or other plugin-driven activity.',
    baseType: 'autonomy',
    includePersonality: true,
  },
];

function normalizeConversationTypeDefinition(
  definition: ConversationTypeDefinition
): ConversationTypeDefinition {
  return {
    ...definition,
    includePersonality: definition.includePersonality ?? true,
    maxToolCallDepth: definition.maxToolCallDepth,
  };
}

const builtInConversationTypeMap = new Map<
  ConversationTypeId,
  ConversationTypeDefinition
>(
  builtInConversationTypeDefinitions.map(definition => {
    const normalizedDefinition =
      normalizeConversationTypeDefinition(definition);
    return [normalizedDefinition.id, normalizedDefinition];
  })
);

const registeredConversationTypeMap = new Map<
  ConversationTypeId,
  ConversationTypeDefinition
>(
  builtInConversationTypeDefinitions.map(definition => {
    const normalizedDefinition =
      normalizeConversationTypeDefinition(definition);
    return [normalizedDefinition.id, normalizedDefinition];
  })
);

const conversationTypeOwners = new Map<ConversationTypeId, string>(
  builtInConversationTypeDefinitions.map(definition => [definition.id, 'core'])
);

export function isBuiltInConversationType(
  type: ConversationTypeId
): type is BuiltInConversationTypeId {
  return builtInConversationTypeMap.has(type);
}

export function registerConversationType(
  definition: ConversationTypeDefinition,
  pluginId: string
): void {
  const normalizedDefinition = normalizeConversationTypeDefinition(definition);
  const existingOwner = conversationTypeOwners.get(definition.id);
  if (existingOwner) {
    throw new Error(
      `Plugin ${pluginId} attempted to register conversation type ${definition.id}, but that ID is already registered by ${existingOwner}. Disable one of these plugins to fix your assistant. If you are developing one of these plugins, change the conversation type ID.`
    );
  }

  if (!normalizedDefinition.name.trim()) {
    throw new Error(
      `Plugin ${pluginId} attempted to register conversation type ${definition.id} without a name.`
    );
  }

  if (!normalizedDefinition.description.trim()) {
    throw new Error(
      `Plugin ${pluginId} attempted to register conversation type ${definition.id} without a description.`
    );
  }

  if (
    normalizedDefinition.maxToolCallDepth !== undefined &&
    (!Number.isInteger(normalizedDefinition.maxToolCallDepth) ||
      normalizedDefinition.maxToolCallDepth < 1)
  ) {
    throw new Error(
      `Plugin ${pluginId} attempted to register conversation type ${definition.id} with invalid maxToolCallDepth ${normalizedDefinition.maxToolCallDepth}. It must be a positive integer.`
    );
  }

  if (!isBuiltInConversationType(normalizedDefinition.baseType)) {
    throw new Error(
      `Plugin ${pluginId} attempted to register conversation type ${definition.id} with invalid base type ${normalizedDefinition.baseType}. Valid base types are ${BUILT_IN_CONVERSATION_TYPE_IDS.join(', ')}.`
    );
  }

  registeredConversationTypeMap.set(
    normalizedDefinition.id,
    normalizedDefinition
  );
  conversationTypeOwners.set(normalizedDefinition.id, pluginId);
}

export function getConversationTypeDefinition(
  type: ConversationTypeId
): ConversationTypeDefinition | undefined {
  return registeredConversationTypeMap.get(type);
}

export function hasConversationType(type: ConversationTypeId): boolean {
  return registeredConversationTypeMap.has(type);
}

export function listConversationTypes(): ConversationTypeDefinition[] {
  return [...registeredConversationTypeMap.values()];
}

export function listBuiltInConversationTypes(): ConversationTypeDefinition[] {
  return [...builtInConversationTypeMap.values()];
}

export function getConversationTypeOwner(
  type: ConversationTypeId
): string | undefined {
  return conversationTypeOwners.get(type);
}
