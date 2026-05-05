# Research: Minimal Underground Loop and Agent Runner

- **Query**: The deterministic minimal loop and how the agent runner dispatches
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/minimal-underground.ts` | Re-exports for minimal underground functions |
| `src/app/underground/cluster/agent-runner.ts` | UndergroundAgentRunner -- the dispatch loop |
| `src/app/underground/cluster/shared-context.ts` | UndergroundSharedContext -- shared state management |
| `src/app/underground/cluster/agent-context.ts` | UndergroundAgentContext -- agent environment |

## Minimal Underground Re-exports (`minimal-underground.ts`)

A facade that re-exports:
- `completeRootletClusters`, `createMinimalUndergroundExplorationPlan`, `produceMinimalRootletOutputs`, `spendCandidateBudget`, `startRootletClusters` (from underground-rootlets)
- `createMinimalCandidatePool` (from underground-candidates)
- `convergeMinimalCandidatePool` (from underground-convergence)
- `createMinimalUndergroundEvidenceLedger` (from underground-evidence)
- `createGoalIntentProfileForMinimalUnderground` (from underground-goal-profile)
- `createUndergroundExplorationReport` (from underground-report)

These can be used to run a fully deterministic underground exploration WITHOUT the agent cluster runtime.

## UndergroundAgentRunner (`agent-runner.ts`)

### Architecture

The runner is a **message-driven dispatch loop** with:

1. **Fixed agents** (always present):
   - IntentCoreAgent
   - GrowthGovernorAgent
   - CandidatePoolAgent
   - AutonomyCoreAgent (if enableAutonomy)
   - ConvergenceJudgeAgent
   - HandoffStewardAgent

2. **Dynamic rootlet agents** (created on demand per rootlet kind)

3. **Shared context** (UndergroundSharedContext) for inter-agent state

4. **Message queue** (UndergroundQueuedAgentMessage[])

### Dispatch Loop

`dispatchUntilIdle()` (line 119) -- synchronous:
- Pops messages from queue.
- If message requires async -> throws error (must use async variant).
- Processes message via handler.
- Returns result when terminal status is set.

`dispatchUntilIdleAsync()` (line 136) -- async:
- Same but awaits each handler.
- Required when AgentTurnRuntime is used (model calls are async).

### Message Processing

`processQueuedMessage()` (line 147):
1. If terminal result already exists -> skip.
2. For public messages: deduplication by message ID + phase key.
3. Phase key = `{traceId}:{messageType}` or `{traceId}:{messageType}:{cycleId}`.
4. Dispatch step counter with max (default 32).
5. Calls message handler.

### Rootlet Cluster Started Handler

`handleRootletClusterStarted()` (line 172):
- Intercepts `rootlet_cluster.started` messages.
- For each cluster in the plan: ensures dynamic rootlet agent exists, publishes internal `rootlet.invocation_requested`.

### Result Construction

`buildResult()` (line 211):
- Returns `UndergroundAgentRunnerResult` when all required state is present:
  - terminalStatus, undergroundReport, directionHandoff, directionHandoffPackage, etc.

## UndergroundSharedContext (`shared-context.ts`)

### State Fields (30+ fields)

Key state tracked:
- Goal: traceId, goalId, rawGoal, goalIntentProfile
- Plan: explorationPlan, agentClusterPlan, startedPlan
- Invocations: centerInvocations, runningRootletInvocations, completedRootletInvocations
- Cycle: currentCycle, autonomyCycles, autonomyDecisions, autonomyReview
- Outputs: rootletOutputs, candidatePool, convergenceReport, evidenceLedger
- Terminal: agentClusterRun, undergroundReport, directionHandoff, directionHandoffPackage, terminalStatus

### Ownership Model

Each field has explicit owner agents (defined in `SHARED_CONTEXT_FIELD_OWNERS`). Only owners can write. For example:
- `goalId` -> intent-core only
- `rootletOutputs` -> rootlet_agent (any rootlet agent)
- `convergenceReport` -> convergence-judge only
- `directionHandoffPackage` -> handoff-steward only

### Write Mechanism

`write(agentId, patch)`: Validates ownership, then applies patch. Arrays are shallow-cloned.

`snapshot()`: Returns a deep clone of the entire state.

## UndergroundAgentContext (`agent-context.ts`)

Provides agents with:
- `runtime`: MinimalRuntime (bus, constraints, stores)
- `shared`: UndergroundSharedContext
- `intelligenceChannel`: optional IntelligenceChannel
- `toolCenter`: optional ToolExecutionBroker
- `agentTurnRuntime`: optional AgentTurnRuntime
- `autonomyEnabled`: boolean flag
- `maxAutonomyCycles`: default 2
- `subscribe()`: subscribes to public bus messages
- `subscribeInternal()`: subscribes to internal (rootlet) messages
- `publishRootletInvocationRequested()`: publishes to internal subscribers

## Message Flow Summary

```
user -> goal.received
  -> IntentCoreAgent: creates GoalIntentProfile, explorationPlan, agentClusterPlan
  -> underground.exploration_planned
    -> GrowthGovernorAgent: starts rootlet clusters
    -> rootlet_cluster.started
      -> [runner intercepts] -> rootlet.invocation_requested (internal)
        -> RootletAgent(s): produce outputs (LLM or deterministic)
        -> [all done] -> exploration_candidate.produced
          -> CandidatePoolAgent: creates candidate pool
          -> candidate_pool.updated
            -> [no autonomy] ConvergenceJudgeAgent
            -> [autonomy] AutonomyCoreAgent
              -> [continue] -> new rootlet_cluster.started (cycle 2+)
              -> [convergence/stop/clarify] -> convergence_review.requested
                -> ConvergenceJudgeAgent: convergence review
                -> convergence_review.completed
                  -> HandoffStewardAgent: assemble handoff
                  -> direction_handoff.completed | user_approval.requested
```

## What Would Need to Change for LLM Mainline

1. The runner itself does not need to change -- it is a message dispatch loop.
2. The shared context ownership model would need updating if new agents are added.
3. The phase key deduplication prevents re-processing the same phase, which could be a problem if LLM retries are needed.
4. `DEFAULT_MAX_DISPATCH_STEPS = 32` would need to increase if more autonomous cycles are allowed.

## Caveats

- The runner enforces single-dispatch semantics -- once a terminal result is built, no more messages are processed.
- The `processedPhaseKeys` set prevents duplicate processing of the same message type within the same cycle, which is important for the autonomy loop.
- The ownership model in shared context is strict -- writing to a field you don't own throws `UndergroundSharedContextError`.
