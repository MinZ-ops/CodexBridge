# Mission Control TODO

This document tracks the implementation backlog for
`@codexbridge/mission-control`.

It is the execution-oriented companion to:

- `docs/architecture/mission-control.md`
- `docs/todo/roadmap.md`

## Track Branch

Primary long-lived branch for this workstream:

```text
track/mission-control
```

Expected file ownership for this branch:

- `packages/mission-control/**`
- `docs/architecture/mission-control.md`
- `docs/todo/mission-control.md`
- mission-control-specific integration files when they are introduced

Avoid frequent edits here unless the change is truly cross-cutting:

- `docs/todo/roadmap.md`
- `README.md`
- `package.json`

## Scope

Mission Control should become the goal-driven runtime that keeps Codex working
until the requested outcome is actually finished, explicitly blocked, or
explicitly failed.

It should own:

- mission domain model
- mission state machine
- workflow loading
- workspace selection/isolation
- run / verify / repair / retry loop
- persisted attempts, events, workpad, and runner leases
- provider abstraction
- stop / retry / approve / resume control actions

It should **not** own:

- WeChat/Telegram message parsing
- SendGate delivery mechanics
- slash-command help text
- platform binding/session browsing UX
- assistant-record storage as a separate product concern
- provider-profile CLI management
- bridge i18n and command aliasing

## Reference Stack

Mission Control should be informed by these upstream projects:

- [ ] `openai/symphony`
  - use for: orchestrator/workspace/workpad/retry/status model
- [ ] `openai/openai-agents-js`
  - use for: future OpenAI-native provider adapter surface
- [ ] `langchain-ai/langgraphjs`
  - use for: explicit state graph and resumable execution ideas
- [ ] `inngest/inngest`
  - use for: durable queued step execution and retry semantics
- [ ] `dbos-inc/dbos-transact-ts`
  - use for: persistence-first workflow ownership and restart recovery
- [ ] `mastra-ai/mastra`
  - use for: TS runtime/package composition patterns
- [ ] `VoltAgent/voltagent`
  - use for: TS agent engineering/runtime layering patterns
- [ ] local `codex-mission-control` prototype copy
  - use for: bounded mission contract, lease ownership, tmux supervision,
    heartbeat recovery, checkpoint/workpad seed ideas

Rules for references:

- [ ] Record *why* each reference matters before copying any implementation idea
- [ ] Do not vendor external runtime code unless there is a clear local ownership reason
- [ ] Prefer adapting concepts into CodexBridge-native abstractions over mirroring upstream APIs
- [ ] Keep the current product target primary: CodexBridge chat-first mission execution
- [ ] Keep the final product/package name as `Mission Control`; treat
  `codex-mission-control` as a predecessor prototype, not the target identity
- [ ] Do not rely on a local `reference/symphony` copy existing; upstream spec is
  the source of truth unless a local mirror is explicitly synced

## Symphony Essence Checklist

Mission Control should preserve these Symphony ideas as explicit design
constraints, not just as vague inspiration:

- [ ] Repository-owned workflow contract is the primary runtime policy source
- [ ] Single-authority orchestrator owns dispatch, retries, cancellation, and
  reconciliation
- [ ] Stable workspace identity survives retries and normal exits
- [ ] Continuation after normal exit is supported; retries are not failure-only
- [ ] Handoff or waiting-human outcomes are first-class mission states
- [ ] Status surfaces observe and control the orchestrator but do not own run
  execution
- [ ] Policy/config/coordination/execution/status layers remain separated

## Packaging Direction

The package should start as an internal package inside the CodexBridge
repository:

```text
packages/mission-control/
```

Rules:

- `CodexBridge -> @codexbridge/mission-control`
- `@codexbridge/mission-control -X-> CodexBridge platform/runtime/command code`
- No workspace/monorepo conversion is required yet.
- Follow the same internal-package pattern already used by
  `packages/codex-gateway`.

Package bootstrap target:

- [x] Package root: `packages/mission-control`
- [x] Package metadata: `packages/mission-control/package.json`
- [x] Package source entry: `packages/mission-control/src/index.ts`
- [x] Package tsconfig: `packages/mission-control/tsconfig.json`
- [x] Package README documents ownership and non-ownership
- [x] Root scripts:
  - `mission-control:typecheck`
  - `mission-control:test`
  - `mission-control:build`
  - `mission-control:check-boundary`
- [x] Boundary script prevents imports from:
  - `src/platforms/**`
  - `src/runtime/**`
  - `src/i18n/**`
  - `src/cli.ts`
  - WeChat/Telegram command handlers

## Recommended Route

This backlog follows the route below:

- [ ] Use Symphony to define the orchestrator/workspace/retry/state-machine shape
- [ ] Preserve the Symphony idea that normal worker exit may still schedule a
  continuation retry
- [ ] Preserve the Symphony idea that handoff/waiting states are legitimate
  mission outcomes, not only failures
- [ ] Use current Codex app-server flow as the first real provider:
  `CodexMissionProvider`
- [ ] Add a future `OpenAIAgentsMissionProvider` on top of
  `openai-agents-js`, not as the default runtime
- [ ] Use LangGraph.js / Inngest / DBOS as durability and resumability
  references
- [ ] Reuse only the prototype pieces from local `codex-mission-control` that
  survive the provider-pluggable package boundary
- [ ] Converge the result into one provider-pluggable internal package:
  `@codexbridge/mission-control`

## Phase 0: Baseline Current `/agent` Behavior

Before moving ownership into the package:

- [ ] Record the current `/agent` public behavior that users already rely on
- [ ] Lock current `/agent` migration-protection tests covering:
  - create / confirm / cancel
  - list / show / stop / retry / result
  - approval + interrupted-turn handling
  - artifact/result delivery
- [ ] Record the current `/auto` behavior that should later delegate into mission runs

## Phase 1: Domain and Persistence

Create the core durable mission model.

- [ ] Add `MissionStatus`, `MissionSource`, and `MissionPriority` types
- [ ] Add `Mission`, `MissionAttempt`, `MissionEvent`, and `MissionWorkpad` types
- [ ] Add explicit state transition helpers
- [ ] Add a persistence port:
  - `MissionStore`
  - `MissionAttemptStore`
  - `MissionEventStore`
  - or one combined `MissionRepository`
- [ ] Add a first local persistence implementation using the existing CodexBridge
  storage style
- [ ] Persist enough state to recover after process restart:
  - mission
  - attempt
  - workpad
  - event log
  - lease/lock
  - pending approval/block reason
- [ ] Add one authority for runtime state ownership instead of splitting active
  mission state across ad hoc background-job records

Completion criteria:

- [ ] A mission can be created, listed, read, updated, and stopped without
  starting a provider run
- [ ] State transitions are explicit and testable
- [ ] Restart recovery can identify resumable missions

## Phase 2: Workflow and Workpad

- [ ] Add `MissionWorkflowLoader` for `.codexbridge/mission/WORKFLOW.md`
- [ ] Parse YAML front matter plus prompt body
- [ ] Keep workflow config as the primary policy surface instead of embedding
  run behavior into slash-command handlers
- [ ] Define a canonical mission-attempt prompt contract so prompt,
  orchestrator, and verifier responsibilities stay separated
- [ ] Add safe built-in defaults when the file is missing
- [ ] Reject mission execution when workflow config is invalid, but do not block
  normal bridge startup
- [ ] Design the config layer so path/env/default resolution can evolve toward a
  typed workflow-policy contract
- [ ] Add workpad rendering helpers for:
  - compact summary
  - latest blocker
  - attempt history
  - final result summary
- [ ] Add `/agent show` integration so workpad becomes the main status view

Completion criteria:

- [ ] Workflow source is visible in mission status
- [ ] Workpad can survive restart and multiple attempts

## Phase 3: Workspace and Lease Management

- [ ] Add `MissionWorkspaceService`
- [ ] Create default directory layout under `~/.codexbridge/mission/`
- [ ] Add code-changing mission isolation under
  `~/.codexbridge/mission/workspaces/<missionId>/`
- [ ] Make workspace identity deterministic per mission so retries and
  continuation reuse the same execution context safely
- [ ] Allow safe reuse of bound cwd for read-only missions
- [ ] Add runner lease records to prevent duplicate workers
- [ ] Add stale-lease recovery

Completion criteria:

- [ ] Concurrent mission limit is enforced
- [ ] One mission cannot accidentally resume inside another mission workspace
- [ ] Restarting the bridge does not create duplicate active runners

## Phase 4: Codex Provider Adapter

The first real provider is current Codex app-server execution.

- [ ] Add `MissionProvider` port
- [ ] Add `CodexMissionProvider`
- [ ] Reuse provider profile + Codex thread binding safely
- [ ] Support:
  - start
  - continue
  - wait
  - interrupt
- [ ] Persist provider run/thread ids at the attempt level
- [ ] Map Codex-native interrupted/blocking/completed outcomes into mission
  status
- [ ] Treat normal provider exit as eligible for continuation when the mission
  is still active and budget remains

Completion criteria:

- [ ] Mission Control can drive a real Codex run without importing WeChat code
- [ ] Stop/retry behavior remains chat-visible through CodexBridge integration

## Phase 5: Verification Loop

This phase is the core difference between a background chat wrapper and a real
mission runtime.

- [ ] Add `MissionVerifier`
- [ ] Normalize verifier verdicts:
  - `complete`
  - `repair`
  - `blocked`
  - `failed`
- [ ] Persist verifier summaries and missing acceptance criteria
- [ ] Add repair prompt generation / reuse
- [ ] Enforce:
  - max attempts
  - max turns
  - max runtime
  - artifact count/size budget
- [ ] Make `waiting_user` / `needs_human` / `handoff` explicit verifier- or
  provider-driven outcomes instead of generic failure buckets

Completion criteria:

- [ ] "Completed" means acceptance criteria passed
- [ ] Missions do not silently stop after one provider response
- [ ] Repair/retry is bounded and observable

## Phase 6: CodexBridge Integration

- [ ] Make `/agent` call Mission Control instead of owning the runner directly
- [ ] Make `/auto` schedule Mission Control runs instead of separate background
  job logic
- [ ] Reuse the same mission state for:
  - list
  - show
  - stop
  - retry
  - result
- [ ] Keep WeChat as the first-class notification/control surface
- [ ] Preserve current user-facing behavior as much as possible during migration

Completion criteria:

- [ ] `/agent` remains the Mission v0 surface
- [ ] No new `/mission` command is required yet
- [ ] Existing users do not need to learn a new mental model

## Phase 7: Optional Web Surface

Only after chat control is solid:

- [ ] Add a mission list page
- [ ] Add mission detail page with workpad and attempt history
- [ ] Add manual operator actions:
  - retry
  - stop
  - approve
  - archive
- [ ] Read/write the same persisted mission records used by chat

Guardrail:

- [ ] The web UI must not become the source of truth for mission state

## Later Providers and Sources

Provider expansion:

- [ ] `OpenAIAgentsMissionProvider`
- [ ] future provider-pluggable long-task executors if they can support durable
  run semantics

Source expansion:

- [ ] GitHub issues
- [ ] Linear issues
- [ ] assistant-record promotion
- [ ] desktop/browser companion work

## Completion Criteria

Mission Control is ready for broader extraction when:

- [ ] A user can give one goal and the system keeps working until it completes,
  blocks, fails, or is stopped
- [ ] Restart recovery works for queued/running/verifying missions
- [ ] `/agent` and `/auto` both use the same mission runtime
- [ ] The package has no imports from platform/runtime/i18n command code
- [ ] A later Telegram or web surface can integrate without changing mission
  core behavior
