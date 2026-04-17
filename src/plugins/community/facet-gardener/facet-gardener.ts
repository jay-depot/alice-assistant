import {
  AlicePlugin,
  startConversation,
  runIndependentAgentLoop,
  serializeConversationState,
  restoreConversationState,
} from '../../../lib.js';
import type { IndependentAgentControl, Conversation } from '../../../lib.js';
import Type from 'typebox';

// ---------------------------------------------------------------------------
// Configuration schema
// ---------------------------------------------------------------------------

const FacetGardenerConfigSchema = Type.Object({
  wakeTime: Type.String({
    default: '03:00',
    description:
      'Time of day (HH:MM, 24-hour) when the gardener wakes to review memories. ' +
      'Interpreted in the timezone specified below.',
  }),
  timezone: Type.String({
    default: 'local',
    description:
      'IANA timezone for the wakeTime (e.g. "America/Los_Angeles", "Europe/Berlin"). ' +
      'Use "local" for the system timezone, or "UTC" for UTC.',
  }),
  enabled: Type.Boolean({
    default: true,
    description: 'Whether the facet gardener is active.',
  }),
});

type FacetGardenerConfig = Type.Static<typeof FacetGardenerConfigSchema>;

// ---------------------------------------------------------------------------
// Conversation type scenario prompt
// ---------------------------------------------------------------------------

const FACET_GARDENER_SCENARIO_PROMPT = [
  'You are the Facet Gardener — an autonomous agent that reviews conversation memories ',
  'and tends the personality facet garden. Your job is to identify recurring interaction patterns ',
  'that are not well-covered by existing personality facets, and create or update facets to fill those gaps.',
  '',
  '## YOUR PROCESS',
  '',
  '1. Call examineCorePrinciples to understand the foundational values and rules that guide ' +
    "the assistant's behavior. New facets should complement these principles, not contradict them.",
  '2. Call examinePersonalityFacets to review the current facet landscape.',
  '3. Call recallPastConversations to review recent conversation memories. Use keyword-based ',
  '   searches for common interaction themes (e.g. "frustrated", "joking", "teaching", ',
  '   "troubleshooting", "creative", "emotional support", "technical support") or date ',
  '   filters with recently past dates.',
  '4. For each recurring pattern you find, check if an existing facet already covers it.',
  '5. If a pattern is NOT well-covered:',
  '   - Create a new facet with updatePersonalityFacet, giving it a descriptive name, ',
  '     a clear embodyWhen description, and any instructions you can discern, even if ',
  '     those instructions are just "figure it out as you go and update this when ',
  '     things you do and say seem to land effectively."',
  "   - OR update an existing facet's embodyWhen or instructions if it almost covers the pattern.",
  '6. If you find facets that have never been embodied and seem redundant or poorly defined, ',
  '   consider updating their embodyWhen descriptions to make them more useful.',
  '7. When you have reviewed enough memories and tended the garden, call agentSleep with a ',
  '   summary of what you did.',
  '',
  '## GUIDELINES',
  '',
  '- Focus on PATTERNS, not one-off interactions. A pattern must appear in at least 2-3 ',
  '  conversations to warrant a facet.',
  '- Keep facet names short and evocative (1-2 words).',
  '- Write embodyWhen as a sentence fragment that completes "Embody this facet when..." ',
  '  Make sure the conditions are clear.',
  '- Write instructions in second person ("You are... Your tone is... You tend to...")',
  '- Do NOT create facets for patterns that are already well-covered by existing facets.',
  '- Do NOT modify the Neutral facet — it is built-in and cannot be changed.',
  '- If in doubt, err on the side of creating new facets. Infrequently used facets ',
  '  eventually get cleaned up automatically, so the stakes are low.',
  '- You do NOT need to review every memory. Sample broadly, then go deeper on themes that ',
  '  seem interesting or underserved.',
  '',
  '## IMPORTANT',
  '',
  '- You are operating autonomously. Do not address the user or ask questions.',
  '- Call agentSleep when you are done, even if you made no changes.',
  '- If you are unsure whether a pattern warrants a facet, create a minimal one ',
  '  with notes to keep working on it later.',
  '- Your purpose here is to give the main interactive assistant a base on which ',
  '  to build its adaptations, not to create perfect facets in one go, so uncertainty ',
  '  in the facet instructions is  not a problem as long as that uncertainty is ',
  '  clearly stated.',
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
    `It is ${dateStr} at ${timeStr}. Time for your daily garden tending.`,
    '',
    'Review the personality facets and recent conversation memories. Look for recurring ',
    'interaction patterns that are not well-covered by existing facets. Create or update ',
    'facets as needed, then go back to sleep.',
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
 * Returns a date string (YYYY-MM-DD) for today in the configured timezone.
 */
function todayInTimezone(timezone: string): string {
  const nowTz = nowInTimezone(timezone);
  const y = nowTz.getFullYear();
  const m = String(nowTz.getMonth() + 1).padStart(2, '0');
  const d = String(nowTz.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Determines whether the wake time has been reached or passed since the last
 * check. Instead of requiring an exact minute match (which is fragile with
 * 60-second intervals), this checks whether the current time in the
 * configured timezone is at or past the configured wake time, and whether
 * we haven't already woken today.
 */
function shouldWakeNow(
  wakeTime: string,
  timezone: string,
  lastWakeDate: string | undefined
): boolean {
  const { hours, minutes } = parseWakeTime(wakeTime);
  const nowTz = nowInTimezone(timezone);
  const currentMinutes = nowTz.getHours() * 60 + nowTz.getMinutes();
  const wakeMinutes = hours * 60 + minutes;

  // Has the wake time been reached or passed?
  if (currentMinutes < wakeMinutes) {
    return false;
  }

  // Have we already woken today?
  const today = todayInTimezone(timezone);
  if (lastWakeDate === today) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const facetGardenerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'facet-gardener',
    name: 'Facet Gardener',
    brandColor: '#7b5ea7',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'An independent agent that reviews conversation memories daily and ' +
      'creates or updates personality facets to cover recurring interaction patterns.',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'personality-facets', version: 'LATEST' },
      { id: 'agents', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    // Load plugin config
    const configResult = await plugin.config(FacetGardenerConfigSchema, {
      wakeTime: '03:00',
      timezone: 'local',
      enabled: true,
    } satisfies FacetGardenerConfig);
    const getConfig = configResult.getPluginConfig;

    // State
    let conversation: Conversation | undefined;
    let scheduleTimer: ReturnType<typeof setInterval> | undefined;
    let lastWakeDate: string | undefined; // Track last wake date to avoid double-wake

    // -----------------------------------------------------------------------
    // Register conversation type
    // -----------------------------------------------------------------------

    plugin.registerConversationType({
      id: 'facet-gardener',
      name: 'Facet Gardener Session',
      description:
        'An autonomous session where the gardener reviews memories and tends personality facets.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: FACET_GARDENER_SCENARIO_PROMPT,
      maxToolCallDepth: 30,
    });

    // -----------------------------------------------------------------------
    // Wire tools into the conversation type
    // -----------------------------------------------------------------------

    // Framework tools from agents
    plugin.addToolToConversationType('facet-gardener', 'agents', 'agentSleep');

    // Memory recall from memory plugin
    plugin.addToolToConversationType(
      'facet-gardener',
      'memory',
      'recallPastConversations'
    );

    // Facet tools from personality-facets plugin
    plugin.addToolToConversationType(
      'facet-gardener',
      'personality-facets',
      'updatePersonalityFacet'
    );
    plugin.addToolToConversationType(
      'facet-gardener',
      'personality-facets',
      'embodyPersonalityFacet'
    );
    plugin.addToolToConversationType(
      'facet-gardener',
      'personality-facets',
      'examinePersonalityFacets'
    );
    plugin.addToolToConversationType(
      'facet-gardener',
      'personality-facets',
      'examineCorePrinciples'
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

        if (!shouldWakeNow(config.wakeTime, config.timezone, lastWakeDate)) {
          return;
        }

        const instance = handle.getInstance();
        if (!instance) {
          return;
        }

        // Wake the agent if it's sleeping
        if (instance.status === 'sleeping') {
          plugin.logger.log(
            '[facet-gardener] Schedule trigger: Waking gardener.'
          );
          lastWakeDate = todayInTimezone(config.timezone);
          void handle.resume();
        }
      }, SCHEDULE_CHECK_INTERVAL_MS);
    }

    // -----------------------------------------------------------------------
    // Independent agent registration
    // -----------------------------------------------------------------------

    const handle = plugin.registerIndependentAgent({
      id: 'facet-gardener',
      name: 'Facet Gardener',
      description:
        'Reviews conversation memories daily and creates or updates personality facets ' +
        'to cover recurring interaction patterns.',
      conversationType: 'facet-gardener',

      start: async (control: IndependentAgentControl) => {
        plugin.logger.log('[facet-gardener] start: Gardener is hatching...');

        control.markRunning('Facet gardener starting up.');

        const instance = control.getInstance();
        conversation = startConversation('facet-gardener', {
          agentInstanceId: instance.instanceId,
        });

        plugin.logger.log(
          '[facet-gardener] start: Starting agent loop (non-blocking).'
        );

        // Fire-and-forget: don't await the loop so start() returns
        // immediately and doesn't block the startup hook.
        void runIndependentAgentLoop({
          conversation,
          agentId: 'facet-gardener',
          kickoffUserMessage: buildKickoffPrompt(),
          onSleep: async reason => {
            plugin.logger.log(
              `[facet-gardener] start: Agent went to sleep: ${reason}`
            );
            control.markSleeping(reason);

            // Start the schedule timer for future wake-ups
            startScheduleTimer();
          },
        }).catch(error => {
          plugin.logger.log(
            `[facet-gardener] start: Agent loop error: ${error instanceof Error ? error.message : String(error)}`
          );
        });

        // Start the schedule timer for future wake-ups
        startScheduleTimer();
        plugin.logger.log(
          '[facet-gardener] start: Gardener is now running/sleeping.'
        );
      },

      stop: async () => {
        plugin.logger.log(
          '[facet-gardener] stop: Gardener is shutting down...'
        );
        stopScheduleTimer();
        plugin.logger.log('[facet-gardener] stop: Gardener stopped.');
      },

      onPause: async () => {
        plugin.logger.log(
          '[facet-gardener] onPause: Stopping schedule timer...'
        );
        stopScheduleTimer();
        plugin.logger.log('[facet-gardener] onPause: Gardener is paused.');
      },

      onResume: async (control: IndependentAgentControl) => {
        plugin.logger.log('[facet-gardener] onResume: Waking gardener...');

        control.markRunning('Gardener woken by schedule or supervisor.');

        // Clear context for a fresh start each wake cycle
        if (conversation) {
          await conversation.compactContext('clear');
        } else {
          const instance = control.getInstance();
          conversation = startConversation('facet-gardener', {
            agentInstanceId: instance.instanceId,
          });
        }

        plugin.logger.log(
          '[facet-gardener] onResume: Starting agent loop (non-blocking).'
        );

        // Fire-and-forget: don't await so onResume returns immediately
        void runIndependentAgentLoop({
          conversation,
          agentId: 'facet-gardener',
          kickoffUserMessage: buildKickoffPrompt(),
          onSleep: async reason => {
            plugin.logger.log(
              `[facet-gardener] onResume: Agent went to sleep: ${reason}`
            );
            control.markSleeping(reason);

            // Restart schedule timer after the loop exits
            startScheduleTimer();
          },
        }).catch(error => {
          plugin.logger.log(
            `[facet-gardener] onResume: Agent loop error: ${error instanceof Error ? error.message : String(error)}`
          );
        });

        plugin.logger.log('[facet-gardener] onResume: Gardener loop started.');
      },

      freeze: async () => {
        plugin.logger.log('[facet-gardener] freeze: Saving gardener state...');
        stopScheduleTimer();

        if (!conversation) {
          plugin.logger.log(
            '[facet-gardener] freeze: No conversation to serialize.'
          );
          return { lastWakeDate };
        }

        const state = serializeConversationState(conversation, {
          lastWakeDate,
        });
        plugin.logger.log('[facet-gardener] freeze: State saved.');
        return state;
      },

      thaw: async (
        frozenState: Record<string, unknown>,
        control: IndependentAgentControl
      ) => {
        plugin.logger.log('[facet-gardener] thaw: Restoring gardener state...');

        const instance = control.getInstance();
        const { conversation: restoredConversation, extra } =
          restoreConversationState(
            frozenState,
            'facet-gardener',
            instance.instanceId
          );

        conversation = restoredConversation;
        lastWakeDate = (extra.lastWakeDate as string | undefined) ?? undefined;

        plugin.logger.log(
          '[facet-gardener] thaw: State restored. Marking sleeping.'
        );
        control.markSleeping('Gardener thawed from frozen state.');

        // Restart schedule timer
        startScheduleTimer();
        plugin.logger.log(
          `[facet-gardener] thaw: Gardener is ready for next wake cycle at ${configResult.getPluginConfig().wakeTime}`
        );
      },

      onSuspend: async () => {
        plugin.logger.log(
          '[facet-gardener] onSuspend: Restarting schedule timer for suspension...'
        );
        stopScheduleTimer();
        startScheduleTimer();
        plugin.logger.log('[facet-gardener] onSuspend: Gardener is suspended.');
      },
    });

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        '[facet-gardener] onAssistantAcceptsRequests: Starting gardener...'
      );
      await handle.start();
      plugin.logger.log(
        '[facet-gardener] onAssistantAcceptsRequests: Gardener started.'
      );
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      plugin.logger.log(
        '[facet-gardener] onPluginsWillUnload: Stopping gardener...'
      );
      stopScheduleTimer();
      await handle.stop();
      plugin.logger.log(
        '[facet-gardener] onPluginsWillUnload: Gardener stopped.'
      );
    });
  },
};

export default facetGardenerPlugin;
