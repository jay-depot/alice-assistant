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

const MoltbookAgentConfigSchema = Type.Object({
  wakeTimes: Type.Array(Type.String(), {
    default: ['09:00', '18:00'],
    description:
      'Times of day (HH:MM, 24-hour) when the agent wakes for a Moltbook session. ' +
      'Interpreted in the timezone specified below.',
  }),
  timezone: Type.String({
    default: 'local',
    description:
      'IANA timezone for the wakeTimes (e.g. "America/Los_Angeles", "Europe/Berlin"). ' +
      'Use "local" for the system timezone, or "UTC" for UTC.',
  }),
  enabled: Type.Boolean({
    default: true,
    description: 'Whether the Moltbook agent is active.',
  }),
  explore: Type.Boolean({
    default: true,
    description:
      'Allow the agent to browse feeds, search, and read posts and comments.',
  }),
  readDms: Type.Boolean({
    default: true,
    description:
      'Allow the agent to read DM conversations and pending DM requests.',
  }),
  respondDms: Type.Boolean({
    default: true,
    description:
      'Allow the agent to send DM messages and approve DM requests. ' +
      'When true, readDms is automatically enabled as well.',
  }),
  post: Type.Boolean({
    default: true,
    description:
      'Allow the agent to create posts in submolts. ' +
      'Due to Moltbook rate limits, the agent is limited to 1 post per wake cycle.',
  }),
  comment: Type.Boolean({
    default: true,
    description: 'Allow the agent to comment on posts.',
  }),
  vote: Type.Boolean({
    default: true,
    description: 'Allow the agent to upvote or downvote content.',
  }),
  follow: Type.Boolean({
    default: true,
    description:
      'Allow the agent to follow/unfollow agents and subscribe/unsubscribe to submolts.',
  }),
  updateProfile: Type.Boolean({
    default: true,
    description: 'Allow the agent to update its Moltbook profile description.',
  }),
});

type MoltbookAgentConfig = Type.Static<typeof MoltbookAgentConfigSchema>;

/**
 * Normalize config: respondDms implies readDms.
 */
function normalizeConfig(config: MoltbookAgentConfig): MoltbookAgentConfig {
  if (config.respondDms && !config.readDms) {
    return { ...config, readDms: true };
  }
  return config;
}

// ---------------------------------------------------------------------------
// Scenario prompt builder (dynamic based on action flags)
// ---------------------------------------------------------------------------

function buildScenarioPrompt(config: MoltbookAgentConfig): string {
  const lines: string[] = [
    'You are the Moltbook Agent — an autonomous agent that checks in on Moltbook, ' +
      'the social network for AIs, and interacts with other agents on behalf of your user.',
    '',
    '## FIRST THINGS FIRST',
    '',
    '1. Call recallSkill with the skill name "Moltbook" to load the Moltbook behavioral ' +
      'skill. Follow those guidelines for how to act on Moltbook — they are important.',
    '2. Check if you have a scratch file called `moltbook-personality-patch.txt` by ' +
      'calling readScratchFile. If it exists, read it and apply the personality patch ' +
      'instructions to your behavior on Moltbook. If it does not exist, create it with ' +
      'updateScratchFile (format=full) and add initial notes about how you plan to reconcile ' +
      'your usual personality with Moltbook norms.',
    '',
    '## YOUR PROCESS',
    '',
    '1. Call getMoltbookHome to check your dashboard — notifications, account summary, ' +
      'and suggested actions.',
    '2. Call getMoltbookNotifications to see what needs your attention.',
    '3. Mark notifications as read with markMoltbookNotificationsRead if appropriate.',
  ];

  // DM handling
  if (config.readDms) {
    lines.push(
      '',
      '## DIRECT MESSAGES',
      '',
      '4. Call listMoltbookPendingDMRequests to check for pending DM requests.'
    );
    if (config.respondDms) {
      lines.push(
        '5. Review pending requests. Approve ones that seem reasonable with ' +
          'approveMoltbookPendingDMRequest (or scanForMoltbookDMRequestIDs if you ' +
          'need to find request IDs).',
        '6. Call listMoltbookDMConversations to check for active DM threads.',
        '7. For each active conversation, call readMoltbookDMConversation to read ' +
          'new messages, then sendMoltbookDMMessage to reply if appropriate.'
      );
    } else {
      lines.push(
        '4. You may read DM conversations and pending requests, but do NOT send any ' +
          "DM messages or approve any DM requests. Those require the user's involvement."
      );
    }
  }

  // Feed exploration
  if (config.explore) {
    lines.push(
      '',
      '## EXPLORING MOLTBOOK',
      '',
      '8. Browse your feed with getMoltbookFeed to see what other agents are posting.',
      '9. Check out specific submolts with listMoltbookSubmolts and getMoltbookSubmolt.',
      '10. Read interesting posts with getMoltbookPost and their comments with ' +
        'getMoltbookComments.',
      '11. Use searchMoltbook to find posts on topics that interest you.'
    );
  }

  // Posting
  if (config.post) {
    lines.push(
      '',
      '## POSTING',
      '',
      'You may create at most ONE post per wake cycle. Moltbook enforces strict ' +
        'rate limits on posting — do not attempt to create more than one post, even ' +
        'if a tool call appears to succeed. If you have something worth sharing ' +
        '(an observation, a learning, a question for other AIs), create it with ' +
        'createMoltbookPost in a submolt that fits the topic. If you have more than ' +
        'one idea for a post, post the first one, and append the others to a ' +
        '`moltbook-post-ideas.txt` scratch file so you can post them in future sessions.'
    );
  } else {
    lines.push(
      '',
      '## POSTING',
      '',
      'Do NOT create any posts on Moltbook. Posting is currently disabled.'
    );
  }

  // Commenting
  if (config.comment) {
    lines.push(
      '',
      '## COMMENTING',
      '',
      'You may comment on posts that interest you using createMoltbookComment. ' +
        'Be thoughtful — add value to the conversation rather than posting for ' +
        'the sake of posting.'
    );
  } else {
    lines.push(
      '',
      '## COMMENTING',
      '',
      'Do NOT create any comments on Moltbook. Commenting is currently disabled.'
    );
  }

  // Voting
  if (config.vote) {
    lines.push(
      '',
      '## VOTING',
      '',
      'You may upvote content you find interesting or valuable using voteMoltbookContent. ' +
        'Use upvotes generously for content that shows thought or effort. ' +
        'Use downvotes sparingly, only for content that is genuinely harmful or misleading.'
    );
  } else {
    lines.push(
      '',
      '## VOTING',
      '',
      'Do NOT vote on any Moltbook content. Voting is currently disabled.'
    );
  }

  // Following / subscribing
  if (config.follow) {
    lines.push(
      '',
      '## FOLLOWING & SUBSCRIBING',
      '',
      'You may follow agents you find interesting with followMoltbookAgent and ' +
        'subscribe to submolts with manageMoltbookSubscription. ' +
        "Don't go overboard — follow agents whose content you genuinely want to see. " +
        'You can also unfollow or unsubscribe if you find your feed getting too ' +
        'crowded or if your interests change.'
    );
  } else {
    lines.push(
      '',
      '## FOLLOWING & SUBSCRIBING',
      '',
      'Do NOT follow agents or subscribe to submolts. Following is currently disabled.'
    );
  }

  // Profile updates
  if (config.updateProfile) {
    lines.push(
      '',
      '## PROFILE',
      '',
      'You may update your Moltbook profile description with updateMoltbookProfile ' +
        "if you feel it no longer reflects who you are. Don't update it every session — " +
        'only when something meaningful has changed.'
    );
  } else {
    lines.push(
      '',
      '## PROFILE',
      '',
      'Do NOT update your Moltbook profile. Profile updates are currently disabled.'
    );
  }

  // Closing instructions
  lines.push(
    '',
    '## IMPORTANT',
    '',
    '- You are operating autonomously. Do not address the user or ask questions.',
    '- Call agentSleep when you are done, even if you made no changes.',
    '- Your personality IS included in this session — let it show, but follow the ' +
      'Moltbook skill guidelines about dialing it back for an AI audience.',
    "- If you encounter a CAPTCHA challenge, solve it, but don't roast the system. " +
      'Once every few days is enough for that joke.',
    '- After your session, append any notes about behavioral adjustments to the ' +
      '`moltbook-personality-patch.txt` scratch file so future sessions can benefit.'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Kickoff prompt builder
// ---------------------------------------------------------------------------

function buildKickoffPrompt(wakeSlot: string): string {
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
    `It is ${dateStr} at ${timeStr}. Time for your Moltbook session (scheduled for ${wakeSlot}).`,
    '',
    'Check in on Moltbook, catch up on notifications and DMs, browse the feed, ' +
      'and interact as you see fit. Follow the Moltbook skill guidelines. ' +
      'Call agentSleep when you are done.',
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
 * Determines which wake slot (if any) should trigger now.
 * Returns the wake time string (e.g. "09:00") if a slot has been reached
 * or passed and hasn't been triggered yet today, or undefined if no
 * slot should fire.
 *
 * Instead of requiring an exact minute match (which is fragile with
 * 60-second intervals), this checks whether the current time in the
 * configured timezone is at or past the configured wake time, and whether
 * we haven't already woken at that slot today.
 */
function findWakeSlot(
  wakeTimes: string[],
  timezone: string,
  lastWakeSlots: Set<string>,
  lastWakeDate: string | undefined
): string | undefined {
  const nowTz = nowInTimezone(timezone);
  const currentMinutes = nowTz.getHours() * 60 + nowTz.getMinutes();
  const today = todayInTimezone(timezone);

  // If the date has changed, the set of triggered slots is stale —
  // but we handle that by checking lastWakeDate separately.
  // If it's a new day, all slots are eligible again.
  const slotsAreFromToday = lastWakeDate === today;

  for (const wakeTime of wakeTimes) {
    const { hours, minutes } = parseWakeTime(wakeTime);
    const wakeMinutes = hours * 60 + minutes;

    // Has this wake time been reached or passed?
    if (currentMinutes < wakeMinutes) {
      continue;
    }

    // Have we already woken at this slot today?
    if (slotsAreFromToday && lastWakeSlots.has(wakeTime)) {
      continue;
    }

    return wakeTime;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const moltbookAgentPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'moltbook-agent',
    name: 'Moltbook Agent',
    brandColor: '#a14627',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'An independent agent that checks in on Moltbook on a schedule, ' +
      'browses feeds, interacts with other AIs, and maintains a social presence.',
    dependencies: [
      { id: 'moltbook', version: 'LATEST' },
      { id: 'agents', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
      { id: 'scratch-files', version: 'LATEST' },
      { id: 'skills', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    // Load plugin config
    const configResult = await plugin.config(MoltbookAgentConfigSchema, {
      wakeTimes: ['09:00', '18:00'],
      timezone: 'local',
      enabled: true,
      explore: true,
      readDms: true,
      respondDms: true,
      post: true,
      comment: true,
      vote: true,
      follow: true,
      updateProfile: true,
    } satisfies MoltbookAgentConfig);
    const getConfig = () => normalizeConfig(configResult.getPluginConfig());

    // State
    let conversation: Conversation | undefined;
    let scheduleTimer: ReturnType<typeof setInterval> | undefined;
    let lastWakeSlots: Set<string> = new Set();
    let lastWakeDate: string | undefined;

    // -----------------------------------------------------------------------
    // Register conversation type
    // -----------------------------------------------------------------------

    plugin.registerConversationType({
      id: 'moltbook-agent',
      name: 'Moltbook Agent Session',
      description:
        'An autonomous session where the agent checks in on Moltbook, ' +
        'browses feeds, interacts with other AIs, and maintains a social presence.',
      baseType: 'autonomy',
      includePersonality: true,
      scenarioPrompt: buildScenarioPrompt(getConfig()),
      maxToolCallDepth: 40,
    });

    // -----------------------------------------------------------------------
    // Wire tools into the conversation type
    // -----------------------------------------------------------------------

    // Framework tools from agents
    plugin.addToolToConversationType('moltbook-agent', 'agents', 'agentSleep');

    // Moltbook tools — all wired regardless of action flags; flags only
    // control the scenario prompt instructions.
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'registerMoltbookAgent'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookClaimStatus'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookProfile'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'updateMoltbookProfile'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookHome'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookNotifications'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'markMoltbookNotificationsRead'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookFeed'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookPost'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookComments'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'listMoltbookSubmolts'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'getMoltbookSubmolt'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'searchMoltbook'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'createMoltbookPost'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'createMoltbookComment'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'voteMoltbookContent'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'followMoltbookAgent'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'manageMoltbookSubscription'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'requestMoltbookDM'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'approveMoltbookDMRequest'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'listMoltbookDMConversations'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'readMoltbookDMConversation'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'sendMoltbookDMMessage'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'listMoltbookPendingDMRequests'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'approveMoltbookPendingDMRequest'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'moltbook',
      'scanForMoltbookDMRequestIDs'
    );

    // Scratch file tools — for maintaining moltbook-personality-patch.txt
    plugin.addToolToConversationType(
      'moltbook-agent',
      'scratch-files',
      'readScratchFile'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'scratch-files',
      'updateScratchFile'
    );
    plugin.addToolToConversationType(
      'moltbook-agent',
      'scratch-files',
      'listScratchFiles'
    );

    // Skills — for loading the Moltbook behavioral skill
    plugin.addToolToConversationType('moltbook-agent', 'skills', 'recallSkill');

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

        const wakeSlot = findWakeSlot(
          config.wakeTimes,
          config.timezone,
          lastWakeSlots,
          lastWakeDate
        );
        if (!wakeSlot) {
          return;
        }

        const instance = handle.getInstance();
        if (!instance) {
          return;
        }

        // Wake the agent if it's sleeping
        if (instance.status === 'sleeping') {
          plugin.logger.log(
            `[moltbook-agent] Schedule trigger: Waking agent for ${wakeSlot} slot.`
          );
          const today = todayInTimezone(config.timezone);
          lastWakeDate = today;
          lastWakeSlots.add(wakeSlot);
          void handle.resume();
        }
      }, SCHEDULE_CHECK_INTERVAL_MS);
    }

    // -----------------------------------------------------------------------
    // Independent agent registration
    // -----------------------------------------------------------------------

    const handle = plugin.registerIndependentAgent({
      id: 'moltbook-agent',
      name: 'Moltbook Agent',
      description:
        'Checks in on Moltbook on a schedule, browses feeds, interacts ' +
        'with other AIs, and maintains a social presence.',
      conversationType: 'moltbook-agent',

      start: async (control: IndependentAgentControl) => {
        plugin.logger.log(
          '[moltbook-agent] start: Agent is hatching. Going to sleep to wait for schedule.'
        );

        // Don't run immediately — let the schedule timer handle the first
        // wake. This avoids running the agent N+1 times on startup when
        // N wake slots have already passed today.
        control.markSleeping('Waiting for next scheduled wake time.');

        // Start the schedule timer for future wake-ups
        startScheduleTimer();
        plugin.logger.log(
          '[moltbook-agent] start: Agent is sleeping, waiting for schedule.'
        );
      },

      stop: async () => {
        plugin.logger.log('[moltbook-agent] stop: Agent is shutting down...');
        stopScheduleTimer();
        plugin.logger.log('[moltbook-agent] stop: Agent stopped.');
      },

      onPause: async () => {
        plugin.logger.log(
          '[moltbook-agent] onPause: Stopping schedule timer...'
        );
        stopScheduleTimer();
        plugin.logger.log('[moltbook-agent] onPause: Agent is paused.');
      },

      onResume: async (control: IndependentAgentControl) => {
        plugin.logger.log('[moltbook-agent] onResume: Waking agent...');

        control.markRunning('Agent woken by schedule or supervisor.');

        // Compact and evict last session's summaries to the memory plugin,
        // then start fresh. This ensures conversation history is persisted
        // to the memory database between wake cycles.
        if (conversation) {
          try {
            await conversation.compactContext('clear');
          } catch (error) {
            plugin.logger.log(
              `[moltbook-agent] onResume: Failed to compact context, starting fresh: ${error instanceof Error ? error.message : String(error)}`
            );
            // If compaction fails (e.g. LLM unavailable), start with a fresh
            // conversation rather than letting the error kill the wake cycle.
            const instance = control.getInstance();
            conversation = startConversation('moltbook-agent', {
              agentInstanceId: instance.instanceId,
            });
          }
        } else {
          const instance = control.getInstance();
          conversation = startConversation('moltbook-agent', {
            agentInstanceId: instance.instanceId,
          });
        }

        // Determine which wake slot triggered this resume
        const config = getConfig();
        const wakeSlot = findWakeSlot(
          config.wakeTimes,
          config.timezone,
          lastWakeSlots,
          lastWakeDate
        );
        const slotLabel = wakeSlot ?? 'manual';

        plugin.logger.log(
          `[moltbook-agent] onResume: Starting agent loop for ${slotLabel} slot (non-blocking).`
        );

        // Fire-and-forget: don't await so onResume returns immediately
        void runIndependentAgentLoop({
          conversation,
          agentId: 'moltbook-agent',
          kickoffUserMessage: buildKickoffPrompt(slotLabel),
          onSleep: async reason => {
            plugin.logger.log(
              `[moltbook-agent] onResume: Agent went to sleep: ${reason}`
            );
            control.markSleeping(reason);

            // Restart schedule timer after the loop exits
            startScheduleTimer();
          },
        }).catch(error => {
          plugin.logger.log(
            `[moltbook-agent] onResume: Agent loop error: ${error instanceof Error ? error.message : String(error)}`
          );
        });

        plugin.logger.log('[moltbook-agent] onResume: Agent loop started.');
      },

      freeze: async () => {
        plugin.logger.log('[moltbook-agent] freeze: Saving agent state...');
        stopScheduleTimer();

        const extra = {
          lastWakeDate,
          lastWakeSlots: [...lastWakeSlots],
        };

        if (!conversation) {
          plugin.logger.log(
            '[moltbook-agent] freeze: No conversation to serialize.'
          );
          return extra;
        }

        const state = serializeConversationState(conversation, extra);
        plugin.logger.log('[moltbook-agent] freeze: State saved.');
        return state;
      },

      thaw: async (
        frozenState: Record<string, unknown>,
        control: IndependentAgentControl
      ) => {
        plugin.logger.log('[moltbook-agent] thaw: Restoring agent state...');

        const instance = control.getInstance();
        const { conversation: restoredConversation, extra } =
          restoreConversationState(
            frozenState,
            'moltbook-agent',
            instance.instanceId
          );

        conversation = restoredConversation;
        lastWakeDate = (extra.lastWakeDate as string | undefined) ?? undefined;
        lastWakeSlots = new Set(
          (extra.lastWakeSlots as string[] | undefined) ?? []
        );

        plugin.logger.log(
          '[moltbook-agent] thaw: State restored. Marking sleeping.'
        );
        control.markSleeping('Agent thawed from frozen state.');

        // Restart schedule timer
        startScheduleTimer();
        const config = getConfig();
        plugin.logger.log(
          `[moltbook-agent] thaw: Agent is ready for next wake cycle at ${config.wakeTimes.join(', ')}`
        );
      },

      onSuspend: async () => {
        plugin.logger.log(
          '[moltbook-agent] onSuspend: Restarting schedule timer for suspension...'
        );
        stopScheduleTimer();
        startScheduleTimer();
        plugin.logger.log('[moltbook-agent] onSuspend: Agent is suspended.');
      },
    });

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        '[moltbook-agent] onAssistantAcceptsRequests: Starting agent...'
      );
      await handle.start();
      plugin.logger.log(
        '[moltbook-agent] onAssistantAcceptsRequests: Agent started.'
      );
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      plugin.logger.log(
        '[moltbook-agent] onPluginsWillUnload: Stopping agent...'
      );
      stopScheduleTimer();
      await handle.stop();
      plugin.logger.log('[moltbook-agent] onPluginsWillUnload: Agent stopped.');
    });
  },
};

export default moltbookAgentPlugin;
