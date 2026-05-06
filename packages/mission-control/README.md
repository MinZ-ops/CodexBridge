# @codexbridge/mission-control

Internal package for the CodexBridge Mission Control runtime.

Immutable target:

> `@codexbridge/mission-control` gives CodexBridge a durable, goal-driven
> runtime that can keep a mission moving through plan, execute, verify,
> repair/retry, and handoff states until the requested outcome is actually
> complete, explicitly blocked, or needs human input.

This package is intended to own only mission-runtime behavior:

- mission domain model
- mission state machine
- workflow loading
- workspace and lease coordination
- provider abstraction
- run / verify / repair / retry loop
- attempts, events, workpad, and runner state persistence
- stop / retry / approve / resume control actions

It must not own bridge behavior:

- WeChat or Telegram transports
- slash commands or i18n
- SendGate or platform rate limits
- bridge sessions or thread browsing UX
- approvals as chat wording or UI policy
- assistant records, automations, uploads, or artifact delivery policy

Current phase:

- `phase-0-bootstrap`: package boundary, ownership contract, package scripts,
  and boundary checks only

This package should preserve the Symphony-style separation between:

- policy
- configuration
- coordination
- execution
- status surfaces

CodexBridge may depend on this package. This package must not import from
CodexBridge platform/runtime/store/i18n modules.
