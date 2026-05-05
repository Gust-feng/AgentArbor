# Research: Convergence AI Advisory

- **Query**: How convergence AI advisory works
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/app/underground/convergence-intelligence.ts` | LLM advisory request + parsing |

## Current Approach

### Purpose

The convergence advisory is an **optional LLM overlay** on top of deterministic convergence. It does NOT make convergence decisions -- it enriches the comparison data.

### Entry Point

`requestConvergenceAiAdvisoryForCandidatePool()` (line 49):
- Called by `ConvergenceJudgeAgent.handleCandidatePoolUpdatedWithAdvisory()`.
- Only called when `agentTurnRuntime` is available.
- Creates a convergence-specific turn policy.

### Turn Policy

```typescript
{
  allowModel: true,
  maxModelRounds: 1,        // single round, no follow-up
  maxToolRounds: 0,          // no tools allowed
  fallback: "deterministic", // graceful degradation
  purpose: "convergence_advisory",
  outputContract: {
    contractId: "convergence-advisory",
    format: "json_object",
    requiredFields: ["candidateAnalyses", "conflictsNeedingUserInput",
                     "constraintViolations", "overallDirectionSummary"],
    requiredStringFields: ["overallDirectionSummary"],
  },
  budget: { maxOutputTokens: 512, maxLatencyMs: 15_000 },
}
```

### System Prompt (line 152-168)

Instructs the model to:
- Analyze which candidates represent truly different directions
- Identify candidates that violate hard constraints
- Recommend strongest primary direction with rationale
- Identify conflicts requiring user confirmation
- Provide one-paragraph overall direction summary
- Return advisory JSON only

### User Prompt Content

Includes:
- Raw goal
- GoalIntentProfile (goalStatement, keyConcepts, nonGoals, acceptanceCriteria)
- Hard constraints
- Rootlet outputs with candidate IDs, summaries, evidence/constraint refs

### Output Contract

```typescript
type ConvergenceAiAdvisory = {
  advisoryId: string;
  recommendedOptionId?: string;
  candidateAnalyses: [{
    candidateId: string;
    kind: string;
    contentDifference: string;
    whyPreferred: string;
    conflictWith: string[];
  }];
  conflictsNeedingUserInput: string[];
  constraintViolations: string[];
  overallDirectionSummary: string;
  modelRequestId?: string;
  modelResponseId?: string;
  status: "completed" | "failed";
}
```

### Integration with Convergence

In `underground-convergence.ts`:
1. Advisory is sanitized via `sanitizeConvergenceAdvisoryForComparison()` (truncation + redaction).
2. `enrichComparisonsWithAdvisory()` overlays advisory data onto deterministic comparisons:
   - `contentDifference`: advisory value overrides deterministic default
   - `whyPreferred`: advisory value overrides deterministic default
   - `conflictWith`: advisory array replaces deterministic default if non-empty
3. Advisory is stored in convergence report's `aiAdvisory` field.

### Sanitization

- All text fields truncated to 600 chars (`MAX_AI_ADVISORY_TEXT_LENGTH`).
- Sensitive patterns (API keys, tokens) redacted.
- `recommendedOptionId` validated against handoff candidate set -- discarded if referencing non-handoff candidate.
- Failed advisory returns empty arrays and empty summary.

## What Would Need to Change for LLM Mainline

1. Currently advisory only enriches 3 fields (contentDifference, whyPreferred, conflictWith). To become mainline, it would need to influence convergence decisions (accept/merge/reject).
2. `maxToolRounds: 0` means the advisory cannot use search/read tools. Enabling tools would allow the model to gather evidence before advising.
3. The advisory prompt is relatively simple -- could be enhanced with historical context, similar past explorations, etc.
4. The advisory does NOT see the deterministic comparison results -- it works from raw candidate data. Feeding comparison context could improve advice quality.

## Caveats

- If the model call fails, convergence falls back to fully deterministic behavior (graceful degradation).
- The advisory is purely informational in the current architecture. The deterministic convergence judge makes all accept/merge/reject decisions.
- `sanitizeConvergenceAiAdvisoryText()` is called both during advisory enrichment AND during report creation (double sanitization).
