import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DirectMissionControlApi,
  JsonFileMissionRepository,
  createMission,
  createMissionChecklistSnapshot,
  createMissionCycleResult,
  createMissionGeneration,
  createMissionResumeSnapshot,
  createMissionWorkItem,
  transitionMission,
  type MissionAttempt,
  type MissionEvent,
  type PlanChangeRequest,
} from '../src/index.js';

function createQueuedMission(now: number) {
  return transitionMission(createMission({
    id: 'mission-api-1',
    source: 'weixin',
    sourceRef: 'job-api-1',
    platform: 'weixin',
    externalScopeId: 'wx-user-api-1',
    title: 'Repair the release blocker',
    goal: 'Repair the release blocker and verify the fix.',
    expectedOutput: 'A verified repair summary.',
    acceptanceCriteria: ['Patch exists', 'Tests prove the fix'],
    plan: ['Inspect the regression', 'Patch the code', 'Verify the fix'],
    providerProfileId: 'codex-default',
    bridgeSessionId: 'session-api-1',
    codexThreadId: 'thread-api-1',
    cwd: '/repo',
    workflowPath: '/repo/.codexbridge/mission/WORKFLOW.md',
    workspacePath: '/tmp/mission-control/workspaces/mission-api-1',
    maxAttempts: 3,
    maxTurns: 5,
    now,
  }), 'queued', {
    at: now + 10,
    reason: 'Mission queued for execution.',
  });
}

function createApiHarness(now = 1_701_200_000_000) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-control-api-'));
  const repo = new JsonFileMissionRepository(stateDir);
  const nowRef = { value: now };
  const api = new DirectMissionControlApi({
    repository: repo,
    now: () => nowRef.value,
    generateId: () => `event-${nowRef.value++}`,
  });
  return { repo, api, nowRef };
}

test('direct mission control api can create a queued mission from a source-backed work item summary', async () => {
  const { repo, api, nowRef } = createApiHarness(1_701_200_050_000);

  const created = await api.commands.createMission({
    meta: {
      requestId: 'req-create-1',
      correlationId: 'corr-create-1',
      idempotencyKey: 'idem-create-1',
    },
    input: {
      missionId: 'mission-api-create-1',
      workItem: {
        source: 'manual',
        sourceRef: 'manual:api-create-1',
        sourceRevision: 'manual-rev-1',
        title: 'Repair the preview timeout',
        goal: 'Repair the preview timeout without regressing the chat flow.',
        expectedOutput: 'A verified repair summary.',
        acceptanceCriteria: ['Patch exists', 'Targeted test passes'],
        plan: ['Inspect the timeout path', 'Patch the flaky branch', 'Verify the fix'],
        metadata: {
          category: 'code',
        },
      },
      platform: 'weixin',
      externalScopeId: 'wx-user-create-1',
      providerProfileId: 'codex-default',
      bridgeSessionId: 'session-api-create-1',
      codexThreadId: 'thread-api-create-1',
      cwd: '/repo',
      riskLevel: 'medium',
      maxAttempts: 3,
      maxTurns: 8,
      initialStatus: 'queued',
      reason: 'Mission queued from the manual work item source.',
      actor: {
        actorId: 'test-host',
        actorType: 'host',
      },
    },
  });

  assert.equal(created.meta.requestId, 'req-create-1');
  assert.equal(created.data.mission.status, 'queued');
  assert.equal(created.data.mission.source, 'manual');
  assert.equal(created.data.hostBindings.platform, 'weixin');
  assert.equal(created.data.hostBindings.source, 'manual');
  assert.equal(created.data.workItem?.sourceRevision, 'manual-rev-1');
  assert.deepEqual(created.data.workItem?.metadata, { category: 'code' });
  assert.equal(created.data.activeGeneration?.id, 'mission-api-create-1:generation:1');
  assert.equal(created.data.currentChecklistSnapshot?.sourceRevision, 'manual-rev-1');
  assert.deepEqual(
    created.data.currentChecklistSnapshot?.acceptanceCriteria,
    ['Patch exists', 'Targeted test passes'],
  );

  const events = repo.listEvents('mission-api-create-1');
  assert.deepEqual(events.map((event) => event.kind), ['mission.created', 'mission.queued']);
  assert.equal(events[0]?.metadata.sourceRef, 'manual:api-create-1');
  assert.equal(events[1]?.summary, 'Mission queued from the manual work item source.');

  const repeated = await api.commands.createMission({
    meta: {
      requestId: 'req-create-2',
      correlationId: null,
      idempotencyKey: 'idem-create-1',
    },
    input: {
      missionId: 'mission-api-create-1',
      workItem: {
        source: 'manual',
        sourceRef: 'manual:api-create-1',
        sourceRevision: 'manual-rev-2',
        title: 'Changed title should not overwrite the existing mission',
        goal: 'Changed goal',
        expectedOutput: 'Changed output',
        acceptanceCriteria: ['Changed acceptance'],
        plan: ['Changed plan'],
        metadata: null,
      },
      platform: 'weixin',
      externalScopeId: 'wx-user-create-1',
      providerProfileId: 'codex-default',
    },
  });

  assert.equal(repeated.data.mission.title, 'Repair the preview timeout');
  assert.equal(repo.listEvents('mission-api-create-1').length, 2);
  assert.equal(repo.getChecklistSnapshotById('mission-api-create-1:checklist:1')?.hash?.length, 64);
  assert.deepEqual(events.map((event) => event.id), ['event-1701200050000', 'event-1701200050001']);
  assert.equal(nowRef.value, 1_701_200_050_002);
});

test('direct mission control api exposes package-owned query views with boundary metadata', async () => {
  const { repo, api, nowRef } = createApiHarness();
  const queued = createQueuedMission(nowRef.value);
  const running = transitionMission(queued, 'running', {
    at: nowRef.value + 20,
    activeAttemptId: 'attempt-api-1',
    lastResultPreview: 'Patched the release gate.',
  });
  const verifying = transitionMission(running, 'verifying', {
    at: nowRef.value + 30,
  });
  verifying.attemptCount = 1;
  verifying.workpad.summary = 'Release blocker investigation is in progress.';
  verifying.workpad.latestBlocker = 'Waiting for the verification pass.';
  verifying.workpad.latestVerifierSummary = 'Verification has not finished yet.';
  verifying.resultArtifacts = [{
    type: 'file',
    path: '/tmp/report.md',
    name: 'report.md',
    mimeType: 'text/markdown',
    caption: 'repair report',
  }];
  verifying.pendingApproval = {
    requestId: 'approval-api-1',
    kind: 'provider',
    summary: 'Need permission to run the release script.',
    options: [{ index: 0, label: 'Approve' }],
    createdAt: nowRef.value + 31,
  };

  const attempt: MissionAttempt = {
    id: 'attempt-api-1',
    missionId: verifying.id,
    generationId: verifying.activeGenerationId,
    generationIndex: verifying.activeGenerationIndex,
    checklistSnapshotId: verifying.currentChecklistSnapshotId,
    index: 1,
    status: 'verifying',
    providerRunId: 'run-api-1',
    providerThreadId: 'thread-api-1',
    promptDigest: 'digest-api-1',
    verifierVerdict: null,
    verifierSummary: null,
    missingAcceptanceCriteria: [],
    outputPreview: 'Patched the release gate.',
    error: null,
    startedAt: nowRef.value + 20,
    endedAt: null,
    createdAt: nowRef.value + 20,
    updatedAt: nowRef.value + 30,
  };
  const planChangeRequest: PlanChangeRequest = {
    id: 'plan-change-api-1',
    missionId: verifying.id,
    generationId: verifying.activeGenerationId,
    checklistSnapshotId: verifying.currentChecklistSnapshotId,
    status: 'proposed',
    rationale: 'Expand the verification coverage.',
    proposedExpectedOutput: null,
    proposedAcceptanceCriteria: ['Patch exists', 'Tests prove the fix', 'Release dry-run passes'],
    proposedPlan: ['Inspect the regression', 'Patch the code', 'Run the release dry-run'],
    createdAt: nowRef.value + 32,
    decidedAt: null,
    decidedBy: null,
  };
  const event: MissionEvent = {
    id: 'event-api-existing',
    missionId: verifying.id,
    attemptId: attempt.id,
    generationId: verifying.activeGenerationId,
    generationIndex: verifying.activeGenerationIndex,
    kind: 'mission.verifying',
    summary: 'Mission moved into verification.',
    detail: null,
    metadata: {
      source: 'test',
      cycleResult: createMissionCycleResult({
        mission: verifying,
        attempt,
        checklistSnapshot: createMissionChecklistSnapshot(verifying, {
          at: nowRef.value + 6,
          generationId: verifying.activeGenerationId,
        }),
        cycle: 1,
        status: 'retry',
        stage: 'verifier.repair',
        progress: 'Verification found missing release dry-run evidence.',
        nextStep: 'Retry the mission with the missing verification evidence.',
        verifierSummary: 'Verification found missing release dry-run evidence.',
        blocker: 'Release dry-run evidence is still missing.',
        evidence: {
          missingAcceptanceCriteria: ['Release dry-run passes'],
        },
        eventSeq: 1,
        updatedAt: nowRef.value + 33,
      }),
    },
    createdAt: nowRef.value + 33,
  };

  repo.saveMission(verifying);
  repo.saveWorkItem(createMissionWorkItem(verifying, { at: nowRef.value + 5 }));
  repo.saveGeneration(createMissionGeneration(verifying, {
    at: nowRef.value + 5,
    trigger: 'initial',
  }));
  repo.saveChecklistSnapshot(createMissionChecklistSnapshot(verifying, {
    at: nowRef.value + 6,
    generationId: verifying.activeGenerationId,
  }));
  repo.savePlanChangeRequest(planChangeRequest);
  repo.saveAttempt(attempt);
  repo.appendEvent(event);

  const listResult = await api.queries.listMissionSummaries({
    meta: {
      requestId: 'req-list-1',
      correlationId: 'corr-list-1',
      idempotencyKey: 'idem-list-1',
    },
    input: {
      filter: {
        platform: 'weixin',
      },
    },
  });
  assert.equal(listResult.meta.requestId, 'req-list-1');
  assert.equal(listResult.data.length, 1);
  assert.equal(listResult.data[0]?.mission.id, verifying.id);
  assert.equal(listResult.data[0]?.latestBlocker, 'Waiting for the verification pass.');
  assert.equal(listResult.data[0]?.pendingApproval?.requestId, 'approval-api-1');
  assert.equal(listResult.data[0]?.executionRefs.providerRunId, 'run-api-1');
  assert.equal(listResult.data[0]?.artifactRefs[0]?.path, '/tmp/report.md');
  assert.equal(listResult.data[0]?.latestCycleResult?.status, 'retry');

  const detailResult = await api.queries.getMissionDetail({
    meta: {
      requestId: 'req-detail-1',
      correlationId: null,
      idempotencyKey: null,
    },
    input: {
      missionId: verifying.id,
    },
  });
  assert.equal(detailResult.data?.workItem?.id, verifying.workItemId);
  assert.equal(detailResult.data?.activeGeneration?.id, verifying.activeGenerationId);
  assert.equal(detailResult.data?.currentChecklistSnapshot?.id, verifying.currentChecklistSnapshotId);
  assert.equal(detailResult.data?.planChangeRequests.length, 1);
  assert.equal(detailResult.data?.attempts.length, 1);
  assert.equal(detailResult.data?.latestCycleResult?.stage, 'verifier.repair');

  const timelineResult = await api.queries.getMissionTimeline({
    meta: {
      requestId: 'req-timeline-1',
      correlationId: 'corr-timeline-1',
      idempotencyKey: null,
    },
    input: {
      missionId: verifying.id,
    },
  });
  assert.equal(timelineResult.data?.entries.length, 5);
  assert.deepEqual(
    timelineResult.data?.entries.map((entry) => entry.type),
    ['generation', 'checklist_snapshot', 'attempt', 'plan_change_request', 'event'],
  );

  const attemptsResult = await api.queries.getMissionAttempts({
    meta: {
      requestId: 'req-attempts-1',
      correlationId: null,
      idempotencyKey: null,
    },
    input: {
      missionId: verifying.id,
    },
  });
  assert.equal(attemptsResult.data?.attempts[0]?.providerRunId, 'run-api-1');

  const executionResult = await api.queries.getMissionExecution({
    meta: {
      requestId: 'req-execution-1',
      correlationId: 'corr-execution-1',
      idempotencyKey: null,
    },
    input: {
      missionId: verifying.id,
    },
  });
  assert.equal(executionResult.data?.hostBindings.bridgeSessionId, 'session-api-1');
  assert.equal(executionResult.data?.executionRefs.workflowPath, '/repo/.codexbridge/mission/WORKFLOW.md');
  assert.equal(executionResult.data?.artifactRefs[0]?.name, 'report.md');
  assert.equal(executionResult.data?.latestCycleResult?.audit.eventSeq, 1);
});

test('direct mission control api commands persist retry, resume, and stop transitions', async () => {
  const { repo, api, nowRef } = createApiHarness(1_701_200_100_000);

  const completedBase = createQueuedMission(nowRef.value);
  const completedRunning = transitionMission(completedBase, 'running', {
    at: nowRef.value + 20,
    activeAttemptId: 'attempt-api-retry-1',
  });
  const completedVerifying = transitionMission(completedRunning, 'verifying', {
    at: nowRef.value + 30,
  });
  const completedMission = transitionMission(completedVerifying, 'completed', {
    at: nowRef.value + 40,
    reason: 'Verification passed.',
    lastResultPreview: 'Verified repair summary.',
    resultText: 'Verified repair summary.',
  });
  completedMission.attemptCount = 1;
  repo.saveMission(completedMission);
  repo.saveWorkItem(createMissionWorkItem(completedMission, { at: nowRef.value + 10 }));
  repo.saveGeneration(createMissionGeneration(completedMission, {
    at: nowRef.value + 10,
    trigger: 'initial',
  }));
  repo.saveChecklistSnapshot(createMissionChecklistSnapshot(completedMission, {
    at: nowRef.value + 11,
    generationId: completedMission.activeGenerationId,
  }));

  const retryResult = await api.commands.retryMission({
    meta: {
      requestId: 'req-retry-1',
      correlationId: 'corr-retry-1',
      idempotencyKey: 'idem-retry-1',
    },
    input: {
      missionId: completedMission.id,
      reason: 'User requested another pass.',
      codexThreadId: 'thread-api-retry-2',
      actor: {
        actorId: 'wx-user-1',
        actorType: 'user',
      },
    },
  });
  assert.equal(retryResult.data.mission.status, 'queued');
  assert.equal(retryResult.data.mission.activeGenerationIndex, 2);
  assert.equal(retryResult.data.mission.codexThreadId, 'thread-api-retry-2');
  assert.equal(repo.listGenerations(completedMission.id).length, 2);
  assert.equal(repo.listChecklistSnapshots(completedMission.id).length, 2);
  assert.equal(repo.listEvents(completedMission.id).slice(-1)[0]?.kind, 'mission.retrying');

  const waitingBase = createQueuedMission(nowRef.value + 1_000);
  const waitingRunning = transitionMission(waitingBase, 'running', {
    at: nowRef.value + 1_020,
    activeAttemptId: 'attempt-api-resume-1',
    lastResultPreview: 'Collected the target branch candidates.',
  });
  const waitingMission = transitionMission(waitingRunning, 'waiting_user', {
    at: nowRef.value + 1_030,
    reason: 'Need the user to confirm the target branch.',
    lastError: 'Need the user to confirm the target branch.',
  });
  waitingMission.attemptCount = 1;
  repo.saveMission(waitingMission);
  repo.saveWorkItem(createMissionWorkItem(waitingMission, { at: nowRef.value + 1_010 }));

  const resumeResult = await api.commands.resumeMission({
    meta: {
      requestId: 'req-resume-1',
      correlationId: null,
      idempotencyKey: null,
    },
    input: {
      missionId: waitingMission.id,
      reason: 'User supplied the branch name.',
      actor: {
        actorId: 'wx-user-2',
        actorType: 'user',
      },
    },
  });
  assert.equal(resumeResult.data.mission.status, 'queued');
  assert.equal(resumeResult.data.mission.attemptCount, 1);
  assert.equal(repo.listEvents(waitingMission.id).slice(-1)[0]?.kind, 'mission.queued');

  const stopBase = createQueuedMission(nowRef.value + 2_000);
  const stopMission = transitionMission(stopBase, 'running', {
    at: nowRef.value + 2_020,
    activeAttemptId: 'attempt-api-stop-1',
  });
  const stopAttempt: MissionAttempt = {
    id: 'attempt-api-stop-1',
    missionId: stopMission.id,
    generationId: stopMission.activeGenerationId,
    generationIndex: stopMission.activeGenerationIndex,
    checklistSnapshotId: stopMission.currentChecklistSnapshotId,
    index: 1,
    status: 'running',
    providerRunId: 'run-api-stop-1',
    providerThreadId: 'thread-api-stop-1',
    promptDigest: 'digest-api-stop-1',
    verifierVerdict: null,
    verifierSummary: null,
    missingAcceptanceCriteria: [],
    outputPreview: null,
    error: null,
    startedAt: nowRef.value + 2_020,
    endedAt: null,
    createdAt: nowRef.value + 2_020,
    updatedAt: nowRef.value + 2_020,
  };
  repo.saveMission(stopMission);
  repo.saveWorkItem(createMissionWorkItem(stopMission, { at: nowRef.value + 2_010 }));
  repo.saveAttempt(stopAttempt);

  const stopResult = await api.commands.stopMission({
    meta: {
      requestId: 'req-stop-1',
      correlationId: 'corr-stop-1',
      idempotencyKey: null,
    },
    input: {
      missionId: stopMission.id,
      reason: 'Stop requested by the host.',
      actor: {
        actorId: 'bridge',
        actorType: 'host',
      },
    },
  });
  assert.equal(stopResult.data.mission.status, 'stopped');
  assert.equal(repo.getAttemptById(stopAttempt.id)?.status, 'stopped');
  assert.deepEqual(
    repo.listEvents(stopMission.id).slice(-2).map((event) => event.kind),
    ['attempt.stopped', 'mission.stopped'],
  );
});

test('direct mission control api stream emits detail first and then timeline history', async () => {
  const { repo, api, nowRef } = createApiHarness(1_701_200_200_000);
  const queued = createQueuedMission(nowRef.value);
  const waiting = createMissionResumeSnapshot(transitionMission(transitionMission(queued, 'running', {
    at: nowRef.value + 20,
    activeAttemptId: 'attempt-api-stream-1',
  }), 'waiting_user', {
    at: nowRef.value + 30,
    reason: 'Need the branch name.',
    lastError: 'Need the branch name.',
  }), {
    at: nowRef.value + 40,
    reason: 'User supplied the branch name.',
  });
  repo.saveMission(waiting);
  repo.saveWorkItem(createMissionWorkItem(waiting, { at: nowRef.value + 10 }));
  repo.saveGeneration(createMissionGeneration(waiting, {
    at: nowRef.value + 10,
    trigger: 'initial',
  }));
  repo.saveChecklistSnapshot(createMissionChecklistSnapshot(waiting, {
    at: nowRef.value + 11,
    generationId: waiting.activeGenerationId,
  }));

  const frames: string[] = [];
  for await (const frame of api.streams.streamMission({
    meta: {
      requestId: 'req-stream-1',
      correlationId: 'corr-stream-1',
      idempotencyKey: null,
    },
    input: {
      missionId: waiting.id,
      includeHistory: true,
    },
  })) {
    frames.push(frame.data.type);
  }

  assert.deepEqual(frames, ['detail', 'timeline_entry', 'timeline_entry']);
});
