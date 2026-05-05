# Research: Autonomy Intelligence

- **Query**: How autonomy decisions work
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/autonomy-intelligence.ts` | LLM autonomy decision logic |
| `src/app/underground/cluster/autonomy-core-agent.ts` | AutonomyCore agent implementation |
| `src/domain/underground/autonomy.ts` | Autonomy domain types |

## Current Approach: LLM-Required (No Deterministic Fallback)

Unlike rootlet and convergence advisory, autonomy is **LLM-required**. If no AgentTurnRuntime is available, it immediately returns a failed decision with reason `"ai_required_for_autonomy"`.

### AutonomyCoreAgent Flow

1. Subscribes to `candidate_pool.updated` (line 41).
2. If `agentTurnRuntime` is undefined -> `failedAutonomyDecision("ai_required_for_autonomy")` (line 90-105).
3. Otherwise -> `requestUndergroundAutonomyDecision()` (line 109).
4. After decision:
   - Updates current cycle with decision outcome.
   - Publishes `autonomy_review.completed`.
   - If `action === "continue_exploration"` -> spawns new rootlet clusters and publishes `rootlet_cluster.started`.
   - Otherwise -> publishes `convergence_review.requested` (triggers ConvergenceJudge).

### Autonomy Decision Request

`requestUndergroundAutonomyDecision()` (`autonomy-intelligence.ts:71`):

1. If no `agentTurnRuntime` -> `failedAutonomyDecision("ai_required_for_autonomy")`.
2. Executes model turn with autonomy-specific policy.
3. If model fails or output validation fails -> `failedAutonomyDecision("autonomy_decision_failed")`.
4. Parses output via `parseAutonomyDecisionOutput()`.
5. If action is `continue_exploration` but cycle guard exceeded -> `failedAutonomyDecision("autonomy_cycle_guard_exceeded")`.

### Turn Policy

```typescript
{
  allowModel: true,
  allowedTools: ["search", "read"],
  maxModelRounds: 3,
  maxToolRounds: 2,
  fallback: "disabled",  // NO deterministic fallback
  purpose: "autonomy_decision",
  outputContract: {
    contractId: "underground.autonomy_decision.v1",
    format: "json_object",
    requiredFields: ["action", "completionAssessment", "informationGaps",
                     "spawnRequests", "rationale"],
    requiredStringFields: ["action", "completionAssessment", "rationale"],
  },
  budget: { maxOutputTokens: 512, maxLatencyMs: 15_000 },
}
```

### System Prompt (line 166-176)

Instructs the model to:
- Review CandidatePool after a rootlet exploration cycle
- Choose exactly one action: continue_exploration, request_convergence, request_user_clarification, or stop
- Cannot approve Direction Handoff
- If continuing, provide spawnRequests mapped to existing rootletKind values
- Return JSON only

### User Prompt Content

Includes:
- Goal text
- Cycle info (current cycle, completed cycles, max cycles)
- GoalIntentProfile (goalStatement, unknowns, acceptanceCriteria)
- CandidatePool (candidateId, status, kind, clusterId, summary for each)
- Rootlet outputs (kind, outputId, evidenceRefs count, summary)
- Hard constraints

### Autonomy Actions

4 possible actions (`autonomy.ts:4-9`):
1. `continue_exploration` -- spawn new rootlet clusters
2. `request_convergence` -- hand off to convergence judge
3. `request_user_clarification` -- needs user input
4. `stop` -- terminal stop

### Spawn Requests

When action is `continue_exploration`, the model must provide `spawnRequests[]`:
```
requestId, rootletKind (must be valid RootletClusterKind),
specialistLabel?, objective, informationNeeds[], sourceHints[],
expectedEvidence[], rationale
```

### Cycle Guard

`maxAutonomyCycles` (default 2, configurable in agent-runner). If the model requests `continue_exploration` after the guard is reached, it returns `failedAutonomyDecision("autonomy_cycle_guard_exceeded")`.

### Failed Decision Types

| Reason | When |
|---|---|
| `ai_required_for_autonomy` | No AgentTurnRuntime available |
| `autonomy_decision_failed` | Model call failed, invalid action, invalid spawn requests, unknown candidate refs |
| `autonomy_stopped` | Model explicitly chose `stop` action |
| `autonomy_cycle_guard_exceeded` | Model chose `continue_exploration` after cycle limit |

## What Would Need to Change for LLM Mainline

1. Autonomy is already LLM-mainline -- it requires AI. No change needed for the decision itself.
2. The spawn requests currently map to the 6 fixed rootlet kinds. To support more flexible exploration, the kind vocabulary would need to expand.
3. The system prompt could be enriched with historical exploration patterns and past autonomy decisions.
4. Tool rounds are limited (maxToolRounds: 2) -- increasing this would allow deeper analysis before spawning.

## Caveats

- Autonomy is the ONLY agent that is fully LLM-required with no deterministic fallback. All other agents have deterministic fallbacks.
- The model can reference candidates by ID in sourceRefs, which are validated against the actual candidate pool.
- Text fields are sanitized (truncated to 600 chars, sensitive patterns redacted).
- The model output parsing is defensive -- invalid actions or missing spawn requests cause failure.
