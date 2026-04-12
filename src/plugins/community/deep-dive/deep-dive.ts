import type { AlicePlugin } from '../../../lib.js';
import { Type } from 'typebox';
import { writeFile } from 'node:fs/promises';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'deep-dive': Record<string, never>;
  }
}

const DEEP_DIVE_SCENARIO_PROMPT =
  'You are an autonomous deep-dive research agent. Your only job is to research a ' +
  'question thoroughly using the tools available to you.\n\n' +
  'RESEARCH PROCESS:\n' +
  '1. Start by searching for the topic using webSearch.\n' +
  '2. For each promising result, use simpleFetch to read the page content in full.\n' +
  '3. After each significant finding or completed search batch, call agentReportProgress ' +
  'with a brief summary of what you found.\n' +
  '4. Repeat searches with refined queries to dig deeper. Follow the most relevant links.\n' +
  '5. When you have built a complete picture — or after exhausting the most useful leads — ' +
  'call agentReturnResult with your full findings.\n\n' +
  'RULES:\n' +
  '- Do NOT address the user or ask questions. You are operating autonomously.\n' +
  '- Do NOT generate content from memory alone. Ground every claim in sources you fetched.\n' +
  '- If a fetch fails, try the next most relevant URL rather than stopping.\n' +
  '- Aim for depth over breadth: fewer thorough reads beat many shallow ones.\n\n' +
  'OUTPUT FORMAT for agentReturnResult.report (markdown):\n' +
  '## Key Findings\n' +
  'Bullet-point list of the most important conclusions.\n\n' +
  '## Details\n' +
  'Expanded narrative with supporting evidence and citations.\n\n' +
  '## Sources\n' +
  'List of URLs actually read, one per line.\n\n' +
  '## Gaps\n' +
  'What would further research benefit from that you were unable to cover.';

const deepDivePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'deep-dive',
    name: 'Deep-Dive Research Agent',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'Provides a session-linked Deep-Dive Research Agent the assistant can dispatch ' +
      'to do in-depth autonomous web research on a topic, reporting findings back into ' +
      'the chat as it goes.',
    dependencies: [
      { id: 'agents', version: 'LATEST' },
      { id: 'web-search-broker', version: 'LATEST' },
      { id: 'web-simple-fetch', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    plugin.registerConversationType({
      id: 'deep-dive-research',
      name: 'Deep-Dive Research Session',
      description:
        'An autonomous research conversation where the agent searches the web, ' +
        'fetches pages, and compiles findings without user interaction.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: DEEP_DIVE_SCENARIO_PROMPT,
      maxToolCallDepth: 40,
    });

    // Wire the framework tools from the agents plugin into this conversation type
    plugin.addToolToConversationType(
      'deep-dive-research',
      'agents',
      'agentReportProgress'
    );
    plugin.addToolToConversationType(
      'deep-dive-research',
      'agents',
      'agentReturnResult'
    );

    // Wire web tools into this conversation type
    plugin.addToolToConversationType(
      'deep-dive-research',
      'web-search-broker',
      'webSearch'
    );
    plugin.addToolToConversationType(
      'deep-dive-research',
      'web-simple-fetch',
      'simpleFetch'
    );

    // Wire lightpanda if it is enabled (optional)
    plugin.addToolToConversationType(
      'deep-dive-research',
      'lightpanda-browser',
      'lightpandaFetch'
    );

    const { autoStartTool } = plugin.registerSessionLinkedAgent({
      id: 'deep-dive',
      name: 'Deep-Dive Research Agent',
      conversationType: 'deep-dive-research',
      continuationPrompt:
        'Keep researching. Run refined searches, fetch high-value sources, and report major findings with agentReportProgress. ' +
        'Call agentReturnResult once coverage is strong enough to answer the question with evidence.',
      forceReturnPrompt:
        'Research loop budget is exhausted. Call agentReturnResult now with the best complete report you can produce from gathered evidence, including uncertainties and gaps.',

      startToolName: 'startDeepDiveResearch',
      startToolAvailableFor: ['chat'],
      startToolDescription:
        'Use startDeepDiveResearch when the user wants an in-depth investigation of a ' +
        'topic that would require many web searches and page reads — more than the assistant ' +
        'can reasonably handle in a single turn. The agent will research autonomously and ' +
        'report its findings back into the conversation.',
      startToolParameters: Type.Object({
        researchQuestion: Type.String({
          description:
            'The specific question or topic to research. Be precise — this becomes the ' +
            "agent's primary directive.",
        }),
        seedUrls: Type.Optional(
          Type.Array(Type.String({ format: 'uri' }), {
            description:
              'Optional list of URLs the agent should read first before branching out.',
          })
        ),
        focusAreas: Type.Optional(
          Type.String({
            description:
              'Optional comma-separated list of sub-topics or angles the agent should ' +
              'make sure to cover.',
          })
        ),
      }),
      startToolSystemPromptFragment:
        'Use startDeepDiveResearch when the user asks for thorough research on a topic ' +
        'that would require many searches and page reads. The agent runs in the background ' +
        'and reports progress and a final result in subsequent messages.',
      startToolResultPromptOutro:
        'Let the user know that the Deep-Dive Research Agent has started and will report ' +
        'back with findings.',

      buildStartup: async args => {
        const typedArgs = args as {
          researchQuestion: string;
          seedUrls?: string[];
          focusAreas?: string;
        };

        const contextParts: string[] = [
          `Research question: ${typedArgs.researchQuestion}`,
        ];
        if (typedArgs.seedUrls && typedArgs.seedUrls.length > 0) {
          contextParts.push(
            `Seed URLs to read first: ${typedArgs.seedUrls.join(', ')}`
          );
        }
        if (typedArgs.focusAreas) {
          contextParts.push(`Focus areas: ${typedArgs.focusAreas}`);
        }

        return {
          agentContextPrompt: contextParts.join('\n'),
          kickoffUserMessage: `Please research the following question in depth: ${typedArgs.researchQuestion}`,
        };
      },

      buildResult: async (rawResult, startArgs) => {
        const typedArgs = startArgs as { researchQuestion: string };

        const dateStr = new Date().toISOString().split('T')[0];
        const slug = typedArgs.researchQuestion
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60);
        const filename = `deep-dive-${slug}-${dateStr}.md`;
        const expandedPath = simpleExpandTilde(`~/${filename}`);

        const fileContent =
          `# Deep-Dive Research: ${typedArgs.researchQuestion}\n\n` +
          `*Date: ${dateStr}*\n\n` +
          `**Summary:** ${rawResult.summary}\n\n` +
          `${rawResult.report}\n`;

        let savedPath: string | null = null;
        try {
          await writeFile(expandedPath, fileContent, 'utf-8');
          savedPath = expandedPath;
        } catch (writeError) {
          console.error(
            'Deep-dive plugin: Failed to write research report:',
            writeError
          );
        }

        return {
          handbackMessage: savedPath
            ? `Deep-dive research complete. The full report has been saved to ~/${filename}.`
            : 'Deep-dive research complete. (Note: the report file could not be saved.)',
          outputText: rawResult.report,
          outputArtifacts: savedPath ? [savedPath] : [],
        };
      },
    });

    plugin.registerTool(autoStartTool);
  },
};

export default deepDivePlugin;
