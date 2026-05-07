# @codexbridge/mission-control

Mission Control runtime package, currently developed inside the CodexBridge
repository.

Immutable target:

> `@codexbridge/mission-control` provides a durable, goal-driven runtime that
> can keep a mission moving through plan, execute, verify, repair/retry, and
> handoff states until the requested outcome is actually complete, explicitly
> blocked, or needs human input.

This package is intended to own only mission-runtime behavior:

- mission domain model
- mission state machine
- workflow loading
- workspace and lease coordination
- provider abstraction
- run / verify / repair / retry loop
- attempts, events, workpad, and runner state persistence
- stop plus retry/resume requeue control actions
- pending-approval and handoff state modeling
- host-adapter contracts for host-owned bindings, approvals, progress, and notifications

It must not own bridge behavior:

- WeChat or Telegram transports
- slash commands or i18n
- SendGate or platform rate limits
- bridge sessions or thread browsing UX
- approvals as chat wording or UI policy
- assistant records, uploads, or artifact delivery policy
- provider-native in-turn approval replies before a provider-neutral approval
  control port exists

Current phase:

- `phase-9b-manual-source-backed-mission-creation`: package-owned mission
  domain/workflow/workspace/provider/verifier/runtime foundations, first-class
  `WorkItem` / `ChecklistSnapshot` / `PlanChangeRequest` /
  `MissionGeneration` lineage, direct in-process `commands / queries / streams`
  API contracts for `/agent`, a typed `CycleResult` loop protocol persisted on
  mission events, an explicit host-adapter contract for session/thread
  binding plus approval/artifact/notification handoff, a first
  `WorkItemSourceAdapter` contract, a package-owned create path that turns
  normalized manual source summaries into authoritative
  `WorkItem + Mission + Generation + ChecklistSnapshot` records, and a
  repository-backed progress sink that lets providers/hosts append workpad
  progress without mutating lifecycle truth

This package should preserve the Symphony-style separation between:

- policy
- configuration
- coordination
- execution
- status surfaces

CodexBridge may depend on this package as its first host surface. This package
must not import from CodexBridge platform/runtime/store/i18n modules.
