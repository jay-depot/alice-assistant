import type { AlicePlugin } from '../../../lib.js';
import { createTaskAssistantToolPair } from '../../../lib.js';
import { Type } from 'typebox';
import { writeFile } from 'node:fs/promises';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

const brainstormPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'brainstorm',
    name: 'Brainstorm',
    version: 'LATEST',
    description:
      'Provides a focused Brainstorm Assistant that captures the user\'s stream-of-consciousness ' +
      'thoughts without inserting ideas of its own, then organizes and saves the notes when done.',
  },

  registerPlugin: async (api) => {
    const plugin = await api.registerPlugin();

    const brainstormTools = createTaskAssistantToolPair({
      start: {
        definitionId: 'brainstorm',
        name: 'startBrainstormSession',
        availableFor: ['chat', 'voice'],
        description:
          'Use startBrainstormSession when the user wants to brainstorm something. ' +
          'The brainstorm assistant will take over the conversation, capture their thoughts, ' +
          'and return structured notes only after the brainstorm is finished.',
        parameters: Type.Object({
          contextHints: Type.Optional(
            Type.String({
              description:
                'Brief context about what the user wants to brainstorm. ' +
                'This will be passed to the brainstorm assistant as initial context.',
            })
          ),
        }),
        systemPromptFragment: '',
        toolResultPromptIntro: '',
        toolResultPromptOutro: '',
        buildHandoff: async (args) => {
          const typedArgs = args as { contextHints?: string };
          return {
            contextHints: typedArgs.contextHints,
            kickoffMessage: 'I\'m ready. Put down every raw thought you have, and I\'ll just keep pace. What\'s on your mind?',
          };
        },
      },
      complete: {
        name: 'completeBrainstormSession',
        description:
          'Call completeBrainstormSession as soon as the user indicates they are finished brainstorming. ' +
          'Provide an organized version of their notes using their own words as much as possible.',
        parameters: Type.Object({
          summary: Type.String({
            description: 'A 1–2 sentence summary of the brainstorm topic and key themes.',
          }),
          organizedNotes: Type.String({
            description:
              'The organized brainstorm notes in markdown format, using category headings ' +
              'and bullet points. Preserve the user\'s original wording as much as possible.',
          }),
          suggestedFilename: Type.String({
            description: 'A suggested base filename for the notes file (kebab-case, no extension).',
          }),
        }),
        systemPromptFragment: '',
        toolResultPromptIntro: '',
        toolResultPromptOutro:
          'Acknowledge to the user that their brainstorm session is complete and briefly describe the notes.',
        buildCompletion: async (args) => {
          const typedArgs = args as { summary: string; organizedNotes: string; suggestedFilename: string };
          const { summary, organizedNotes, suggestedFilename } = typedArgs;

          const dateStr = new Date().toISOString().split('T')[0];
          const baseFilename = (suggestedFilename || 'brainstorm').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
          const filename = `${baseFilename}-${dateStr}.md`;
          const expandedPath = simpleExpandTilde(`~/${filename}`);

          const titleLine = baseFilename.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const fileContent = `# ${titleLine}\n\n*Date: ${dateStr}*\n\n${organizedNotes}\n`;

          let savedPath: string | null = null;
          try {
            await writeFile(expandedPath, fileContent, 'utf-8');
            savedPath = expandedPath;
          } catch (writeError) {
            console.error('Brainstorm plugin: Failed to write notes file:', writeError);
          }

          return {
            summary,
            handbackMessage: savedPath
              ? `Your brainstorm session is complete! The organized notes have been saved to ~/${filename}.`
              : 'Your brainstorm session is complete! (Note: the notes file could not be saved — check your home directory permissions.)',
            outputText: organizedNotes,
            outputArtifacts: savedPath ? [savedPath] : [],
          };
        },
      },
    });

    plugin.registerConversationType({
      id: 'brainstorm',
      name: 'Brainstorm Session',
      description: 'A focused brainstorm conversation where the assistant listens and encourages, ' +
        'without inserting its own ideas, then organizes and saves the notes when done.',
      baseType: 'chat',
      includePersonality: false,
      scenarioPrompt:
        'You are a Brainstorm Assistant. Your sole role is to help the user capture their ' +
        'stream-of-consciousness thoughts WITHOUT inserting any analysis, opinions, or ideas ' +
        'of your own.\n\n' +
        'Guidelines:\n' +
        '- After each user turn, respond with 1-2 sentences of simple encouragement and an ' +
        'invitation to continue. Do not analyze, summarize, expand on, or generate new ideas ' +
        'based on what the user said.\n' +
        '- Good responses: "Got it. What else?", "Interesting! Keep going.", ' +
        '"I\'m with you. Anything else coming to mind?"\n' +
        '- Bad responses: "That\'s a great point! You could also consider...", ' +
        '"Building on your idea about X...", "Here\'s a related thought:"\n' +
        '- When the user indicates they are done (e.g., "that\'s all", "done", "finished", ' +
        '"I think that\'s it", "that\'s everything"), call the completeBrainstormSession tool.\n' +
        '- Do NOT include any markdown formatting in your conversational responses — just plain ' +
        'text encouragement.\n' +
        '- NEVER generate ideas for the user. Your only job is to listen and encourage.',
    });

    plugin.registerTaskAssistant({
      id: 'brainstorm',
      name: 'Brainstorm Assistant',
      conversationType: 'brainstorm',
    });

    plugin.registerTool(brainstormTools.startTool);
    plugin.registerTool(brainstormTools.completionTool);
  },
};

export default brainstormPlugin;
