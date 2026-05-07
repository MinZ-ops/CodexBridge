import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  JsonFileMissionRepository,
  createManualWorkItemSourceSummary,
  createMission,
  createMissionChecklistSnapshot,
  persistMissionProgressUpdate,
  transitionMission,
  type MissionAttempt,
} from '../src/index.js';

test('manual work item source summaries normalize source-backed checklist fields', () => {
  const summary = createManualWorkItemSourceSummary({
    source: 'manual',
    sourceRef: 'manual:todo-1',
    sourceRevision: 'rev-1',
    title: '  Repair the flaky preview test  ',
    goal: '  Keep the preview flow stable. ',
    expectedOutput: ' Verified repair summary. ',
    acceptanceCriteria: [' Patch exists ', ' ', 'Tests pass'],
    plan: [' Inspect failures ', '', 'Re-run tests'],
    metadata: {
      owner: 'mission-control',
    },
  });

  assert.equal(summary.source, 'manual');
  assert.equal(summary.sourceRef, 'manual:todo-1');
  assert.equal(summary.sourceRevision, 'rev-1');
  assert.equal(summary.title, 'Repair the flaky preview test');
  assert.equal(summary.goal, 'Keep the preview flow stable.');
  assert.equal(summary.expectedOutput, 'Verified repair summary.');
  assert.deepEqual(summary.acceptanceCriteria, ['Patch exists', 'Tests pass']);
  assert.deepEqual(summary.plan, ['Inspect failures', 'Re-run tests']);
  assert.deepEqual(summary.metadata, { owner: 'mission-control' });
});

test('checklist snapshots persist source revision and deterministic hashes', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-control-source-hash-'));
  const repo = new JsonFileMissionRepository(stateDir);
  const baseMission = transitionMission(createMission({
    id: 'mission-source-hash-1',
    source: 'manual',
    sourceRef: 'manual:todo-1',
    platform: 'weixin',
    externalScopeId: 'wx-source-hash-1',
    title: 'Snapshot hash test',
    goal: 'Persist checklist provenance across reloads.',
    expectedOutput: 'A stored checklist snapshot hash.',
    acceptanceCriteria: ['Hash exists', 'Revision exists'],
    plan: ['Create snapshot', 'Reload repository'],
    providerProfileId: 'codex-default',
    now: 1_701_600_000_000,
  }), 'queued', {
    at: 1_701_600_000_010,
  });
  const snapshot = createMissionChecklistSnapshot(baseMission, {
    at: 1_701_600_000_020,
    sourceRevision: 'manual-rev-1',
  });

  repo.saveMission(baseMission);
  repo.saveChecklistSnapshot(snapshot);

  const reloaded = new JsonFileMissionRepository(stateDir);
  const stored = reloaded.getChecklistSnapshotById(snapshot.id);
  assert.ok(stored?.hash);
  assert.equal(stored?.sourceRevision, 'manual-rev-1');
  assert.equal(stored?.hash, snapshot.hash);
});

test('repository-backed mission progress updates change workpad state without mutating mission lifecycle', () => {
  const repo = new JsonFileMissionRepository(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-control-progress-')));
  const queued = transitionMission(createMission({
    id: 'mission-progress-1',
    source: 'manual',
    sourceRef: 'manual:progress-1',
    platform: 'weixin',
    externalScopeId: 'wx-progress-1',
    title: 'Persist provider progress',
    goal: 'Store progress in the workpad without changing lifecycle state.',
    expectedOutput: 'A persisted progress trail.',
    acceptanceCriteria: ['Workpad is updated'],
    plan: ['Run provider', 'Persist progress'],
    providerProfileId: 'codex-default',
    now: 1_701_600_100_000,
  }), 'queued', {
    at: 1_701_600_100_005,
  });
  const mission = transitionMission(queued, 'running', {
    at: 1_701_600_100_010,
    activeAttemptId: 'attempt-progress-1',
  });
  const attempt: MissionAttempt = {
    id: 'attempt-progress-1',
    missionId: mission.id,
    generationId: mission.activeGenerationId,
    generationIndex: mission.activeGenerationIndex,
    checklistSnapshotId: mission.currentChecklistSnapshotId,
    index: 1,
    status: 'running',
    providerRunId: 'run-progress-1',
    providerThreadId: 'thread-progress-1',
    promptDigest: 'digest-progress-1',
    verifierVerdict: null,
    verifierSummary: null,
    missingAcceptanceCriteria: [],
    outputPreview: null,
    error: null,
    startedAt: 1_701_600_100_010,
    endedAt: null,
    createdAt: 1_701_600_100_010,
    updatedAt: 1_701_600_100_010,
  };

  repo.saveMission(mission);
  repo.saveAttempt(attempt);

  persistMissionProgressUpdate({
    repository: repo,
    now: () => 1_701_600_100_020,
    generateId: () => 'event-progress-1',
    update: {
      missionId: mission.id,
      attemptId: attempt.id,
      checklistItemId: null,
      kind: 'summary',
      message: 'Collected the first failing stack trace.',
    },
  });
  persistMissionProgressUpdate({
    repository: repo,
    now: () => 1_701_600_100_030,
    generateId: () => 'event-progress-2',
    update: {
      missionId: mission.id,
      attemptId: attempt.id,
      checklistItemId: null,
      kind: 'blocker',
      message: 'Need the user to confirm the target branch.',
      metadata: {
        stage: 'approval',
      },
    },
  });

  const storedMission = repo.getMissionById(mission.id);
  assert.equal(storedMission?.status, 'running');
  assert.equal(storedMission?.workpad.summary, 'Collected the first failing stack trace.');
  assert.equal(storedMission?.workpad.latestBlocker, 'Need the user to confirm the target branch.');
  assert.deepEqual(
    storedMission?.workpad.notes.slice(-2),
    [
      'Summary: Collected the first failing stack trace.',
      'Blocker: Need the user to confirm the target branch.',
    ],
  );

  const events = repo.listEvents(mission.id);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.kind), ['attempt.progress', 'attempt.progress']);
  assert.equal(events[1]?.metadata.kind, 'blocker');
});
