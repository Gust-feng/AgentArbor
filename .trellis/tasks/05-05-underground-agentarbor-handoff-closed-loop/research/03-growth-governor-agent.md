# Research: GrowthGovernorAgent

- **Query**: How rootlet clusters are currently selected/planned
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/cluster/growth-governor-agent.ts` | Agent implementation |
| `src/app/underground-rootlets.ts` | Rootlet planning, output generation, budget management |

## Current Approach: Deterministic Pass-Through (No LLM)

### Flow

1. `GrowthGovernorAgent` subscribes to `underground.exploration_planned` message (line 22).
2. On receipt, validates the message came from `underground-intent-core`.
3. Reads the `explorationPlan` from shared context (already computed by IntentCore).
4. Calls `startRootletClusters(explorationPlan)` which simply marks all cluster statuses as "started".
5. Creates `rootlet_agent` invocations for each cluster in the plan.
6. Writes started plan + running invocations to shared context.
7. Publishes `rootlet_cluster.started`.

### Rootlet Planning (deterministic, in `underground-rootlets.ts`)

`createMinimalUndergroundExplorationPlan()` (line 53):
- Uses `selectRootletClusterKindsForGoalIntent()` to pick which of the 6 rootlet kinds to activate.
- For each kind, creates a `RootletClusterPlan` with:
  - Fixed `clusterId`: `rootlet-{kind}`
  - Fixed `stewardRole` mapping (option->intent_core, risk->growth_governor, etc.)
  - Fixed `objective` per kind, optionally appended with goalStatement
  - Fixed `exitCriteria` per kind
  - Fixed `maxCandidateOutputs` per kind (2-3)
- Computes total `ExplorationBudget` from sum of cluster budgets.

### Deterministic Output Generation

`createRootletOutputsForInvocation()` (line 147):
- Generates deterministic rootlet output summaries using `rootletSummaries()` (line 272).
- Each kind has 2-3 template strings that incorporate goalIntentProfile fields.
- Example for "option": "Primary in-memory direction for {goal}", "Modular verification-first direction for {goal}", "Deferred persistence direction for {goal}".
- These are hardcoded templates, NOT LLM-generated.

### Spawned Clusters (for autonomy cycles)

`createSpawnedRootletClusterPlan()` (line 168):
- Used when autonomy decides to `continue_exploration`.
- Creates new cluster plans with custom objective/exitCriteria from autonomy spawn requests.

### Key Function Signatures

```typescript
createMinimalUndergroundExplorationPlan(goalId: string, goalIntentProfile?: GoalIntentProfile): UndergroundExplorationPlan
startRootletClusters(plan: UndergroundExplorationPlan): UndergroundExplorationPlan
completeRootletClusters(plan: UndergroundExplorationPlan): UndergroundExplorationPlan
spendCandidateBudget(plan: UndergroundExplorationPlan, spent: number): UndergroundExplorationPlan
produceMinimalRootletOutputs(input: {...}): RootletOutput[]
createRootletOutputsForInvocation(input: {...}): RootletOutput[]
createSpawnedRootletClusterPlan(input: {...}): RootletClusterPlan
```

### Agent Lifecycle

- Subscribes to: `underground.exploration_planned`
- Writes: centerInvocations, startedPlan, runningRootletInvocations, expectedRootletKinds
- Publishes: `rootlet_cluster.started`

## What Would Need to Change for LLM Mainline

1. The GrowthGovernor itself has no AI capability -- it is purely a message-forwarding agent. To make it LLM-driven, it would need to use AgentTurnRuntime to reason about which rootlet kinds to activate and what objectives/budgets to assign.
2. `rootletSummaries()` templates would need to be replaced by actual LLM-generated candidate content (this is already partially done in RootletAgent when AgentTurnRuntime is available).
3. The fixed max-output-per-kind constraints would need to become dynamic based on LLM reasoning.

## Caveats

- The GrowthGovernor agent is essentially a no-op orchestrator. It receives a pre-computed plan and starts it. All the "intelligence" in planning is in the domain's `selectRootletClusterKindsForGoalIntent()`.
- RootletAgent does have LLM support (see rootlet-agent research) -- the GrowthGovernor just tells it when to start.
