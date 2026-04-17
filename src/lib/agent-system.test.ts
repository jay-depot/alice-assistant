import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AgentSystem independent agents', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers, starts, and lists an independent agent', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-independent-agent-runtime-1',
      name: 'Test Independent Agent Runtime 1',
      description: 'Runtime test independent agent.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Booted.');
        control.markSleeping('Idle.');
      },
    });

    const instance = await handle.start();

    expect(instance.agentId).toBe('test-independent-agent-runtime-1');
    expect(instance.status).toBe('sleeping');
    expect(instance.statusMessage).toBe('Idle.');
    expect(handle.getInstance()?.instanceId).toBe(instance.instanceId);
    expect(AgentSystem.getIndependentInstances()).toHaveLength(1);
  });

  it('does not create duplicate instances when started twice', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const start = vi.fn(
      async (
        control: Parameters<
          typeof AgentSystem.registerIndependentDefinition
        >[1]['start'] extends (control: infer T) => Promise<void>
          ? T
          : never
      ) => {
        control.markSleeping('Still idle.');
      }
    );

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-independent-agent-runtime-2',
      name: 'Test Independent Agent Runtime 2',
      description: 'Runtime test duplicate start guard.',
      conversationType: 'autonomy',
      start,
    });

    const first = await handle.start();
    const second = await handle.start();

    expect(first.instanceId).toBe(second.instanceId);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('stops an independent agent and removes it from the active list', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const stop = vi.fn(async () => undefined);

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-independent-agent-runtime-3',
      name: 'Test Independent Agent Runtime 3',
      description: 'Runtime test stop handling.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
      stop,
    });

    await handle.start();
    await handle.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(handle.getInstance()).toBeUndefined();
    expect(AgentSystem.getIndependentInstances()).toHaveLength(0);
  });

  it('marks an agent as erroring when startup throws', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-independent-agent-runtime-4',
      name: 'Test Independent Agent Runtime 4',
      description: 'Runtime test startup errors.',
      conversationType: 'autonomy',
      start: async () => {
        throw new Error('kaboom');
      },
    });

    const instance = await handle.start();

    expect(instance.status).toBe('erroring');
    expect(instance.statusMessage).toContain('kaboom');
  });

  // --- State machine transition validation ---

  it('allows valid transitions: hatching → running → sleeping → paused → running', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-transitions-1',
      name: 'Transition Test 1',
      description: 'Tests valid state transitions.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Step 1');
        control.markSleeping('Step 2');
        control.markPaused('Step 3');
        control.markRunning('Step 4');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('running');
    expect(instance.statusMessage).toBe('Step 4');
  });

  it('prevents erroring → running transition (erroring is terminal)', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-transitions-3',
      name: 'Transition Test 3',
      description: 'Tests that erroring is terminal.',
      conversationType: 'autonomy',
      start: async () => {
        throw new Error('immediate failure');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('erroring');

    // Try to resume from erroring — should be rejected
    await AgentSystem.resumeIndependentAgent('test-transitions-3');
    expect(instance.status).toBe('erroring');
  });

  // --- Pause / Resume ---

  it('pauses and resumes an independent agent, invoking onPause and onResume', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const onPause = vi.fn(async () => {
      // onPause is for cleanup (e.g. stopping timers), not state changes.
      // The runtime transitions to 'paused' after onPause returns.
    });
    const onResume = vi.fn(
      async (control: { markRunning: (msg: string) => void }) => {
        control.markRunning('Resumed by test.');
      }
    );

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-pause-resume',
      name: 'Pause Resume Test',
      description: 'Tests pause and resume.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
      onPause,
      onResume,
    });

    const instance = await handle.start();
    expect(instance.status).toBe('sleeping');

    await AgentSystem.pauseIndependentAgent('test-pause-resume');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(instance.status).toBe('paused');

    await AgentSystem.resumeIndependentAgent('test-pause-resume');
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(instance.status).toBe('running');
  });

  it('wakes a sleeping agent via resume, invoking onResume', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const onResume = vi.fn(
      async (control: { markRunning: (msg: string) => void }) => {
        control.markRunning('Woken by schedule.');
      }
    );

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-wake-sleeping',
      name: 'Wake Sleeping Test',
      description: 'Tests waking a sleeping agent.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
      onResume,
    });

    const instance = await handle.start();
    expect(instance.status).toBe('sleeping');

    // Resume should wake a sleeping agent
    await AgentSystem.resumeIndependentAgent('test-wake-sleeping');
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(instance.status).toBe('running');
  });

  it('rejects pause from non-pausable state', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-pause-invalid',
      name: 'Pause Invalid Test',
      description: 'Tests that pausing from invalid state is rejected.',
      conversationType: 'autonomy',
      start: async () => {
        throw new Error('immediate failure');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('erroring');

    // Pausing from erroring should be rejected
    await AgentSystem.pauseIndependentAgent('test-pause-invalid');
    expect(instance.status).toBe('erroring');
  });

  // --- Sleep ---

  it('sleeps a running independent agent', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-sleep',
      name: 'Sleep Test',
      description: 'Tests sleep transition.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working.');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('running');

    await AgentSystem.sleepIndependentAgent('test-sleep', 'All done for now.');
    expect(instance.status).toBe('sleeping');
    expect(instance.statusMessage).toBe('All done for now.');
  });

  it('rejects sleep from non-running state', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-sleep-invalid',
      name: 'Sleep Invalid Test',
      description: 'Tests that sleeping from non-running state is rejected.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('sleeping');

    // Sleeping from sleeping should be rejected (only running → sleeping)
    await AgentSystem.sleepIndependentAgent(
      'test-sleep-invalid',
      'Already asleep.'
    );
    expect(instance.status).toBe('sleeping');
  });

  // --- Suspend ---

  it('suspends a stuck agent to sleeping', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const onSuspend = vi.fn(async () => {
      // onSuspend is for cleanup (e.g. stopping timers), not state changes.
      // The runtime transitions to 'sleeping' after onSuspend returns.
    });

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-suspend',
      name: 'Suspend Test',
      description: 'Tests suspend on stuck agent.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working.');
      },
      onSuspend,
    });

    const instance = await handle.start();
    expect(instance.status).toBe('running');

    // Force to stuck state via core-controlled transition
    AgentSystem.markIndependentAgentStuck(
      'test-suspend',
      'No activity detected.'
    );
    expect(instance.status).toBe('stuck');

    await AgentSystem.suspendIndependentAgent('test-suspend');
    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(instance.status).toBe('sleeping');
  });

  it('rejects suspend from non-stuck state', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-suspend-invalid',
      name: 'Suspend Invalid Test',
      description: 'Tests that suspend from non-stuck state is rejected.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working.');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('running');

    // Suspend from running should be rejected (only stuck → sleeping)
    await AgentSystem.suspendIndependentAgent('test-suspend-invalid');
    expect(instance.status).toBe('running');
  });

  // --- Freeze / Thaw ---

  it('freezes and thaws an independent agent', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const freeze = vi.fn(async () => ({ customState: 'frozen-data' }));
    const thaw = vi.fn(
      async (
        _state: Record<string, unknown>,
        control: { markSleeping: (msg: string) => void }
      ) => {
        control.markSleeping('Thawed.');
      }
    );

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-freeze-thaw',
      name: 'Freeze Thaw Test',
      description: 'Tests freeze and thaw.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
      freeze,
      thaw,
    });

    const instance = await handle.start();
    expect(instance.status).toBe('sleeping');

    const frozenState =
      await AgentSystem.freezeIndependentAgent('test-freeze-thaw');
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(frozenState).toEqual({ customState: 'frozen-data' });
    expect(instance.status).toBe('frozen');

    await AgentSystem.thawIndependentAgent('test-freeze-thaw', frozenState!);
    expect(thaw).toHaveBeenCalledTimes(1);
    expect(instance.status).toBe('sleeping');
  });

  it('freezeAll and thawAll work across multiple agents', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'freeze-all-1',
      name: 'Freeze All 1',
      description: 'First agent for freezeAll test.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle 1.');
      },
      freeze: async () => ({ v: 1 }),
      thaw: async (_s, control) => {
        control.markSleeping('Thawed 1.');
      },
    });

    AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'freeze-all-2',
      name: 'Freeze All 2',
      description: 'Second agent for freezeAll test.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working 2.');
      },
      freeze: async () => ({ v: 2 }),
      thaw: async (_s, control) => {
        control.markRunning('Thawed 2.');
      },
    });

    await AgentSystem.startIndependentAgent('freeze-all-1');
    await AgentSystem.startIndependentAgent('freeze-all-2');

    const results = await AgentSystem.freezeAllIndependentAgents();
    expect(results.size).toBe(2);
    expect(results.get('freeze-all-1')).toEqual({ v: 1 });
    expect(results.get('freeze-all-2')).toEqual({ v: 2 });

    const inst1 = AgentSystem.getIndependentInstance('freeze-all-1');
    const inst2 = AgentSystem.getIndependentInstance('freeze-all-2');
    expect(inst1?.status).toBe('frozen');
    expect(inst2?.status).toBe('frozen');

    await AgentSystem.thawAllIndependentAgents(results);
    expect(inst1?.status).toBe('sleeping');
    expect(inst2?.status).toBe('running');
  });

  // --- Activity tracking ---

  it('reportActivity updates lastActivityAt', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-activity',
      name: 'Activity Test',
      description: 'Tests activity tracking.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working.');
        const before = control.getInstance().lastActivityAt.getTime();
        // Simulate some passage of time
        await new Promise(r => setTimeout(r, 5));
        control.reportActivity();
        const after = control.getInstance().lastActivityAt.getTime();
        if (after <= before) {
          throw new Error('lastActivityAt was not updated');
        }
        control.markSleeping('Done.');
      },
    });

    const instance = await handle.start();
    expect(instance.status).toBe('sleeping');
  });

  // --- Update callbacks ---

  it('fires independent agent update callbacks on state changes', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const updates: string[] = [];

    AgentSystem.onIndependentAgentUpdate(instance => {
      updates.push(`${instance.agentId}:${instance.status}`);
    });

    const handle = AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-callbacks',
      name: 'Callback Test',
      description: 'Tests update callbacks.',
      conversationType: 'autonomy',
      start: async control => {
        control.markRunning('Working.');
        control.markSleeping('Idle.');
      },
    });

    await handle.start();

    // hatching → running → sleeping = 2 transitions (hatching doesn't fire callback)
    expect(updates).toContain('test-callbacks:running');
    expect(updates).toContain('test-callbacks:sleeping');
  });

  // --- restoreIndependentAgent ---

  it('restoreIndependentAgent creates instance without calling start', async () => {
    const { AgentSystem } = await import('./agent-system.js');
    const start = vi.fn(async (control: never) => {
      (control as { markRunning: (msg: string) => void }).markRunning(
        'Should not be called.'
      );
    });

    AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-restore',
      name: 'Restore Test',
      description: 'Tests restore without start.',
      conversationType: 'autonomy',
      start,
      thaw: async (_s, control) => {
        control.markSleeping('Thawed from checkpoint.');
      },
    });

    // restoreIndependentAgent should NOT call start()
    const instance = AgentSystem.restoreIndependentAgent('test-restore');
    expect(instance.agentId).toBe('test-restore');
    expect(instance.status).toBe('frozen');
    expect(start).not.toHaveBeenCalled();

    // Now thaw should transition to sleeping
    await AgentSystem.thawIndependentAgent('test-restore', { test: true });
    expect(instance.status).toBe('sleeping');
    expect(instance.statusMessage).toBe('Thawed from checkpoint.');
  });

  it('restoreIndependentAgent returns existing instance if one exists', async () => {
    const { AgentSystem } = await import('./agent-system.js');

    AgentSystem.registerIndependentDefinition('test-plugin', {
      id: 'test-restore-existing',
      name: 'Restore Existing Test',
      description: 'Tests restore returns existing.',
      conversationType: 'autonomy',
      start: async control => {
        control.markSleeping('Idle.');
      },
    });

    const started = await AgentSystem.startIndependentAgent(
      'test-restore-existing'
    );
    const restored = AgentSystem.restoreIndependentAgent(
      'test-restore-existing'
    );
    expect(restored.instanceId).toBe(started.instanceId);
  });
});
