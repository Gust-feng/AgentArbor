# Research: IntentCoreAgent

- **Query**: How goal intent is currently determined -- is it regex? LLM? deterministic?
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/cluster/intent-core-agent.ts` | Agent implementation (message handler) |
| `src/app/underground-goal-profile.ts` | Thin wrapper that delegates to domain |
| `src/domain/underground/intent-core.ts` | Core `createGoalIntentProfile()` -- deterministic keyword matcher |

## Current Approach: Fully Deterministic (No LLM)

### Flow

1. `IntentCoreAgent.handleGoalReceived()` subscribes to `goal.received` message (line 26).
2. Extracts `goalId` and `rawGoal` from message payload.
3. Calls `createGoalIntentProfileForMinimalUnderground()` which is a thin passthrough to `createGoalIntentProfile()` (domain).
4. The domain function (`intent-core.ts:164`) does keyword matching using 7 hardcoded keyword tables:
   - `RISK_KEYWORDS` (20 entries, bilingual)
   - `ASSET_KEYWORDS` (16 entries)
   - `EVIDENCE_KEYWORDS` (14 entries)
   - `CONSTRAINT_KEYWORDS` (12 entries)
   - `COUNTERFACTUAL_KEYWORDS` (8 entries)
   - `UNKNOWN_KEYWORDS` (8 entries)
   - `DOMAIN_KEYWORDS` (18 entries)
5. Also runs `extractEnglishConcepts()` (regex `[a-z][a-z0-9_-]{2,}`) and `extractChineseConcepts()` (regex for Chinese noun phrases).
6. NonGoals extracted by negation markers (不要, 不需要, must not, don't, etc.).
7. Acceptance criteria derived from action verbs (构建/build, 支持/support, 测试/test, etc.).
8. Risk hints derived from domain keywords (认证, database, 外部, 性能, etc.).

### Rootlet Cluster Selection

`selectRootletClusterKindsForGoalIntent()` (line 226) uses keyword presence to decide which of the 6 rootlet kinds to activate:
- Always includes `option`
- `risk` if riskHints exist
- `asset_fit` if asset keywords found
- `evidence` if evidence keywords or unknowns
- `constraint` if constraint hints or nonGoals
- `counterfactual` if counterfactual keywords

### Key Function Signatures

```typescript
// Domain: pure deterministic
createGoalIntentProfile(input: CreateGoalIntentProfileInput): GoalIntentProfile
selectRootletClusterKindsForGoalIntent(profile: GoalIntentProfile): RootletClusterKind[]
hasStopIntent(profile: GoalIntentProfile): boolean

// App wrapper (identity function)
createGoalIntentProfileForMinimalUnderground(input: { goalId, rawGoal, constraints }): GoalIntentProfile
```

### Agent Lifecycle

- Subscribes to `goal.received` (from user)
- Writes: traceId, goalId, rawGoal, goalIntentProfile, explorationPlan, agentClusterPlan, centerInvocations, currentCycle to shared context
- Publishes: `underground.exploration_planned`

## What Would Need to Change for LLM Mainline

1. `createGoalIntentProfile()` would need an LLM-backed alternative or replacement. The keyword tables are the main bottleneck -- they can only match concepts present in the hardcoded list.
2. `selectRootletClusterKindsForGoalIntent()` would need LLM reasoning for which rootlet kinds are relevant, rather than keyword-triggered boolean flags.
3. The agent would need to become async (currently it is synchronous) and use `AgentTurnRuntime` to call the model.
4. The `GoalIntentProfile` type itself could remain as-is since it is a data container -- the creation logic is what changes.

## Caveats

- The `IntentCoreAgent` does NOT have access to `AgentTurnRuntime` in the current cluster setup -- it is always deterministic.
- `createDefaultGoalIntentProfile()` provides a fallback when no raw goal is available (used for compatibility mode).
- The agent has no AI advisory overlay unlike ConvergenceJudge.
