# V0.3 Underground Center Minimal Radial Growth And Observation Contract

## Goal

Implement V0.3 of the deterministic minimal runtime kernel by replacing the fake single-point UndergroundAnalyzer with a minimal Underground Center radial growth model, recording underground exploration in the formal EventLog, and adding a frontend-readable observation projection derived from runtime facts.

## Requirements

- Add an Underground domain model with fixed center roles: Intent Core, Growth Governor, Constraint Sentinel, Evidence Ledger, Convergence Judge, and Handoff Steward.
- Add rootlet cluster kinds: Option, Risk, Asset Fit, Evidence, Constraint, and Counterfactual.
- Add focused Underground domain types for exploration plans, budgets, rootlet cluster plans, rootlet outputs, candidate pools, convergence decisions, convergence reports, and exploration reports.
- Ensure a single rootlet output is never trusted directly. Rootlet output may only enter a CandidatePool; only accepted or merged convergence decisions may feed DirectionHandoffPackage input.
- Extend the formal EventLog with underground exploration events in the approved order:
  `goal.received -> underground.exploration_planned -> rootlet_cluster.started -> exploration_candidate.produced -> candidate_pool.updated -> convergence_review.completed -> direction_handoff.completed -> growth_plan.completed -> workflow.created -> task.created -> task.assigned -> artifact.produced -> verification.completed -> fruit.proposed -> governance.review.completed -> run_memory.captured -> experience_candidate.proposed -> path_bias.suggested`.
- Refactor `UndergroundAnalyzer` so it orchestrates deterministic planning, rootlet start, candidate production, candidate pool update, convergence, package save, and `direction_handoff.completed` publication.
- Keep deterministic construction in helpers or factories so `UndergroundAnalyzer` stays small.
- Keep Aboveground consuming only approved DirectionHandoffPackage by `directionId + version` through the store.
- Add `RunObservationSnapshot` and `RunObservationEventView` as JSON-safe plain data projections. EventLog remains the source of truth.
- Snapshot fields must include at least `traceId`, `goalId`, `currentPhase`, `eventCursor`, `underground`, `directionPackageRef`, `aboveground`, `artifactRefs`, `verification`, and `governance`.
- Underground observation must expose budget, rootlet cluster statuses, candidate pool counts, accepted/merged/rejected/unknown counts, convergence summary, and whether user escalation is required.
- Preserve current no-go boundaries: no UI, HTTP, SSE, WebSocket, database, real LLM, MCP, A2A, AG-UI adapter, or repo-root `.agentarbor` runtime writes.
- App fake agents may orchestrate deterministic runtime but must not become long-term Capability Asset facts.
- Domain types must live in focused Underground/Observation modules and be re-exported through barrels only as compatibility requires.

## Acceptance Criteria

- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm demo` prints full EventLog, loaded direction package id/version/status, underground summary, and observation snapshot summary.
- [ ] `git diff --check` passes.
- [ ] Tests cover the new EventLog order and candidate counts.
- [ ] Tests prove rootlet output cannot directly enter handoff.
- [ ] Tests prove unconverged candidates fail package validation.
- [ ] Tests prove convergence decisions support accepted, merged, rejected, and unknown with source candidate refs.
- [ ] Tests prove budget exhaustion converges to approved, awaiting_user, or stop reason.
- [ ] Tests prove Handoff Steward packages only converged candidates.
- [ ] Tests prove Aboveground still loads approved package by id/version.
- [ ] Tests prove `RunObservationSnapshot` is serializable and reflects underground state.
- [ ] Tests prove demo does not create repo-root `.agentarbor` runtime assets.
- [ ] No real LLM, database, UI, HTTP, SSE, WebSocket, MCP, A2A, or AG-UI adapter is introduced.

## Definition Of Done

- Runtime contracts are implemented in focused modules with minimal compatibility barrels.
- Stable runtime contracts born during implementation are reflected in `.trellis/spec/backend`.
- Task board is updated only if the human board needs to reflect V0.3 as current task.
- No commit is created in this session.

## Technical Approach

Extend the deterministic runtime in the existing `domain / kernel / app` layout:

- `domain/underground` owns radial growth types, deterministic guard helpers, and convergence facts.
- `domain/agentarbor/direction-handoff-package` continues to own package schema, validation, serialization, and store APIs.
- `domain/observation` owns read-model types and pure snapshot construction from EventLog/runtime result.
- `app/agents` keeps fake orchestration only; deterministic construction moves into helper/factory modules.
- `app/minimal-loop` returns both the underground report and the observation snapshot.

## Decision (ADR-lite)

Context: V0.2 proved DirectionHandoffPackage boundaries, but the Underground phase was still a fake single-point analyzer and did not expose a future frontend observation contract.

Decision: V0.3 introduces a deterministic minimal radial-growth model and a derived observation projection without introducing external adapters or persistent repo-root runtime assets.

Consequences: The EventLog becomes richer and the app result gains a read projection, but EventLog/package validation remain the runtime sources of truth. Future UI or streaming work must consume these contracts instead of creating a parallel fact source.

## Out Of Scope

- Real UI or frontend implementation.
- HTTP, SSE, WebSocket, database, persistence service, real LLM, MCP, A2A, or AG-UI adapter.
- Repo-root `.agentarbor` runtime asset creation.
- Long-term Capability Asset registration for app fake agents.
- Growth Plan, Workflow IR, Nutrient Request, or agent export expansion beyond what existing minimal loop already proves.

## Technical Notes

- User supplied the plan as already approved for implementation.
- Relevant code paths include `src/domain/underground`, `src/domain/agentarbor`, `src/domain/agentarbor/direction-handoff-package`, `src/app/agents/underground-analyzer.ts`, `src/app/minimal-direction.ts`, `src/app/minimal-loop.ts`, `src/app/demo.ts`, `src/app/*.test.ts`, `src/kernel/events/in-memory-event-log.ts`, and `src/domain/common.ts`.
- Relevant specs: `.trellis/spec/backend/index.md`, `.trellis/spec/backend/directory-structure.md`, `.trellis/spec/backend/error-handling.md`, `.trellis/spec/backend/quality-guidelines.md`, and `.trellis/spec/backend/direction-handoff-package.md`.
