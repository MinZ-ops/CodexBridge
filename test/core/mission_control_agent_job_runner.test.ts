import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryMissionRepository } from '../../packages/mission-control/src/index.js';
import { AgentJobService } from '../../src/core/agent_job_service.js';
import { runAgentJobWithMissionControl } from '../../src/core/mission_control_agent_job_runner.js';
import { InMemoryAgentJobRepository } from '../../src/store/in_memory/in_memory_agent_job_repository.js';
import type { BridgeSession, PlatformScopeRef } from '../../src/types/core.js';
import type { ProviderTurnProgress } from '../../src/types/provider.js';

test('runAgentJobWithMissionControl persists provider progress through the package-owned progress sink', async () => {
  const nowRef = { value: 1_701_700_000_000 };
  const session: BridgeSession = {
    id: 'session-runner-progress-1',
    providerProfileId: 'codex-default',
    codexThreadId: 'thread-runner-progress-1',
    cwd: '/repo',
    title: 'Runner progress session',
    createdAt: nowRef.value - 100,
    updatedAt: nowRef.value - 50,
  };
  const missionRepository = new InMemoryMissionRepository();
  const agentJobs = new InMemoryAgentJobRepository();
  const service = new AgentJobService({
    agentJobs,
    missionRepository,
    bridgeSessions: {
      getSessionById(bridgeSessionId: string) {
        return bridgeSessionId === session.id ? session : null;
      },
    },
    now: () => nowRef.value,
  });
  const job = service.createJob({
    scopeRef: {
      platform: 'weixin',
      externalScopeId: 'wx-runner-progress-1',
    },
    title: 'Persist bridge-side progress',
    originalInput: '/agent persist progress',
    goal: 'Keep provider progress in authoritative mission state.',
    expectedOutput: 'A verified result summary.',
    plan: ['Start provider', 'Persist progress', 'Verify result'],
    category: 'code',
    riskLevel: 'medium',
    mode: 'codex',
    providerProfileId: 'codex-default',
    bridgeSessionId: session.id,
    cwd: '/repo',
    locale: 'en',
    maxAttempts: 2,
  });

  const progress: ProviderTurnProgress[] = [
    {
      text: 'Scanned the failing tests.',
      delta: 'Scanned the failing tests.',
      outputKind: 'commentary',
    },
    {
      text: 'Ready to verify the patch.',
      delta: 'Ready to verify the patch.',
      outputKind: 'status',
    },
  ];

  await runAgentJobWithMissionControl({
    job,
    agentJobs: service,
    resolveSession: () => session,
    startTurnWithRecovery: async (
      _scopeRef: PlatformScopeRef,
      bridgeSession,
      _event,
      options,
    ) => {
      for (const entry of progress) {
        await options.onProgress?.(entry);
      }
      return {
        result: {
          outputText: 'Patched the preview flow and verified the fix.',
          previewText: 'Patched the preview flow and verified the fix.',
          outputState: 'complete',
          threadId: bridgeSession.codexThreadId,
          turnId: 'turn-runner-progress-1',
          title: bridgeSession.title,
        },
        session: bridgeSession,
      };
    },
    stopSession: async () => {},
    verifyJob: async () => ({
      pass: true,
      summary: 'Verification passed.',
      issues: [],
      nextAction: 'complete',
    }),
    progressText: {
      running: (attempt, maxAttempts) => `Running attempt ${attempt}/${maxAttempts}.`,
      verifying: () => 'Verifying the provider result.',
      retrying: () => 'Retrying after verifier feedback.',
    },
    now: () => {
      nowRef.value += 10;
      return nowRef.value;
    },
  });

  const mission = missionRepository.getMissionById(job.id);
  assert.equal(mission?.status, 'completed');
  assert.equal(mission?.workpad.summary, 'Ready to verify the patch.');
  assert.ok(mission?.workpad.notes.includes('Scanned the failing tests.'));
  assert.ok(mission?.workpad.notes.includes('Summary: Ready to verify the patch.'));

  const progressEvents = missionRepository
    .listEvents(job.id)
    .filter((event) => event.kind === 'attempt.progress');
  assert.equal(progressEvents.length >= 3, true);
  assert.equal(progressEvents[0]?.summary, 'Running attempt 1/2.');
  assert.equal(progressEvents[1]?.summary, 'Scanned the failing tests.');
  assert.equal(progressEvents[2]?.summary, 'Ready to verify the patch.');
  assert.equal(progressEvents.some((event) => event.summary === 'Verifying the provider result.'), true);
});
