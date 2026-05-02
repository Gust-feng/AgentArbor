# V0.4 Observation Kernel refinement

## Goal

Upgrade the existing `RunObservationSnapshot` from a minimal V0.3 run snapshot into a JSON-safe cross-run Observation Kernel read model for a future frontend workbench. The EventLog remains the source of truth and the snapshot remains a derived read model only.

## Requirements

- Extend the observation domain model with stable public concepts: `RunPhase`, `RunStage`, `ObservationScope`, `ObservationSeverity`, `ObservationProgress`, `ObservationRef`, and `ObservationStatus`.
- Replace the untyped `currentPhase: string` contract with a stable `RunPhase` while preserving any compatibility needed by existing callers and tests.
- Extend `RunObservationEventView` with frontend-readable `summary`, `scope`, `severity`, `progress`, and `refs`.
- Restructure `RunObservationSnapshot` into explicit layer views: `underground`, `handoff`, `aboveground`, `fruits`, `governance`, and `soilReturnStub`.
- Prefer the new explicit `handoff` layer over the old `directionPackageRef`; retain compatibility only if current callers or tests need it.
- Expose underground rootlet clusters, candidates, convergence decisions, budget, and user escalation so a future frontend can inspect each rootlet, candidate, and decision.
- Keep aboveground, fruits, governance, and soil return views stable and future-extensible even if they are summary/stub structures in V0.4.
- Keep `createRunObservationSnapshot` as the public entrypoint.
- Modularize observation projection into focused files such as event view projection, phase/stage resolution, layer views, and JSON-safe finalization where this matches the repository style.
- Keep snapshot output plain JSON-safe readonly data with no classes, functions, runtime/store references, or mutable live references.
- Keep `pnpm demo` printing the full EventLog and improve the observation summary with phase/stage, event cursor, layer statuses, and readable underground candidate/convergence details.
- Update `.trellis/spec/backend/observation-read-model.md` to the V0.4 Observation Kernel contract.
- Update `docs/任务看板/看板.md` so V0.4 is the current task and V0.3 is moved into the appropriate context.

## Acceptance Criteria

- [ ] Existing V0.3 tests keep passing.
- [ ] Snapshot JSON round-trip is covered.
- [ ] `currentPhase` and `RunStage` are derived from EventLog.
- [ ] Event views include `summary`, `scope`, `severity`, `progress`, and `refs`.
- [ ] Event view projection does not read runtime stores.
- [ ] Underground view lists every rootlet, candidate, and convergence decision.
- [ ] Direction Handoff Package behavior does not regress.
- [ ] Aboveground store load behavior does not regress.
- [ ] Main EventLog sequence remains the V0.3 18-step sequence unless tests reveal a concrete need.
- [ ] `pnpm build`, `pnpm test`, `pnpm demo`, `git diff --check`, and `git diff --cached --check` pass before handoff.
- [ ] `.agentarbor/` has no tracked or staged runtime assets introduced by this task.
- [ ] No UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, or AG-UI adapter is introduced.

## Definition of Done

- Implementation follows current TypeScript runtime architecture and repository conventions.
- Public contracts and tests reflect the V0.4 Observation Kernel read model.
- Specs and task board are updated without creating a second planning surface such as root `Plan/` or `Plans/`.
- Worktree changes remain focused; no user changes are reset, reverted, unstaged, or discarded.
- No commit is created for this task.

## Technical Approach

Use the EventLog as the only source of truth and build a layered read model by projecting existing deterministic runtime events. Keep the V0.3 event sequence stable, add frontend-readable metadata at the projection layer, and split observation projection responsibilities into small modules under the existing observation domain boundary.

## Decision (ADR-lite)

Context: V0.3 introduced a minimal `RunObservationSnapshot`, but frontend workbench needs require a stable cross-run read model that exposes phase, stage, layer status, event cursor, and underground inspection data without making the snapshot a second source of truth.

Decision: Implement V0.4 as a derived Observation Kernel read model. Preserve `createRunObservationSnapshot` and the EventLog sequence, enrich event views and layered snapshot views, and keep all output JSON-safe.

Consequences: Future UI and adapter work can read a stable observation model without depending on live runtime stores. The snapshot remains intentionally derived, so new operational behavior must still enter through EventLog and domain stores rather than being authored directly in the observation layer.

## Out of Scope

- UI or frontend workbench implementation.
- HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, or AG-UI adapters.
- New package manager, build system, runtime framework, or test framework.
- New EventLog events unless existing tests reveal a concrete need.
- Pre-filling `.agentarbor/` runtime assets.
- Creating root `Plan/` or `Plans/`.

## Technical Notes

- Baseline commit: `e0d23ab feat: 引入辐射Agent集群，增加运行观测快照`.
- Initial user-approved plan names `src/domain/observation/contracts.ts`, `src/domain/observation/snapshot.ts`, `src/app/minimal-loop.ts`, `.trellis/spec/backend/observation-read-model.md`, and `docs/任务看板/看板.md` as expected impact areas.
- Use `pnpm + TypeScript + tsc + node:test`.
- Keep changes narrowly scoped and do not commit.
