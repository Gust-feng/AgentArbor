# V0.5 Underground user clarification and escalation

## Goal

Add the first deterministic Underground Center user clarification and escalation mechanism. The feature must let blocking unknowns converge into an `awaiting_user` Underground outcome and direction handoff package while preserving the existing approved happy path, fixed 18-event minimal loop, and Aboveground planning boundary.

## Requirements

- Add focused Underground clarification/escalation domain types, preferably under `src/domain/underground/clarification.ts`.
- Clarification reasons must cover at least goal conflict, unclear permission boundary, critical fact missing, value tradeoff required, and unclear hard constraint.
- A user clarification request must include goal id, related candidate refs, questions, blocking level, createdAt, and status.
- Extend Underground convergence reporting so `outcome = "awaiting_user"` can carry a user clarification request.
- Preserve the invariant that non-blocking unknowns may remain open questions, but blocking unknowns require user clarification before approved handoff.
- Add helper logic to classify unknowns into blocking clarification requests versus non-blocking open questions.
- Add a deterministic underground-only way to create and save an `awaiting_user` Direction Handoff Package for tests/demo-like scenarios.
- Keep `createMinimalDirectionMaterial` and the main approved happy path behavior unchanged.
- Ensure `awaiting_user` packages validate/save as not approved and are rejected by Aboveground planning.
- Add a small deterministic underground-only scenario/helper that produces an awaiting-user exploration report, clarification request, awaiting-user package, and EventLog entry such as `user_approval.requested`.
- Extend Observation Kernel so `underground.userEscalation` exposes the clarification request, reason, blocking status, and questions.
- Surface clarification/user-approval refs in event views when the event payload carries them, adding a stable JSON-safe `ObservationRef` kind only if needed.
- Keep `pnpm demo` primary happy-path output working; any clarification summary must not confuse the primary demo.
- Update `.trellis/spec/backend/underground-radial-growth.md` or a focused spec for the stable V0.5 contract.
- Update `docs/任务看板/看板.md` to show V0.5 as the current task.

## Acceptance Criteria

- [ ] Existing tests still pass.
- [ ] A blocking unknown candidate/convergence state creates a blocking `UserClarificationRequest`.
- [ ] An `awaiting_user` report/package cannot enter Aboveground planning.
- [ ] A non-blocking unknown remains an open question and does not enter handoff candidates.
- [ ] Observation snapshot exposes user escalation and clarification request details.
- [ ] Main 18-event happy path sequence remains unchanged.
- [ ] `pnpm demo` happy path output remains clear and functional.
- [ ] No UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, AG-UI adapter, or repo-root `.agentarbor` runtime writes are introduced.

## Definition of Done

- `pnpm build` passes.
- `pnpm test` passes.
- `pnpm demo` passes.
- `git diff --check` passes.
- `git diff --cached --check` passes.
- Confirm `.agentarbor/` has no tracked or staged runtime assets.
- Confirm no prohibited UI/transport/database/model/adapter work was introduced.

## Technical Approach

Implement V0.5 as a deterministic extension of the existing Underground and handoff package contracts:

- Keep clarification as Underground domain data, not UI or transport behavior.
- Extend convergence and handoff material with explicit `awaiting_user` data instead of overloading approved material.
- Keep Aboveground planning strict by continuing to require approved, validated packages loaded from the package store.
- Project clarification data into Observation Kernel as readonly JSON-safe data derived from EventLog/runtime result inputs.
- Add tests around the new waiting path while pinning the existing 18-event happy-path sequence.

## Out of Scope

- UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, AG-UI adapter.
- Repo-root `.agentarbor` writes or tracked runtime assets.
- Changing the approved happy path or its 18-event sequence.
- Allowing `awaiting_user` packages to enter Aboveground planning.
- Creating long-term Soil assets, Capability Assets, or platform adapter files.

## Technical Notes

- Worktree is expected to start clean after commit `59642c5 feat: 完善运行观测内核`.
- Respect existing module boundaries: `domain / kernel / adapters / app`.
- Relevant specs are curated in `implement.jsonl` and `check.jsonl`.
- Current validation commands are `pnpm build`, `pnpm test`, and `pnpm demo`.
