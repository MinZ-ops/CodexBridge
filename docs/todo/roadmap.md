# CodexBridge Roadmap TODO

This document tracks the backlog that is still intentionally unfinished.
Completed items are removed from the active checklist instead of being left as
stale TODOs.

## Current Snapshot

Already landed and no longer part of the active backlog:

- `/review` for uncommitted changes and base-branch review
- `/agent` experimental Codex-first hybrid background jobs with draft-confirm, full-access Codex execution, verifier checks, and retry
- `/plan` session-level native planning mode toggle
- `/skills` visibility and on/off management
- `/apps` runtime connector browsing, auth hints, and enable/disable management
- `/plugins` visibility, aliasing, install/uninstall, and explicit plugin targeting
- `/mcp` status, auth, reload, and enable/disable management
- `/automation` draft-confirm flow and WeChat delivery-oriented scheduling
- Assistant records via `/as`, `/log`, `/todo`, `/remind`, and `/note`, including Codex-normalized natural-language record updates, `/up` attachment archival, and reminder claiming
- WeChat thread browsing with `/threads`, `/open`, `/search`, `/peek`, `/rename`
- Thread cleanup and organization flows such as archive/restore and pin/unpin
- Native-ish reconnect, retry, approval, and attachment delivery hardening

Important clarification:

- A separate `/resume` command is **not** a current priority because bridge UX
  already treats `/open <thread>` as the practical “resume this old session”
  path.
- A separate `/cwd` command is **not** a current priority because `/status`
  already exposes the current bound session and working-directory context well
  enough for now.

## Current Priority: Make WeChat a Stable Codex Terminal

The next phase should prioritize day-to-day runtime reliability and native
Codex output quality over adding more bridge-only command surface area.

### P0: WeChat runtime reliability

- [ ] Keep improving native approval, interrupted-turn, reconnect, and retry handling around long-running tasks
- [ ] Stabilize WeChat preview/final delivery around send-budget limits, `ret:-2`, and long-reply recovery
- [ ] Ensure plugin/auth/unavailable-capability failures always surface as clear chat-visible guidance instead of silent stalls
- [ ] Keep parser/helper/internal bridge threads hidden from normal thread browsing and automatically cleaned up
- [ ] Keep `/open`, `/threads`, and `/status` optimized for fast real-world session recovery instead of adding redundant resume-style commands

### P1: Native output and delivery quality

- [ ] Continue expanding provider-native artifact delivery instead of adding more bridge-only glue
- [ ] Support more Codex-native output kinds with consistent attachment metadata and delivery policy
- [ ] Keep refining file delivery defaults so generated artifacts feel like first-class Codex outputs
- [ ] Improve model / usage / thread introspection where Codex already exposes reliable primitives
- [ ] Read project-local `.codex` environment metadata so shared local environment setup can inform bridge runs

### P2: Assistant and desktop follow-through

- [ ] Keep improving assistant-record, reminder, and automation delivery quality on WeChat
- [ ] Add optional sync targets for assistant records, such as Notion, Google Drive, or Calendar, while keeping local records as source of truth
- [ ] Design a browser-preview workflow that approximates Codex app browser comments and browser-use results in chat
- [ ] Design a companion-based computer-use workflow for desktop GUI tasks with explicit approvals and app allowlists
- [ ] Decide whether these desktop-native abilities belong in CodexBridge itself or in a separate local companion service

### Guardrail

- [ ] Do not prioritize new bridge-only slash commands ahead of high-value native Codex parity work unless the native layer is unavailable
- [ ] Do not add bridge-only aliases when existing commands already cover the user need well enough, such as `/open` for resume-style continuation or `/status` for cwd/session inspection

## Later Direction: Telegram Runtime

The bridge-side Telegram plugin contract exists, but the real transport stack is
still a later-phase item.

- [ ] Add a real Telegram inbound poller or webhook runtime
- [ ] Add real Telegram outbound transport for text, typing, media, and files
- [ ] Wire Telegram runtime into the same persisted bridge-session flow used by WeChat
- [ ] Verify the same bridge session can be continued across WeChat and Telegram end-to-end

## Later Direction: Additional Codex-Compatible Providers

The provider wrappers exist, but non-OpenAI backends still need actual runtime
integration.

- [ ] Implement the MiniMax via CLIProxyAPI runtime path
- [ ] Validate provider-specific model catalogs, defaults, and usage reporting
- [ ] Verify provider switching boundaries under real runtime conditions

## Engineering Hardening

These are quality improvements, not current product blockers.

- [ ] Reduce `any` in edge adapters and test scaffolding
- [ ] Tighten null handling where it adds real signal
- [ ] Remove remaining transitional typing workarounds when feature churn settles
- [ ] Incrementally strengthen compiler settings after behavior remains stable
