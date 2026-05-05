# Research: Underground Agent Cluster Architecture Summary

- **Query**: Complete understanding of the underground agent cluster for refactoring
- **Scope**: internal
- **Date**: 2026-05-05

## Architecture Overview

The underground agent cluster is a **message-driven multi-agent system** with 7 agent roles:

1. **IntentCore** -- deterministic goal analysis (keyword matching)
2. **GrowthGovernor** -- deterministic plan forwarding
3. **RootletAgent** (x6 kinds) -- LLM or deterministic candidate production
4. **CandidatePool** -- deterministic candidate aggregation
5. **AutonomyCore** -- LLM-required exploration loop control
6. **ConvergenceJudge** -- deterministic convergence + optional LLM advisory
7. **HandoffSteward** -- deterministic handoff assembly

## LLM Integration Status Per Agent

| Agent | Current Approach | LLM Available? | Fallback |
|---|---|---|---|
| IntentCore | Fully deterministic | No | N/A |
| GrowthGovernor | Deterministic pass-through | No | N/A |
| RootletAgent | LLM primary, deterministic fallback | Yes (AgentTurnRuntime) | Deterministic templates |
| CandidatePool | Deterministic | No | N/A |
| AutonomyCore | LLM required | Yes (required) | None -- fails without AI |
| ConvergenceJudge | Deterministic + optional advisory | Advisory only | Deterministic |
| HandoffSteward | Deterministic assembly | No | N/A |

## Key Architectural Properties

### Message-Driven

All agents communicate via `ArborMessage` on a shared `Bus`. Internal rootlet invocations use a separate internal message channel. The `UndergroundAgentRunner` manages a dispatch queue with deduplication.

### Shared Context with Ownership

`UndergroundSharedContext` holds 30+ state fields with strict write-ownership per agent. Agents read from shared state via `snapshot()` and write via `write(agentId, patch)`.

### Two Entry Points

1. `runUndergroundDirectionSession()` -- synchronous, no AI, deterministic only
2. `runUndergroundDirectionSessionWithIntelligence()` -- async, creates AgentTurnRuntime, enables autonomy, LLM-enhanced

### Dual-Path Pattern

The system supports both deterministic and LLM paths:
- When `AgentTurnRuntime` is provided: LLM-enhanced (rootlets produce LLM candidates, convergence gets AI advisory, autonomy runs AI decisions)
- When `AgentTurnRuntime` is absent: fully deterministic (template rootlet outputs, keyword-based convergence, no autonomy)

## Files Research Index

| # | File | Topic |
|---|---|---|
| 01 | `01-domain-layer-contracts.md` | All domain types, hardcoded vs dynamic |
| 02 | `02-intent-core-agent.md` | Goal intent determination (keyword matching) |
| 03 | `03-growth-governor-agent.md` | Rootlet cluster planning |
| 04 | `04-convergence-logic.md` | Convergence decisions (deterministic + advisory) |
| 05 | `05-direction-handoff-assembly.md` | Final handoff package assembly |
| 06 | `06-serialization.md` | File rendering (direction.md, options.json, etc.) |
| 07 | `07-intelligence-contracts.md` | Rootlet LLM output contracts |
| 08 | `08-convergence-intelligence.md` | Convergence AI advisory |
| 09 | `09-autonomy-intelligence.md` | Autonomy LLM decision loop |
| 10 | `10-rootlet-agent-and-output.md` | RootletAgent dual-path output |
| 11 | `11-minimal-underground-loop.md` | Agent runner, shared context, message flow |

## Critical Caveats for Refactoring

1. **IntentCore is the biggest LLM gap** -- it determines which rootlet kinds to activate, what concepts are relevant, and what the goal statement is, all via keyword matching. Replacing this with LLM would cascade improvements to all downstream agents.

2. **GrowthGovernor is a no-op** -- it just forwards the pre-computed plan. Could be merged with IntentCore or given actual planning intelligence.

3. **Convergence comparison is switch-on-kind** -- `compareCandidateForGoal()` uses hardcoded per-kind rules. LLM convergence would need to replace this with actual fitness evaluation.

4. **Autonomy is already LLM-mainline** -- it is the only agent that requires AI and has no deterministic fallback.

5. **Shared context ownership model** would need updating if agents change roles or new agents are added.

6. **6 fixed rootlet kinds** are hardcoded everywhere -- domain types, keyword tables, objectives, exit criteria, max outputs, steward roles. Adding a new kind requires changes in 8+ files.

7. **Deterministic templates produce generic output** -- "Primary in-memory direction for {goal}" is not useful for real goals. The LLM path already exists but falls back to these templates on failure.

8. **The `growthEntry` in DirectionHandoff is hardcoded** -- `allowedRuntimeShapes: ["single_agent"]`, `suggestedFirstWorkflowNodes: ["generate", "verify", "memory", "govern"]`.

9. **`soilRefs` is hardcoded to `["soil:minimal-constraints"]`** -- no real Soil asset resolution.

10. **Evidence refs include hardcoded doc paths** -- `"docs/开发指南/06-工程实现/06-最小实现边界.md"` etc.
