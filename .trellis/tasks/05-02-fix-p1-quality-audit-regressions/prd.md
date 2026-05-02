# Fix P1 quality audit regressions

## Goal

Fix the four P1 issues found by the repository quality audit while preserving the current V0.5 uncommitted work, the deterministic minimal runtime boundary, and the existing 18-step happy-path EventLog.

## Requirements

- Fix Underground convergence so a non-blocking unknown without accepted or merged handoff candidates never produces an `awaiting_user` outcome without a `UserClarificationRequest`.
- Ensure non-blocking unknowns remain open questions only; when no handoff candidates exist and the budget is exhausted, convergence must deterministically stop instead of awaiting the user.
- Strengthen Direction Handoff Package validation so it validates the consistency between `directionHandoff.status`, convergence outcome, user escalation flags, user clarification requests, and approved source candidates.
- Ensure tampering an `awaiting_user` package into an approved handoff fails validation and cannot pass Aboveground planning.
- Harden task assignment hard-constraint guards across all conflict policies: unapproved or inactive hard constraints must not default to Assigned.
- Preserve `ask_user` as `UserConfirmationRequiredError`; ensure `governance_review` and other unmet hard policies block or raise explicit errors.
- Make `InMemoryEventLog.list()` and `replay()` return immutable facts or cloned message payloads so callers cannot mutate EventLog internal state.
- Add focused regression tests for each P1 issue without introducing UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, AG-UI adapter, or repo-root `.agentarbor` runtime assets.

## Acceptance Criteria

- [ ] Non-blocking unknown with no accepted or merged candidates and exhausted budget returns `stopped`, not `awaiting_user`.
- [ ] Awaiting-user package tampered to approved fails package validation and Aboveground planning.
- [ ] Hard constraint guard blocks proposed and governance-review cases before Assigned.
- [ ] EventLog external mutation through `list()` or `replay()` cannot alter stored facts.
- [ ] Main happy path remains the fixed 18-event sequence.
- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm demo` passes.
- [ ] `git diff --check` and `git diff --cached --check` pass.
- [ ] `.agentarbor` and Plan/Plans boundary checks confirm no prohibited runtime assets or parallel plan roots were introduced.

## Definition of Done

- Existing V0.5 uncommitted changes are preserved and worked with, not reset, unstaged, reverted, or overwritten.
- TypeScript remains strict with no `any` or `ts-ignore` additions.
- Changes stay inside the deterministic TypeScript runtime and focused Trellis task context.
- Final report lists changed files, key tests, validation commands, and remaining risks.

## Technical Approach

Implement each fix at the owning boundary:

- Underground convergence outcome logic belongs in `src/domain/underground/radial-growth.ts` and its tests.
- Direction Handoff Package consistency belongs in package validation and adjacent package tests/fixtures, so Aboveground planning cannot bypass it.
- Hard constraint conflict policy enforcement belongs in `src/kernel/state-machine/task-state-machine.ts` and state-machine tests.
- EventLog fact immutability belongs in `src/kernel/events/in-memory-event-log.ts` and EventLog tests.

## Out of Scope

- UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, AG-UI adapter.
- Repo-root `.agentarbor/` runtime asset creation.
- New root `Plan/`, `Plans/`, `plans/`, or `PLANS.md`.
- Commit, stage, reset, unstage, revert, or push operations.
- Changing the primary 18-step happy-path EventLog sequence.

## Technical Notes

- This is a follow-up quality repair on top of active V0.5 local changes.
- Relevant project specs are curated in `implement.jsonl` and `check.jsonl`.
- Use `python` for local Trellis scripts in this Windows environment; `python3` is not available.
