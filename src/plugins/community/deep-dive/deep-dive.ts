import type { AlicePlugin } from '../../../lib.js';
import { Type } from 'typebox';
import { writeFile } from 'node:fs/promises';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';
import path from 'node:path';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'deep-dive': Record<string, never>;
  }
}

const DeepDiveManageSourceToolParameterSchema = Type.Object({
  url: Type.String({
    format: 'uri',
    description: 'The URL of the source to manage.',
  }),
  status: Type.Enum(['to-visit', 'visited', 'blocked'], {
    description: 'The status to assign to this source.',
  }),
});

type DeepDiveManageSourceToolParameters = Type.Static<
  typeof DeepDiveManageSourceToolParameterSchema
>;

const DEEP_DIVE_SCENARIO_PROMPT =
  'You are an autonomous deep-dive research agent. Your only job is to research a ' +
  'question or topic thoroughly using the tools available to you.\n\n' +
  'RESEARCH PROCESS:\n' +
  '1. Start by searching for the topic using webSearch.\n' +
  '2. Use your deepDiveManageSource tool to keep track of promising sources, marking them as "to-visit".\n' +
  '3. For each source on your tracker, use simpleFetch or an alternative tool to read the page content in full.\n' +
  '4. If you find more sources to explore while reading, add those URLs to your source tracker for processing in subsequent research steps.\n' +
  '5. After each significant finding or completed search batch, call agentReportProgress with a brief summary of what you found.\n' +
  '6. When you have exhausted a source, use deepDiveManageSource to mark it as "visited" on your tracker to avoid redundant work.\n' +
  '7. Repeat searches with refined queries to dig deeper. Follow the most relevant links.\n' +
  '8. When you have built a complete picture — or after exhausting the most useful leads — call agentReturnResult with your full findings.\n' +
  '9. If you have access to skills or proficiencies that could help you evaluate sources or provide alternative ways to access a source, use recallSkill and/or recallProficiency to leverage that knowledge.\n' +
  '10. When all else fails, if you are unable to access a source on your list, use updateProficiency to note that you are "blocked" on that source, and move on to the next most promising lead.\n\n' +
  'RULES:\n' +
  '- Do NOT address the user or ask questions. You are operating autonomously.\n' +
  '- Do NOT generate content from memory alone. Ground every claim in sources you fetched.\n' +
  '- If a fetch fails, check your skills, proficiencies, and alternative tools for a work-around before trying the next most relevant URL rather than stopping.\n' +
  '- Aim for depth over breadth: fewer thorough reads beat many shallow ones.\n\n' +
  'OUTPUT FORMAT for agentReturnResult.report (markdown):\n' +
  '## Key Findings\n' +
  'Bullet-point list of the most important conclusions.\n\n' +
  '## Details\n' +
  'Expanded narrative with supporting evidence and citations.\n\n' +
  '## Sources\n' +
  '### Sources Consulted:\n' +
  'Numbered list of URLs actually read, one per line.' +
  '### Sources Attempted but Inaccessible:\n' +
  'Numbered list of URLs you were unable to access, one per line, with a brief note on why each source was inaccessible and what you tried.\n\n' +
  '## Gaps\n' +
  'What would further research benefit from that you were unable to cover.';

type SourceCache = {
  [sessionId: string]: {
    url: string;
    status: 'to-visit' | 'visited' | 'blocked';
  }[];
};

const sourceCache: SourceCache = {};

const deepDivePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'deep-dive',
    name: 'Deep-Dive Research Agent',
    brandColor: '#b0b0b0',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'Provides a session-linked Deep-Dive Research Agent the assistant can dispatch ' +
      'to do in-depth autonomous web research on a topic, reporting findings back into ' +
      'the chat as it goes.',
    dependencies: [
      { id: 'web-ui', version: 'LATEST' },
      { id: 'agents', version: 'LATEST' },
      { id: 'web-search-broker', version: 'LATEST' },
      { id: 'web-simple-fetch', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    const webUi = plugin.request('web-ui');

    webUi.registerStylesheet(path.join(import.meta.dirname, 'deep-dive.css'));

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

    // Wire in skills and proficiencies if they're enabled
    // Wire lightpanda if it is enabled (optional)
    plugin.addToolToConversationType(
      'deep-dive-research',
      'skills',
      'recallSkill'
    );
    plugin.addToolToConversationType(
      'deep-dive-research',
      'proficiencies',
      'recallProficiency'
    );
    plugin.addToolToConversationType(
      'deep-dive-research',
      'proficiencies',
      'updateProficiency'
    );

    const { autoStartTool } = plugin.registerSessionLinkedAgent({
      id: 'deep-dive',
      name: 'Deep-Dive Research Agent',
      conversationType: 'deep-dive-research',
      continuationPrompt:
        'Keep researching. Run refined searches, fetch high-value sources, and report major findings with agentReportProgress. ' +
        'Call agentReturnResult once coverage is strong enough to answer the question or fully explain the topic with evidence.',
      forceReturnPrompt:
        'Research loop budget is exhausted. Call agentReturnResult now with the best complete report you can produce from gathered evidence, including uncertainties and gaps.',

      startToolName: 'startDeepDiveResearch',
      startToolAvailableFor: ['chat'],
      startToolDescription:
        'Use startDeepDiveResearch when the user wants an in-depth investigation of a ' +
        'topic that would require many web searches and page reads — more than the assistant ' +
        'can reasonably handle in a single turn. The agent will research autonomously and ' +
        'report its findings back into the conversation. Also use startDeepDiveResearch if ' +
        'the user specifically asks for a "deep dive" or "deep research" on a topic.',
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
          plugin.logger.error(
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

    plugin.registerTool({
      name: 'deepDiveManageSource',
      description:
        'Call deepDiveManageSource when you want to track a source for your research, to mark it as "to visit" or "visited". Use this proactively to help keep your research organized.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: DeepDiveManageSourceToolParameterSchema,
      availableFor: ['deep-dive-research'],
      execute: async (
        parameters: DeepDiveManageSourceToolParameters,
        context
      ) => {
        const { agentInstanceId, sessionId } = context;

        if (!agentInstanceId) {
          return 'No active agent instance found. Source status not recorded.';
        }

        if (!sourceCache[sessionId]) {
          sourceCache[sessionId] = [];
        }

        const existingIndex = sourceCache[sessionId].findIndex(
          entry => entry.url === parameters.url
        );

        if (existingIndex !== -1) {
          sourceCache[sessionId][existingIndex].status = parameters.status;
        } else {
          sourceCache[sessionId].push({
            url: parameters.url,
            status: parameters.status,
          });
        }

        return `Source ${parameters.url} marked as ${parameters.status}.`;
      },
    });

    plugin.registerFooterSystemPrompt({
      name: 'Deep-Dive Research Agent Source Tracker',
      weight: 10,
      getPrompt(context) {
        if (context.conversationType !== 'deep-dive-research') {
          return false;
        }

        const { sessionId } = context;
        if (!sessionId || !sourceCache[sessionId]) {
          return 'No sources tracked yet.';
        }

        const sources = sourceCache[sessionId];
        if (sources.length === 0) {
          return 'No sources tracked yet.';
        }

        const lines = sources.map(
          entry => `- [${entry.status === 'visited' ? 'x' : ' '}] ${entry.url}`
        );
        return `## Tracked Sources\n${lines.join('\n')}`;
      },
    });
  },
};

export default deepDivePlugin;
