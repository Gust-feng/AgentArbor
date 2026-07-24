---
name: tool-design
description: Design, audit, debug, and improve agent tool systems with explicit definitions, run-frozen execution authorization, progressive model visibility, confirmation, truthful result delivery, continuation, provider projections, and evaluation. Use when adding or reviewing built-in tools, MCP tools, function JSON Schema, tool registries, deferred tool loading, tool results, or tool-call quality in AgentArbor or a similar TypeScript agent runtime.
---

# Tool Design

## Workflow

1. Establish authority before editing. Read the repository `AGENTS.md`. In AgentArbor, read [agentarbor-fact-sources.md](references/agentarbor-fact-sources.md); do not turn this Skill or a research note into a product fact source.
2. Name the owner and the neutral boundary. A feature owns its run state, events, repository, completion semantics, and read model. Shared tool infrastructure owns only mechanical definition, execution, confirmation, delivery, and protocol adaptation. Do not introduce a universal runner, cross-feature tool state, or a second business fact store.
3. Inventory four run-scoped sets independently: frozen catalog, execution-allowed tools, confirmation policy, and the model active set. Record executor availability and provider capability as inputs to boundary resolution, not as permission inferred from visibility. Loading a definition may change the next model request; it must not widen execution authorization.
4. Define observable input and metadata contracts before implementation. Keep the provider description factual. Put representable constraints in JSON Schema, preserve unknown JSON Schema keywords across copies, and fail explicitly on unsupported values. Function/MCP input schemas require an object root with explicit `type: "object"`.
5. Preserve definition identity across adapter, cache, snapshot, and run boundaries. Retain canonical and provider-native names where both exist, source identity, complete schemas, and stable definition hashes. Never recover a provider method or risk capability from names, descriptions, or keywords.
6. Keep `ToolCallResult` as the execution fact. Preserve status, input/output facts, errors, confirmation, duration, and attachment metadata required by the owning contract. Derive model and UI views in one direction; do not replace the fact with a summary or duplicate it into competing envelopes.
7. Separate producer continuation from transport retention. Producer pagination must return a JSON-safe, replayable `nextInput` for that producer. Oversized results without safe producer pagination use the real evidence reader contract; a bare reference is not an executable continuation. Never synthesize a continuation that can replay side effects.
8. Treat deferred visibility as a measured optimization, not a semantic router. In AgentArbor, only run-frozen, execution-allowed MCP definitions may enter the current cost-gated progressive plan. Search/load controls operate on that frozen catalog, execute nothing remotely, and leave the model to decide whether and what to load. On a definition conflict, uncertainty, or no net savings, keep the complete definitions visible instead of failing the run.
9. Verify the smallest complete changed path. Select focused tests from the matrix in the fact-source reference, include negative cases at each changed boundary, run `pnpm build:node`, and run broader tests only when a shared contract or multiple consumers changed.
10. Keep runtime metrics and offline evaluations separate from execution facts. Metrics may record bounded counts, hashes, sizes, timings, statuses, and continuation outcomes; they must not alter the result. Evaluate tool selection, argument validity, delivery, continuation, and task outcome as distinct questions when the task actually concerns quality.
11. Update the owning ADR, runtime statement, or development guide when a stable boundary changes. If documentation and implementation disagree but the task cannot edit the fact source, report the drift instead of encoding the discrepancy in this Skill.

## Judgment boundary

Use deterministic code for JSON representability, frozen identity and permission, explicit confirmation, provider capability, evidence integrity, recovery validity, and measurable visibility cost gates. Leave goal interpretation, tool choice, whether to search or load, argument strategy, result interpretation, and continue/stop decisions to the model. Do not replace those decisions with keyword routing, tool-name inference, fixed stages, or a fixed tool-count threshold.

## Non-negotiable checks

- Do not truncate, redact, line-number, or summarize canonical tool facts merely to make a UI projection convenient. Bounded model delivery must preserve complete evidence or an honest producer continuation.
- Do not delete mature tool capabilities (batch edits, dry-run, occurrence or range guards) to simplify a schema.
- Do not make optional inputs nullable-and-required just to satisfy a provider subset; represent truly optional fields as optional and adapt only at the provider boundary.
- Do not infer capabilities from tool names, descriptions, or keywords when an explicit metadata field or run fact can express them.
- Do not register a catalog-only definition with a fake executor.
- Do not conflate a producer's real pagination with transport-level retention. Both may exist and must remain distinguishable in metrics and results.

## Reference

- For AgentArbor authority, contract locations, and focused commands, read [agentarbor-fact-sources.md](references/agentarbor-fact-sources.md).
- When reviewing a change or preparing its focused test matrix, read [contract-checklist.md](references/contract-checklist.md).
