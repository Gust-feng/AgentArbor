# Research: Convergence Logic

- **Query**: How convergence decisions are made
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/cluster/convergence-judge-agent.ts` | Agent that orchestrates convergence |
| `src/app/underground-convergence.ts` | Core convergence functions |
| `src/domain/underground/candidate-comparison.ts` | Deterministic comparison logic |
| `src/domain/underground/radial-growth.ts` | `createUndergroundConvergenceReport()`, `resolveConvergenceOutcome()` |
| `src/app/underground/convergence-intelligence.ts` | LLM advisory for convergence |

## Current Approach: Deterministic + Optional LLM Advisory

### Two-Path Architecture

The convergence judge has two paths depending on autonomy mode:

**Without autonomy** (line 54-58): Subscribes to `candidate_pool.updated` and runs convergence immediately.

**With autonomy** (line 43-52): Subscribes to `convergence_review.requested` and may run terminal convergence if the autonomy decision is terminal.

### Core Convergence Flow

1. `convergeMinimalCandidatePool()` (`underground-convergence.ts:28`):
   - Gets `GoalIntentProfile` (or creates default).
   - Calls `compareCandidatesForGoal()` -- **fully deterministic** comparison.
   - Optionally enriches comparisons with AiAdvisory (LLM overlay).
   - Applies convergence decisions to candidate pool.
   - Creates evidence ledger.
   - Creates convergence report via `createUndergroundConvergenceReport()`.

2. `compareCandidatesForGoal()` (`candidate-comparison.ts:49`):
   - For each candidate, calls `compareCandidateForGoal()` which is a **switch on rootlet kind**:
     - `option`: If option conflicts with goal boundaries -> reject. First option -> accept, subsequent -> merge.
     - `evidence`: If options exist -> merge, else -> accept.
     - `asset_fit` / `constraint`: Always merge.
     - `risk`: If risk hints exist -> keep_unknown, else -> reject.
     - `counterfactual`: Always reject.
   - Special cases: stop intent -> all rejected; permission unknown -> needs_user.

3. `resolveConvergenceOutcome()` (`radial-growth.ts:394`):
   - If blocking clarification refs exist -> `awaiting_user`
   - If any accepted/merged candidates -> `approved`
   - If budget exhausted -> `stopped` (budget_exhausted)
   - Else -> `stopped` (no_converged_candidates)

### LLM Advisory Layer

When `AgentTurnRuntime` is available, `ConvergenceJudgeAgent` calls `requestConvergenceAiAdvisoryForCandidatePool()` (convergence-intelligence.ts:49) **before** running deterministic convergence. The advisory:
- Analyzes which candidates are truly different directions
- Recommends a primary option
- Identifies conflicts needing user input
- Identifies constraint violations
- Provides overall direction summary

The advisory does NOT change convergence decisions -- it enriches `contentDifference`, `whyPreferred`, and `conflictWith` fields on comparisons.

### Key Function Signatures

```typescript
// App layer
convergeMinimalCandidatePool(input: {
  pool, plan, leadAgentId, rootletOutputs, goalIntentProfile?,
  constraints?, evidenceLedger?, aiAdvisory?
}): { candidatePool, convergenceReport, evidenceLedger, candidateComparisons }

convergeAutonomyTerminalCandidatePool(input: {
  pool, plan, leadAgentId, rootletOutputs, goalIntentProfile?,
  constraints?, evidenceLedger?, autonomyDecision
}): { candidatePool, convergenceReport, evidenceLedger, candidateComparisons }

// Domain layer
compareCandidatesForGoal(input: {
  goalProfile, candidates, rootletOutputs, decidedByRole?, createdAt
}): CandidateComparisonResult

resolveConvergenceOutcome(input: {
  acceptedCandidateRefs, mergedCandidateRefs, unknownCandidateRefs,
  blockingClarificationRefs?, budget
}): { outcome, stopReason? }
```

### Agent Lifecycle

- Subscribes to: `candidate_pool.updated` (no autonomy) or `convergence_review.requested` (with autonomy)
- Writes: convergenceReport, evidenceLedger, agentClusterRun, undergroundReport
- Publishes: `convergence_review.completed`

## What Would Need to Change for LLM Mainline

1. `compareCandidateForGoal()` is the biggest blocker -- it is a pure switch statement by rootlet kind with no intelligence. Making it LLM-driven would mean the model evaluates each candidate's fitness against the goal, rather than using hardcoded rules.
2. The convergence advisory currently runs in parallel and does not feed back into decisions. To make LLM mainline, the advisory would need to become the primary decision-maker rather than an overlay.
3. `resolveConvergenceOutcome()` could remain deterministic (it is policy logic, not intelligence).
4. The `enrichComparisonsWithAdvisory()` function already shows the pattern: advisory fields override deterministic defaults when present. This could be extended to convergence decisions.

## Caveats

- The deterministic comparison is surprisingly nuanced -- it handles stop intent, permission unknowns, goal boundary conflicts, and per-kind logic. Replacing it with LLM requires preserving these edge cases.
- `sanitizeConvergenceAdvisoryForComparison()` redacts sensitive text and truncates to 600 chars, so advisory quality depends on clean model output.
