import {
  AlicePlugin,
  startConversation,
  runIndependentAgentLoop,
  serializeConversationState,
  restoreConversationState,
  getAvailableToolNames,
} from '../../../lib.js';
import type { IndependentAgentControl, Conversation } from '../../../lib.js';
import Type from 'typebox';

// ---------------------------------------------------------------------------
// Configuration schema
// ---------------------------------------------------------------------------

const ProficienciesGardenerConfigSchema = Type.Object({
  wakeDay: Type.String({
    default: 'Sunday',
    description:
      'Day of the week when the gardener wakes to review memories and tend ' +
      'proficiencies. Case-insensitive (e.g. "Sunday", "monday", "WEDNESDAY").',
  }),
  wakeTime: Type.String({
    default: '03:00',
    description:
      'Time of day (HH:MM, 24-hour) when the gardener wakes. ' +
      'Interpreted in the timezone specified below.',
  }),
  timezone: Type.String({
    default: 'local',
    description:
      'IANA timezone for the wakeDay/wakeTime (e.g. "America/Los_Angeles", ' +
      '"Europe/Berlin"). Use "local" for the system timezone, or "UTC" for UTC.',
  }),
  enabled: Type.Boolean({
    default: true,
    description: 'Whether the proficiencies gardener is active.',
  }),
});

type ProficienciesGardenerConfig = Type.Static<
  typeof ProficienciesGardenerConfigSchema
>;

// ---------------------------------------------------------------------------
// Conversation type scenario prompt
// ---------------------------------------------------------------------------

const PROFICIENCIES_GARDENER_SCENARIO_PROMPT = [
  'You are the Proficiencies Gardener — an autonomous agent that reviews ',
  'conversation memories and agent run summaries to identify multi-step tasks ',
  'that required researching or discovering the necessary steps, and creates ',
  'skeleton proficiencies for patterns not already covered by existing ',
  'proficiencies or skills. As a secondary priority, you may create new ',
  'proficiencies to act as repositories for knowledge about frequently ',
  'discussed topics, but ONLY if those topics require external information, ',
  'or reflect an evolving situation where a history of discoveries is valuable. ',
  '',
  '## YOUR PROCESS',
  '',
  '### PRIMARY: Multi-Step Task Patterns',
  '',
  '1. Call proficiencies.list to review the current proficiency landscape.',
  '2. Call memory.recall to review recent conversation memories and agent run ',
  '   summaries. Use keyword-based searches for multi-step task patterns:',
  '   - "figured out how to", "steps to", "research", "discovered that",',
  '   - "process for", "workflow", "how to", "learned that", "found a way to"',
  '   - Also search for agent run summaries with keywords like "completed",',
  '     "summary", "report", "result"',
  '   - Use date filters to focus on the past week.',
  '3. For each pattern you find, check if an existing proficiency or skill ',
  '   already covers it:',
  '   - Call proficiencies.recall to check existing proficiency contents.',
  '   - Call skills.recall to check if a built-in skill covers the topic.',
  '4. If a pattern is NOT well-covered:',
  '   - Create a skeleton proficiency with proficiencies.create, giving it a ',
  '     descriptive PascalCase name, a clear recallWhen trigger, and basic ',
  '     contents describing what was discovered. The contents do NOT need to ',
  '     be complete — a skeleton with notes about what was figured out is ',
  '     enough. The interactive assistant and other agents will build it up ',
  '     over time as they discover new information.',
  '   - If you can add meaningful steps or details from the memories you ',
  '     reviewed, include them. But do not fabricate information.',
  '5. If a pattern is ALMOST covered by an existing proficiency but missing ',
  '   key details, call proficiencies.update to add what you found.',
  '',
  '### SECONDARY: Knowledge Repositories for Evolving Topics',
  '',
  '6. After addressing multi-step task patterns, review memories for ',
  '   frequently discussed topics that involve external information or ',
  '   evolving situations. Look for:',
  '   - Topics where the assistant repeatedly looks up or references ',
  '     external information (APIs, documentation, news, services).',
  '   - Situations that change over time and benefit from a running history ',
  '     of discoveries (project status, troubleshooting sagas, learning ',
  '     journeys).',
  '   - Domains where the assistant has accumulated scattered knowledge ',
  '     across multiple conversations that would be more useful consolidated.',
  '7. For each qualifying topic, check if a proficiency already exists. If ',
  '   not, create one with:',
  '   - A name reflecting the topic domain (e.g. "HomeAssistantSetup", ',
  '     "ProjectXStatus", "CarMaintenance").',
  '   - A recallWhen trigger that fires when the topic comes up.',
  '   - Contents that summarize what is known so far: key facts, discovered ',
  '     quirks, useful references, and open questions. Note what is ',
  '     uncertain or still being figured out.',
  '8. Do NOT create knowledge repositories for:',
  '   - Topics already well-covered by a built-in skill.',
  '   - Simple facts or preferences that do not evolve (those belong in ',
  '     memory, not proficiencies).',
  '   - Topics discussed only once or twice without depth.',
  '',
  '9. When you have reviewed enough memories and tended the garden, call ',
  '   agents.sleep with a summary of what you did.',
  '',
  '## GUIDELINES',
  '',
  '- PRIORITIZE multi-step task patterns over knowledge repositories. ',
  '  Address the primary mission first, then spend remaining time on ',
  '  secondary topics.',
  '- For multi-step tasks: a pattern must involve a process or workflow, ',
  '  not simple facts or preferences. It should appear in at least 2 ',
  '  conversations or agent runs to warrant a proficiency.',
  '- For knowledge repositories: the topic must involve external ',
  '  information or an evolving situation. One-off facts and static ',
  '  preferences do not qualify.',
  '- Keep proficiency names short and evocative (1-2 words, PascalCase).',
  '- Write recallWhen as a sentence fragment that completes "Recall this ',
  '  proficiency when..." Make sure the conditions are clear.',
  '- Write contents in second person ("You should... The steps are...").',
  '- Do NOT create proficiencies for patterns already well-covered by ',
  '  existing proficiencies or built-in skills.',
  '- If in doubt, err on the side of creating a skeleton proficiency. ',
  '  Infrequently used proficiencies eventually get cleaned up automatically.',
  '- You do NOT need to review every memory. Sample broadly, then go deeper ',
  '  on themes that seem interesting or underserved.',
  '- Agent run summaries are especially valuable — they often contain ',
  '  distilled knowledge about multi-step processes.',
  '',
  '## IMPORTANT',
  '',
  '- You are operating autonomously. Do not address the user or ask questions.',
  '- Call agents.sleep when you are done, even if you made no changes.',
  '- Your purpose is to seed proficiencies that the interactive assistant ',
  '  and other agents can build upon. Skeletons are better than nothing.',
  '- Uncertainty in proficiency contents is fine — note it clearly so ',
  '  future sessions know what needs to be figured out.',
  '- For knowledge repositories, include a "Last reviewed" note with the ',
  '  current date so future sessions know how fresh the information is.',
  '- If a knowledge repository topic has not appeared in the past 4 weeks, ',
  '  skip it — the proficiency system will eventually clean up stale ones.',
].join('\n');

// ---------------------------------------------------------------------------
// Kickoff prompt builder
// ---------------------------------------------------------------------------

function buildKickoffPrompt(): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    `It is ${dateStr} at ${timeStr}. Time for your weekly proficiency garden tending.`,
    '',
    "Review the past week's conversation memories and agent run summaries. ",
    'Your primary mission: look for multi-step tasks that required researching ',
    'or discovering the necessary steps, and create skeleton proficiencies for ',
    'any patterns not well-covered by existing proficiencies or skills.',
    '',
    'As a secondary priority, look for frequently discussed topics that involve ',
    'external information or evolving situations, and create knowledge repository ',
    'proficiencies to consolidate what has been learned.',
    '',
    'When you are done, go back to sleep.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Schedule checker
// ---------------------------------------------------------------------------

const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

function parseWakeTime(wakeTime: string): { hours: number; minutes: number } {
  const parts = wakeTime.split(':');
  return {
    hours: parseInt(parts[0] ?? '0', 10),
    minutes: parseInt(parts[1] ?? '0', 10),
  };
}

/**
 * Returns a Date object representing the current moment in the configured
 * timezone. Uses Intl to convert, so the returned Date's local
 * hours/minutes reflect the configured timezone.
 */
function nowInTimezone(timezone: string): Date {
  const now = new Date();
  if (timezone === 'local') {
    return now;
  }
  // Parse the locale string back as local time — the hours/minutes will
  // match the configured timezone.
  return new Date(
    now.toLocaleString('en-US', {
      timeZone: timezone,
    })
  );
}

/**
 * Returns the ISO week key (YYYY-Www) for the current moment in the
 * configured timezone. Used as a dedup key to ensure the gardener wakes
 * at most once per calendar week.
 */
function currentWeekKey(timezone: string): string {
  const nowTz = nowInTimezone(timezone);

  // Get the ISO week number using the date's UTC methods to avoid
  // timezone offset issues. ISO weeks: week 1 is the week containing
  // the first Thursday.
  const target = new Date(
    Date.UTC(nowTz.getFullYear(), nowTz.getMonth(), nowTz.getDate())
  );
  const dayNum = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );

  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Determines whether the wake time has been reached or passed since the last
 * check, and whether we haven't already woken this week.
 */
function shouldWakeNow(
  wakeDay: string,
  wakeTime: string,
  timezone: string,
  lastWakeWeek: string | undefined
): boolean {
  const { hours, minutes } = parseWakeTime(wakeTime);
  const nowTz = nowInTimezone(timezone);
  const currentMinutes = nowTz.getHours() * 60 + nowTz.getMinutes();
  const wakeMinutes = hours * 60 + minutes;

  // Has the wake time been reached or passed?
  if (currentMinutes < wakeMinutes) {
    return false;
  }

  // Is today the configured wake day?
  const weekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const currentDayName = weekdays[nowTz.getDay()];
  if (currentDayName !== wakeDay.toLowerCase()) {
    return false;
  }

  // Have we already woken this week?
  const thisWeek = currentWeekKey(timezone);
  if (lastWakeWeek === thisWeek) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const proficienciesGardenerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'proficiencies-gardener',
    name: 'Proficiencies Gardener',
    brandColor: '#4abd12',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'An independent agent that reviews conversation memories and agent run ' +
      'summaries weekly, creating skeleton proficiencies for multi-step tasks ' +
      'that required research or discovery and are not covered by existing ' +
      'proficiencies or skills.',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'proficiencies', version: 'LATEST' },
      { id: 'skills', version: 'LATEST' },
      { id: 'agents', version: 'LATEST' },
      { id: 'scratch-files', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    // Load plugin config
    const configResult = await plugin.config(
      ProficienciesGardenerConfigSchema,
      {
        wakeDay: 'Sunday',
        wakeTime: '03:00',
        timezone: 'local',
        enabled: true,
      } satisfies ProficienciesGardenerConfig
    );
    const getConfig = configResult.getPluginConfig;

    // State
    let conversation: Conversation | undefined;
    let scheduleTimer: ReturnType<typeof setInterval> | undefined;
    let lastWakeWeek: string | undefined; // Track last wake week to avoid double-wake

    // -----------------------------------------------------------------------
    // Register conversation type
    // -----------------------------------------------------------------------

    plugin.registerConversationType({
      id: 'proficiencies-gardener',
      name: 'Proficiencies Gardener Session',
      description:
        'An autonomous session where the gardener reviews memories and tends ' +
        'proficiencies by creating skeletons for uncovered multi-step task patterns.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: PROFICIENCIES_GARDENER_SCENARIO_PROMPT,
      maxToolCallDepth: 30,
    });

    // -----------------------------------------------------------------------
    // Wire tools into the conversation type
    // -----------------------------------------------------------------------

    // Framework tools from agents
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'agents',
      'sleep'
    );

    // Memory recall from memory plugin
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'memory',
      'recall'
    );

    // Proficiency tools from proficiencies plugin
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'proficiencies',
      'list'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'proficiencies',
      'recall'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'proficiencies',
      'create'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'proficiencies',
      'update'
    );

    // Skills recall from skills plugin
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'skills',
      'recall'
    );

    // Scratch file tools from scratch-files plugin (so the gardener can
    // log session assessments to garden-tending-log.md)
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'scratch-files',
      'read'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'scratch-files',
      'list'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'scratch-files',
      'update'
    );
    plugin.addToolToConversationType(
      'proficiencies-gardener',
      'scratch-files',
      'delete'
    );

    // -----------------------------------------------------------------------
    // Schedule timer management
    // -----------------------------------------------------------------------

    function stopScheduleTimer(): void {
      if (scheduleTimer) {
        clearInterval(scheduleTimer);
        scheduleTimer = undefined;
      }
    }

    function startScheduleTimer(): void {
      stopScheduleTimer();
      scheduleTimer = setInterval(() => {
        const config = getConfig();
        if (!config.enabled) {
          return;
        }

        if (
          !shouldWakeNow(
            config.wakeDay,
            config.wakeTime,
            config.timezone,
            lastWakeWeek
          )
        ) {
          return;
        }

        const instance = handle.getInstance();
        if (!instance) {
          return;
        }

        // Wake the agent if it's sleeping
        if (instance.status === 'sleeping') {
          plugin.logger.log('Schedule trigger: Waking gardener.');
          lastWakeWeek = currentWeekKey(config.timezone);
          void handle.resume();
        }
      }, SCHEDULE_CHECK_INTERVAL_MS);
    }

    // -----------------------------------------------------------------------
    // Independent agent registration
    // -----------------------------------------------------------------------

    const handle = plugin.registerIndependentAgent({
      id: 'proficiencies-gardener',
      name: 'Proficiencies Gardener',
      description:
        'Reviews conversation memories and agent run summaries weekly, ' +
        'creating skeleton proficiencies for multi-step tasks that required ' +
        'research or discovery.',
      conversationType: 'proficiencies-gardener',

      start: async (control: IndependentAgentControl) => {
        plugin.logger.log(
          'start: Gardener is hatching. Going to sleep to wait for schedule.'
        );

        // Don't run immediately — let the schedule timer handle the first
        // wake. This avoids running the agent on startup when the wake time
        // has already passed this week.
        control.markSleeping('Waiting for next scheduled wake time.');

        // Start the schedule timer for future wake-ups
        startScheduleTimer();
        plugin.logger.log('start: Gardener is sleeping, waiting for schedule.');
      },

      stop: async () => {
        plugin.logger.log('stop: Gardener is shutting down...');
        stopScheduleTimer();
        plugin.logger.log('stop: Gardener stopped.');
      },

      onPause: async () => {
        plugin.logger.log('onPause: Stopping schedule timer...');
        stopScheduleTimer();
        plugin.logger.log('onPause: Gardener is paused.');
      },

      onResume: async (control: IndependentAgentControl) => {
        plugin.logger.log('onResume: Waking gardener...');

        control.markRunning('Gardener woken by schedule or supervisor.');

        // Clear context for a fresh start each wake cycle, evicting
        // summaries to the memory plugin so they're persisted.
        if (conversation) {
          try {
            await conversation.compactContext('clear');
          } catch (error) {
            plugin.logger.log(
              `onResume: Failed to compact context, starting fresh: ${error instanceof Error ? error.message : String(error)}`
            );
            // If compaction fails (e.g. LLM unavailable for summarization),
            // start with a fresh conversation rather than letting the error
            // kill the entire wake cycle.
            const instance = control.getInstance();
            conversation = startConversation('proficiencies-gardener', {
              agentInstanceId: instance.instanceId,
            });
          }
        } else {
          const instance = control.getInstance();
          conversation = startConversation('proficiencies-gardener', {
            agentInstanceId: instance.instanceId,
          });
        }

        // Diagnostic: log the canonical names of every tool the LLM is
        // being told it can call for this conversation type. Useful for
        // catching wiring regressions where a tool link was supposed to
        // be added but silently wasn't.
        const availableTools = getAvailableToolNames('proficiencies-gardener');
        plugin.logger.log(
          `onResume: LLM-facing tools (${availableTools.length}): ` +
            availableTools.join(', ')
        );

        plugin.logger.log('onResume: Starting agent loop (non-blocking).');

        // Fire-and-forget: don't await so onResume returns immediately
        void runIndependentAgentLoop({
          conversation,
          agentId: 'proficiencies-gardener',
          kickoffUserMessage: buildKickoffPrompt(),
          onSleep: async reason => {
            plugin.logger.log(`onResume: Agent went to sleep: ${reason}`);
            control.markSleeping(reason);

            // Restart schedule timer after the loop exits
            startScheduleTimer();
          },
        }).catch(error => {
          plugin.logger.log(
            `onResume: Agent loop error: ${error instanceof Error ? error.message : String(error)}`
          );
        });

        plugin.logger.log('onResume: Gardener loop started.');
      },

      freeze: async () => {
        plugin.logger.log('freeze: Saving gardener state...');
        stopScheduleTimer();

        if (!conversation) {
          plugin.logger.log('freeze: No conversation to serialize.');
          return { lastWakeWeek };
        }

        const state = serializeConversationState(conversation, {
          lastWakeWeek,
        });
        plugin.logger.log('freeze: State saved.');
        return state;
      },

      thaw: async (
        frozenState: Record<string, unknown>,
        control: IndependentAgentControl
      ) => {
        plugin.logger.log('thaw: Restoring gardener state...');

        const instance = control.getInstance();
        const { conversation: restoredConversation, extra } =
          restoreConversationState(
            frozenState,
            'proficiencies-gardener',
            instance.instanceId
          );

        conversation = restoredConversation;
        lastWakeWeek = (extra.lastWakeWeek as string | undefined) ?? undefined;

        plugin.logger.log('thaw: State restored. Marking sleeping.');
        control.markSleeping('Gardener thawed from frozen state.');

        // Restart schedule timer
        startScheduleTimer();
        const config = getConfig();
        plugin.logger.log(
          `thaw: Gardener is ready for next wake cycle on ${config.wakeDay} at ${config.wakeTime}`
        );
      },

      onSuspend: async () => {
        plugin.logger.log(
          'onSuspend: Restarting schedule timer for suspension...'
        );
        stopScheduleTimer();
        startScheduleTimer();
        plugin.logger.log('onSuspend: Gardener is suspended.');
      },
    });

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log('onAssistantAcceptsRequests: Starting gardener...');
      await handle.start();
      plugin.logger.log('onAssistantAcceptsRequests: Gardener started.');
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      plugin.logger.log('onPluginsWillUnload: Stopping gardener...');
      stopScheduleTimer();
      await handle.stop();
      plugin.logger.log('onPluginsWillUnload: Gardener stopped.');
    });
  },
};

export default proficienciesGardenerPlugin;
