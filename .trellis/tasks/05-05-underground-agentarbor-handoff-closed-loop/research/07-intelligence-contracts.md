# Research: Intelligence Contracts (Rootlet Output Contracts)

- **Query**: What output contracts exist for rootlets
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/intelligence-contracts.ts` | Rootlet candidate advice contracts per kind |
| `src/app/underground/intelligence-output.ts` | Parsing + formatting of LLM rootlet output |
| `src/app/underground/intelligence-prompts.ts` | System/user prompt construction for rootlet LLM calls |
| `src/app/underground-intelligence.ts` | Top-level rootlet LLM request orchestrator |

## Rootlet Output Contracts (per kind)

Each rootlet kind has a `UndergroundRootletCandidateAdviceContract` defining:
- `kind`: RootletClusterKind
- `modelOutputContract`: ModelOutputContract with JSON format, `candidates` array field
- `candidateArrayField`: "candidates"
- `candidateFields`: kind-specific field definitions

### Option Contract
- `summary` (string): "A concise candidate direction."
- `tradeoffs` (string_array): "Material tradeoffs for convergence review."
- `applicability` (string): "When this candidate direction should apply."

### Risk Contract
- `summary` (string): "A concise risk candidate."
- `impactScope` (string): "The affected scope if this risk materializes."
- `severity` (string): "Risk severity as low, medium, high, or blocking."
- `mitigation` (string): "A bounded mitigation candidate."

### Asset Fit Contract
- `summary` (string): "A concise Soil asset fit candidate."
- `assetRefs` (string_array): "Soil or capability refs only, without asset body content."
- `fitConditions` (string_array): "Conditions where the referenced asset could fit."
- `doNotApplyWhen` (string_array): "Conditions where the asset refs should not apply."

### Evidence Contract
- `summary` (string): "A concise evidence candidate."
- `evidenceType` (string): "The kind of evidence to collect or cite."
- `confidence` (string): "Confidence level for the evidence suggestion."

### Constraint Contract
- `summary` (string): "A concise constraint candidate."
- `constraintLevel` (string): "hard, soft, or preference."
- `enforcementGate` (string): "The gate where this constraint must be enforced."

### Counterfactual Contract
- `summary` (string): "A concise counterfactual candidate."
- `alternativeDirection` (string): "A plausible alternative direction."
- `whyNotChosen` (string): "Why this direction should not drive the first growth path."

## Common Output Contract Properties

All contracts share:
- `format`: `"json_object"`
- `requiredFields`: `["candidates"]`
- `visibleOutput.maxItems`: 3
- `visibleOutput.maxFieldLength`: 180

## Rootlet LLM Request Flow

`requestUndergroundRootletCandidateAdvice()` (`underground-intelligence.ts:59`):
1. Gets advice contract for the rootlet kind.
2. Builds turn policy via `createUndergroundRootletAgentTurnPolicy()`.
3. Builds messages via `buildUndergroundRootletCandidateAdviceMessages()`.
4. Executes `agentTurnRuntime.execute()`.
5. Parses output via `parseUndergroundRootletCandidateAdviceOutput()`.
6. If parsing produces candidates, creates `RootletOutput[]` with model source refs.
7. If parsing fails or returns empty, returns empty with fallback source refs.

## Turn Policy for Rootlets

```typescript
{
  allowModel: true,  // from basePolicy
  allowedTools: ["search", "read"],  // from basePolicy
  maxModelRounds: from basePolicy,
  maxToolRounds: from basePolicy,
  fallback: from basePolicy,
  purpose: "rootlet_candidate",
  outputContract: kind-specific advice contract,
  budget: { maxOutputTokens: 256, maxLatencyMs: 30_000 },
  sensitivity: "internal"
}
```

## System Prompt (intelligence-prompts.ts)

The system prompt instructs the model to:
- Return JSON with `candidates` array
- Follow kind-specific output contract
- Meet quality requirements (specific, actionable, evidence-based, distinct)
- Use `search` and `read` tools for real evidence
- Classify information needs before tool use
- Stay within boundaries (candidate advice only, no approval, no constraint weakening)

## Output Parsing (intelligence-output.ts)

`parseUndergroundRootletCandidateAdviceOutput()`:
- Validates top-level object has `candidates` array.
- For each candidate: validates fields match contract.
- Truncates field values to 180 chars.
- Returns parsed candidates + discarded count + issues.

`formatUndergroundRootletCandidateAdviceSummary()`:
- Formats a parsed candidate into a single summary string incorporating all fields.

## What Would Need to Change for LLM Mainline

1. The contracts are already designed for LLM output -- no change needed.
2. The system prompt already instructs for quality, evidence-based candidates. Could be enhanced with more context.
3. The `maxItems: 3` limit is in the contract -- could be made dynamic.
4. The `maxFieldLength: 180` truncation is quite aggressive -- may lose important nuance.
5. The prompt mentions `search` and `read` tools but these depend on `ToolExecutionBroker` being provided.

## Caveats

- The turn policy's `fallback` comes from the base policy (manifest). If fallback is "deterministic", the model failure gracefully degrades to template outputs.
- Tool calls produce `research:*` refs that are collected as evidence refs.
- The parsing is defensive -- unknown fields are ignored, missing required fields cause the candidate to be discarded.
