# Research: Direction Handoff Assembly

- **Query**: How the final DirectionHandoffPackage is assembled
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/cluster/handoff-steward-agent.ts` | Agent that assembles and publishes the final handoff |
| `src/app/minimal-direction.ts` | Material creation for approved/awaiting/stopped outcomes |
| `src/app/direction-handoff-derivation.ts` | Core DirectionHandoff draft derivation logic |
| `src/app/underground-direction-session.ts` | Session orchestrator that creates runtime + runs the agent cluster |
| `src/app/underground/cluster/agent-runner.ts` | UndergroundAgentRunner -- message dispatch loop |

## Assembly Flow

### HandoffStewardAgent (`handoff-steward-agent.ts`)

1. Subscribes to `convergence_review.completed`.
2. Reads convergenceReport from shared context.
3. Branches on `convergenceReport.outcome`:
   - `"approved"` -> `createMinimalDirectionMaterial()` -> status `"approved"`
   - `"awaiting_user"` -> `createAwaitingUserDirectionMaterial()` -> status `"awaiting_user"`
   - `"stopped"` -> `createStoppedDirectionMaterial()` -> status `"draft"`
4. Saves package to `directionHandoffPackageStore`.
5. Loads it back (to apply store validation).
6. Creates `DirectionHandoffPackageRef`.
7. Finalizes `agentClusterRun` with terminal status.
8. Creates `undergroundReport`.
9. Publishes terminal message:
   - `"approved_package_created"` -> `direction_handoff.completed` to aboveground
   - `"awaiting_user"` -> `user_approval.requested` to user

### Material Creation (`minimal-direction.ts`)

`createMinimalDirectionMaterial()`:
1. Calls `selectHandoffSourceCandidates()` to get accepted+merged candidates.
2. Calls `deriveDirectionHandoffDraft()` to build the DirectionHandoff.
3. Calls `createApprovedDirectionHandoff()` to set status to `"approved"`.
4. Wraps in `createDirectionHandoffPackage()`.

### DirectionHandoff Draft Derivation (`direction-handoff-derivation.ts`)

`deriveDirectionHandoffDraft()` (line 27) is the core assembly function. It:

1. **clarifiedGoal**: Uses `goalIntentProfile.goalStatement` or falls back to raw goal.
2. **nonGoals**: Combines profile nonGoals + hard scope constraints.
3. **assumptions**: Profile assumptions + convergence review reference + AI advisory flag + clarification flag.
4. **missingInformation**: Clarification question prompts.
5. **soilRefs**: Currently hardcoded `["soil:minimal-constraints"]`.
6. **evidenceRefs**: Union of goal-intent evidence + candidate sourceRefs + convergence provenanceRefs + comparison/decision evidence.
7. **constraintRefs**: All constraints mapped to ConstraintRef format.
8. **candidateConstraintRefs**: All constraints + inferred intent constraints for each enforcement gate.
9. **risks**: Risk hints + rejected/unknown decision reasons + AI-identified conflicts/violations + clarification blocking.
10. **options**: Derived from option-type comparisons, enriched with AI advisory.
11. **decisionRecord**: retainedOptionId (recommended or first), merged/rejected/userDecisionRequired refs.
12. **riskRegister**: Intent risk hints + rejected candidate why-not + risk-type comparisons + clarification blocking.
13. **growthEntry**: hardcoded allowedRuntimeShapes `["single_agent"]`, suggestedFirstWorkflowNodes `["generate", "verify", "memory", "govern"]`.

### Direction Options (`direction-handoff-derivation.ts:248`)

`createDirectionOptions()`:
- Filters `candidateComparisons` for `rootletKind === "option"`.
- If none exist, creates a fallback option from goalStatement.
- Each option gets `recommendationScore`: accept=1, merge=0.75, other=0.5, reject=0.
- `directionSummary` enriched with AI advisory `contentDifference` and `whyPreferred`.

### Session Orchestration (`underground-direction-session.ts`)

Two entry points:
1. `runUndergroundDirectionSession()` -- deterministic only, uses `dispatchUntilIdle()`.
2. `runUndergroundDirectionSessionWithIntelligence()` -- creates IntelligenceChannel, AgentTurnRuntime, enables autonomy, uses `dispatchUntilIdleAsync()`.

Both create a MinimalRuntime, publish `goal.received` message, and wait for the agent cluster to complete.

## What Would Need to Change for LLM Mainline

1. `deriveDirectionHandoffDraft()` is currently a pure function that assembles data from deterministic comparisons. If comparisons become LLM-driven, the draft assembly can stay the same -- it reads whatever the comparisons produced.
2. The hardcoded `growthEntry` values would need LLM reasoning for runtime shape and workflow node suggestions.
3. `createDirectionOptions()` filtering and scoring could benefit from LLM-driven recommendation rather than the accept=1/merge=0.75 heuristic.
4. `soilRefs` is currently hardcoded -- would need to be dynamically resolved from actual Soil assets.

## Caveats

- The HandoffStewardAgent does NOT have its own LLM capability. It is purely an assembly agent.
- `createDirectionHandoffPackage()` applies validation rules (lineage, convergence, candidate-index, file-boundary, hard-constraint).
- The file-system store writes to disk when `outputDirectory` is specified.
