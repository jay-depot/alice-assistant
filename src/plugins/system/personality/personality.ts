import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { AlicePlugin } from '../../../lib.js';
import { getConversationTypeDefinition } from '../../../lib/conversation-types.js';
import {
  getActivePersonalityProviderOverrideOwner,
  PersonalityRenderContext,
  registerFallbackPersonalityProvider,
} from '../../../lib/personality-system.js';
import { UserConfig } from '../../../lib/user-config.js';

type PersonalitySections = Record<string, string>;

function getPersonalityDirectoryPath(): string {
  return path.join(UserConfig.getConfigPath(), 'personality');
}

async function loadPersonalitySections(): Promise<PersonalitySections> {
  const personalityDirectoryPath = getPersonalityDirectoryPath();
  const directoryEntries = await readdir(personalityDirectoryPath, {
    withFileTypes: true,
  });
  const personalityFiles = directoryEntries
    .filter(
      entry =>
        entry.isFile() && path.extname(entry.name).toLowerCase() === '.md'
    )
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const sections: PersonalitySections = {};
  for (const fileName of personalityFiles) {
    const filePath = path.join(personalityDirectoryPath, fileName);
    const fileContents = await readFile(filePath, 'utf-8');
    const key = path
      .parse(fileName)
      .name.replace(/[_-]/g, ' ')
      .toLocaleUpperCase();
    sections[key] = fileContents;
  }

  return sections;
}

async function renderPersonalityPrompt(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: PersonalityRenderContext
): Promise<string> {
  const personalitySections = await loadPersonalitySections();
  const promptSections: string[] = [];

  promptSections.push('# PC DIGITAL ASSISTANT PERSONALITY AND SYSTEM INFO');

  if (personalitySections.INTRO) {
    promptSections.push(`## INTRODUCTION\n${personalitySections.INTRO}`);
  }

  if (personalitySections.QUIRKS) {
    promptSections.push(`## PERSONALITY QUIRKS\n${personalitySections.QUIRKS}`);
  }

  Object.keys(personalitySections)
    .filter(key => key !== 'INTRO' && key !== 'QUIRKS')
    .forEach(key => {
      promptSections.push(`## ${key}\n${personalitySections[key]}`);
    });

  return promptSections.join('\n\n');
}

const personalityPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'personality',
    name: 'Personality',
    brandColor: '#389c96',
    description:
      'Provides the assistant personality prompt by reading the configured personality markdown files and rendering them into the system prompt.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    registerFallbackPersonalityProvider('personality', {
      renderPrompt: renderPersonalityPrompt,
    });

    plugin.registerHeaderSystemPrompt({
      name: 'personality',
      weight: -9999,
      getPrompt: async context => {
        if (getActivePersonalityProviderOverrideOwner()) {
          return false;
        }

        const conversationTypeDefinition = getConversationTypeDefinition(
          context.conversationType
        );
        if (conversationTypeDefinition?.includePersonality === false) {
          return false;
        }

        return await renderPersonalityPrompt({
          purpose: 'conversation-header',
          conversationType: context.conversationType,
          sessionId: context.sessionId,
        });
      },
    });
  },
};

export default personalityPlugin;
