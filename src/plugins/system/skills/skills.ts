import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    skills: {
      registerSkill: (skill: RegisteredSkill) => void;
      registerSkillFile: (path: string) => void;
    };
  }
}

export type RegisteredSkill = {
  id: string;
  recallWhen: string;
  contents: string;
};

const RecallSkillParametersSchema = Type.Object({
  skillId: Type.String({
    description:
      'The id of the skill to recall. This should be a skill that has been registered to you by one of your plugins.',
  }),
});

export type RecallSkillParameters = Type.Static<
  typeof RecallSkillParametersSchema
>;

const SkillsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'skills',
    name: 'Skills Plugin',
    brandColor: '#a65827',
    description:
      'Allows plugins to register discrete skills that the assistant can ' +
      'invoke in response to user requests. Skills are text or markdown snippets with ' +
      'additional information intended to help the assistant carry out specific tasks. ' +
      'This plugin itself does not provide any skills, but serves as a registry and ' +
      'interface for other plugins to add their skills to. This plugin usually only ' +
      'works well with a fairly large context window.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const skillsRegistry: RegisteredSkill[] = [];

    function registerSkill(skill: RegisteredSkill) {
      if (skillsRegistry.find(s => s.id === skill.id)) {
        throw new Error(
          `A skill with id ${skill.id} is already registered. Skill ids must be unique. Please change the id of the skill you are trying to register.`
        );
      }
      skillsRegistry.push(skill);
    }

    async function registerSkillFile(path: string) {
      // This one's harder. We need to load a markdown file, and parse it into the skill format. The markdown file should have a specific structure, with metadata at the top and the content below.
      const fs = await import('fs/promises');
      const fileContents = await fs.readFile(path, 'utf-8');
      const [metadataSection, ...contentSections] = fileContents
        .split('---')
        .map(s => s.trim());
      if (!metadataSection || contentSections.length === 0) {
        throw new Error(
          `Skill file at ${path} is not properly formatted. It should have a metadata section and a content section, separated by '---'.`
        );
      }

      let metadata: { id: string; recallWhen: string };
      try {
        metadata = JSON.parse(metadataSection);
      } catch (e) {
        throw new Error(
          `Failed to parse metadata section of skill file at ${path} as JSON. Error: ${(e as Error).message}`,
          { cause: e }
        );
      }

      const content = contentSections.join('\n---\n').trim();
      if (!metadata.id || !metadata.recallWhen || !content) {
        throw new Error(
          `Skill file at ${path} is missing required fields. Metadata must include 'id' and 'recallWhen', and there must be content after the metadata section.`
        );
      }

      registerSkill({
        id: metadata.id,
        recallWhen: metadata.recallWhen,
        contents: content,
      });
    }

    plugin.offer({
      registerSkill,
      registerSkillFile,
    });

    plugin.registerTool({
      name: 'recallSkill',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Recall one of your known skills, of which you should have a list available elsewhere. Call this tool with the id of the skill you wish to recall whenever the conditions under which you should recall it are met.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: RecallSkillParametersSchema,
      execute: async (args: RecallSkillParameters) => {
        const skill = skillsRegistry.find(s => s.id === args.skillId);
        if (!skill) {
          return `No skill with id ${args.skillId} found. Please check that the id is correct and that the skill has been registered properly.`;
        }
        return skill.contents;
      },
    });

    plugin.registerHeaderSystemPrompt({
      name: 'skills',
      weight: 50,
      getPrompt: context => {
        if (context.conversationType === 'startup') {
          return false;
        }

        if (skillsRegistry.length === 0) {
          return false;
        }

        const skillPrompt = [
          `Recall any appropriate skills proactively whenever you judge them relevant to the current task or topic.`,
          `You have the following skills available:\n`,
        ];
        skillsRegistry.forEach(skill => {
          skillPrompt.push(
            `- **${skill.id}:** recall ${skill.id} when ${skill.recallWhen}`
          );
        });

        return skillPrompt.join('\n');
      },
    });
  },
};

export default SkillsPlugin;
