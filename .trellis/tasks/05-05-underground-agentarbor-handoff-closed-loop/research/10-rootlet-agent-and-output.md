# Research: RootletAgent and Rootlet Output Creation

- **Query**: How rootlet outputs are created -- deterministic vs LLM
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/cluster/rootlet-agent.ts` | RootletAgent -- handles rootlet invocation requests |
| `src/app/underground-rootlets.ts` | Deterministic rootlet output generation |

## RootletAgent Architecture

The RootletAgent is a **dynamic agent** (one instance per rootlet kind, created lazily by UndergroundAgentRunner). It uses an internal message type `rootlet.invocation_requested` (not the public bus).

### Dual-Path Output Generation

`handleInvocationRequested()` (line 46):

**Path A -- LLM available** (agentTurnRuntime + goalIntentProfile):
1. Calls `requestUndergroundRootletCandidateAdvice()` (LLM).
2. If model returns candidates -> use them (up to budget limit).
3. If model returns empty -> fall back to deterministic outputs.

**Path B -- No LLM**:
1. Calls `createRootletOutputsForInvocation()` directly (deterministic).

### Deterministic Output Generation

`createRootletOutputsForInvocation()` (`underground-rootlets.ts:147`):
1. Gets template summaries via `rootletSummaries()` per kind.
2. Slices to `maxCandidateOutputs` budget.
3. Creates `RootletOutput` for each summary.

Template summaries per kind (hardcoded in `rootletSummaries()`):
- **option**: "Primary in-memory direction for {goal}", "Modular verification-first direction for {goal}", "Deferred persistence direction for {goal}"
- **risk**: "Risk source and impact for {riskHint}", "Risk blocking assessment for {riskHint}", "Risk mitigation boundary for {goal}"
- **asset_fit**: "Soil asset fit refs for {goal}", "Soil asset non-fit boundaries for {goal}"
- **evidence**: "Evidence candidate for {acceptanceCriteria}", "Verification evidence candidate for {acceptanceCriteria}", "Monitoring evidence candidate for {goal}"
- **constraint**: "Constraint mapping for {constraintHint}", "Enforcement gate mapping for {constraintHint}", "Constraint non-weakening check for {goal}"
- **counterfactual**: "Counterfactual why-not alternative for {goal}", "Counterfactual fallback direction for {goal}"

### RootletOutput Fields (deterministic)

- `outputId`: generated ID
- `invocationId`: from the agent invocation
- `clusterId`: from the cluster plan
- `kind`: from the cluster kind
- `producedByAgentId`: the rootlet agent ID
- `summary`: from template or LLM
- `sourceRefs`: goal-intent evidence + "goal.received" + cluster + invocation + variant ref
- `evidenceRefs`: kind-specific evidence + doc refs (for option/evidence)
- `soilAssetFitRefs`: ["soil:minimal-constraints"] for asset_fit only
- `constraintRefs`: all constraints for constraint kind only
- `riskRefs`: ["risk-fake-agent-overreach"] for risk kind only

### LLM Output Path

When LLM is available:
1. `requestUndergroundRootletCandidateAdvice()` executes model turn.
2. Parses output via `parseUndergroundRootletCandidateAdviceOutput()`.
3. For each parsed candidate, creates `RootletOutput` with:
   - `summary` from `formatUndergroundRootletCandidateAdviceSummary()` (includes all fields)
   - `sourceRefs` includes model request/response IDs, tool call refs, research refs
   - `evidenceRefs` includes model call ref + tool evidence refs + research refs

### Agent Lifecycle

- Subscribes to internal `rootlet.invocation_requested` (via `subscribeInternal`)
- One agent instance per kind (created dynamically by agent-runner)
- Writes: rootletOutputs, completedRootletInvocations
- When all expected rootlets complete -> publishes `exploration_candidate.produced`

## What Would Need to Change for LLM Mainline

1. The deterministic templates are the main limitation -- they produce generic, non-specific summaries. LLM is already supported as the primary path.
2. The `fallback` behavior (LLM fails -> deterministic) means the system always produces some output. For LLM mainline, the fallback strategy might change to "fail" or "retry".
3. The deterministic output has hardcoded evidence refs (doc paths) that may not be relevant to all goals.
4. `riskRefs: ["risk-fake-agent-overreach"]` is a placeholder -- real risk identification requires LLM.

## Caveats

- The RootletAgent is the ONLY agent that supports both LLM and deterministic paths in the same handler.
- The `requiresAsync` subscription option is set to `() => ctx.agentTurnRuntime !== undefined` -- meaning the agent runner knows when async dispatch is needed.
- Tool calls during rootlet LLM execution produce research refs that flow into evidence.
