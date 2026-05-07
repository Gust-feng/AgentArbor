# Research: Test assertions affected by CandidateCollector AI call addition

- **Query**: Find all test assertions that need updating after adding `reasonWithAgentTurn` to CandidateCollectorAgent, which increases model.requested events from N to N+1
- **Scope**: internal
- **Date**: 2026-05-06

## Background

The `CandidateCollectorAgent` (at `src/app/underground/agents/candidate-collector.ts:104`) now calls `reasonWithAgentTurn` with:
- `purpose: "candidate_aggregation"`
- `outputContract.contractId: "underground.candidate_aggregation.v1"`

This adds one new `model.requested` + `model.completed` event pair per underground session. The orchestrator passes `agentTurnRuntime` to the CandidateCollector at `src/app/underground/orchestrator.ts:208`.

### Model call sequence per underground session

**Simple goal** ("Build a small deterministic helper." -- 1 rootlet kind: option):
1. intent_profile (IntentCore)
2. growth_governance (GrowthGovernor)
3. rootlet_candidate_advice.option (RootletExplorer)
4. **candidate_aggregation (CandidateCollector) -- NEW**
5. autonomy_decision (AutonomyReviewer)
6. convergence_judgment (ConvergenceJudge)
7. handoff_narrative (HandoffSteward)

Previous total: 6 model.requested. New total: 7.

**Complex goal** ("构建任务管理平台，需要风险、安全、资产、证据、约束和反驳候选..." -- 6 rootlet kinds):
- intent_profile + growth_governance + 6x rootlet_candidate_advice + **candidate_aggregation (NEW)** + autonomy_decision + convergence_judgment + handoff_narrative

Previous total: 11 model.requested. New total: 12.

---

## Files That MUST Be Changed

### 1. `src/app/underground-intelligence.test.ts`

**Line 51** -- model.requested count for simple goal test:
```
CURRENT: assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 6);
CHANGE TO: 7
```
Test: "Underground intelligence output enters candidate pool and waits for convergence before handoff"

**Line 398** -- model.completed count for simple goal with empty candidates:
```
CURRENT: assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 6);
CHANGE TO: 7
```
Test: "Completed AI calls with empty candidate arrays fall back to deterministic rootlet output"

**Line 202** -- model.requested count for complex goal (6 rootlet kinds):
```
CURRENT: assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.requested").length, 11);
CHANGE TO: 12
```
Test: "All selected rootlet kinds request AI candidate advice through IntelligenceChannel"

**Line 203** -- model.completed count for complex goal (6 rootlet kinds):
```
CURRENT: assert.equal(result.runtime.eventLog.types().filter((type) => type === "model.completed").length, 11);
CHANGE TO: 12
```
Same test as line 202.

---

## Files That Do NOT Need Changes

### `src/app/underground-demo-summary.test.ts`
- Uses relative assertions (`> 0`) for eventCounts (lines 29, 89-90), not exact counts.
- No `model.requested` exact count assertions found.

### `src/app/underground-demo-cli.test.ts`
- Line 14, 30: `result.stdout.includes("model.requested")` -- boolean check, still true.
- Line 19, 35: `summary.ai.eventCounts.requested > 0` -- relative check, still passes.
- Line 40: `summary.ai.modelCallRefs.length === summary.ai.eventCounts.completed` -- both sides increase by 1, equality still holds.
- Line 46: Filters out `model.*` events and checks non-model event list -- unaffected.
- The `rootletModelCall` and `advisoryModelCall` find() calls (lines 38-39) still return objects because the CandidateCollector's `rootletKind` is `undefined` (its contractId `"underground.candidate_aggregation.v1"` does not match the `"underground.rootlet_candidate_advice.*"` pattern in `rootletKindFromAdviceContractId`). This means `advisoryModelCall` now finds the candidate_aggregation call instead of convergence_judgment, but the test only checks existence and basic properties.

### `src/app/underground/orchestrator.test.ts`
- Line 41: `model.requested.length >= 5` -- 7 >= 5 still passes.
- Line 43: Checks purposes `["intent_profile", "growth_governance"]` as first two -- still correct (candidate_aggregation is 4th).
- Line 47: `purposes.includes("handoff_narrative")` -- still present.

### `src/app/underground/cluster/agent-runner.test.ts`
- No exact model count assertions.

### `src/app/underground-message-dispatcher.test.ts`
- Line 58: `countEvents(runtime, "model.requested") > 0` -- still passes.
- Line 170: `countEvents(runtime, "model.requested"), 0` -- for a stopped session without AI, no change.

### `src/app/underground/agents/candidate-collector.test.ts`
- Unit tests for the CandidateCollector itself. Uses isolated test fixtures, not the full orchestrator. Not affected by integration count changes.

---

## Additional Behavioral Observations

### CandidateCollector source field
The CandidateCollector now returns `source: "ai"` when an `agentTurnRuntime` is available, and `source: "deterministic_fallback"` when it is not. This is consistent with the existing pattern for other agents (IntentCore, GrowthGovernor, etc.).

### Demo-summary `rootletKinds` aggregation
In `src/app/underground-demo-summary.ts:403-451`, the `summarizeRootletKindAi` function only tracks model calls whose contractId matches `"underground.rootlet_candidate_advice.*"`. The CandidateCollector's `"underground.candidate_aggregation.v1"` will NOT appear in rootletKind summaries -- it will only increase the top-level `eventCounts` and add a new entry in `modelCallRefs` with `rootletKind: undefined`.

### convergence-advisory contractId
The `convergence-advisory` contractId appears in the test fixtures (`TestModelProvider` in underground-intelligence.test.ts and `GoalSpecificCandidateProvider` in underground-demo-summary.test.ts) but NOT in the production ConvergenceJudge implementation. The production convergence judge only uses `"underground.convergence_judgment.v1"`.

---

## Summary of Required Changes

| File | Line | Current Value | New Value | Reason |
|------|------|--------------|-----------|--------|
| `src/app/underground-intelligence.test.ts` | 51 | 6 | 7 | Simple goal model.requested count |
| `src/app/underground-intelligence.test.ts` | 202 | 11 | 12 | Complex goal model.requested count |
| `src/app/underground-intelligence.test.ts` | 203 | 11 | 12 | Complex goal model.completed count |
| `src/app/underground-intelligence.test.ts` | 398 | 6 | 7 | Simple goal model.completed count |
