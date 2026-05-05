# Research: Domain Layer Contracts (src/domain/underground/)

- **Query**: All contract types in the underground domain layer -- what fields exist, what's hardcoded vs dynamic
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/domain/underground/contracts.ts` | Core handoff, option, risk, candidate, convergence, nutrient types |
| `src/domain/underground/intent-core.ts` | GoalIntentProfile type + deterministic keyword-based creation |
| `src/domain/underground/radial-growth.ts` | RootletCluster types, ExplorationBudget, CandidatePool, ConvergenceReport, AiAdvisory |
| `src/domain/underground/agent-cluster.ts` | Agent roles, cluster plan/run/invocation types |
| `src/domain/underground/autonomy.ts` | AutonomyDecision, ExplorationCycle, AutonomyReview types |
| `src/domain/underground/evidence-ledger.ts` | EvidenceEntry, EvidenceLedger types |
| `src/domain/underground/candidate-comparison.ts` | CandidateComparison type + deterministic comparison logic |
| `src/domain/underground/clarification.ts` | UserClarificationRequest/Response, OpenQuestionDisposition |
| `src/domain/underground/index.ts` | Re-exports + `UndergroundBoundary` type |

## Key Contract Types

### GoalIntentProfile (`intent-core.ts:1-16`)

```
goalId, rawGoal, goalStatement, keyConcepts[], nonGoals[], acceptanceCriteria[],
assumptions[], riskHints[], constraintHints[], unknowns[], createdAt
```

**Creation approach**: Fully deterministic, keyword-matching. `createGoalIntentProfile()` (line 164) uses hardcoded keyword tables for 7 categories (risk, asset, evidence, constraint, counterfactual, unknown, domain). Chinese + English bilingual. Extraction is regex + `String.includes()`.

### RootletClusterPlan (`radial-growth.ts:51-60`)

```
clusterId, kind (6 fixed kinds), stewardRole, objective, inputRefs[],
exitCriteria[], status, budget: { maxCandidateOutputs }
```

Hardcoded max outputs per kind in `underground-rootlets.ts:35-42`: option=3, risk=3, asset_fit=2, evidence=3, constraint=3, counterfactual=2.

### RootletClusterKind (`radial-growth.ts:28-35`)

Six fixed kinds: `option | risk | asset_fit | evidence | constraint | counterfactual`. Hardcoded as `const` array. No runtime extension.

### RootletOutput (`radial-growth.ts:71-84`)

```
outputId, invocationId, clusterId, kind, producedByAgentId, summary,
sourceRefs[], evidenceRefs[], soilAssetFitRefs[], constraintRefs[],
riskRefs[], status: "produced"
```

### ExplorationCandidateRef (`contracts.ts:41-49`)

```
id, kind (observation|evidence_candidate|claim_candidate), producedByAgentId,
clusterId, summary?, sourceRefs[], status (candidate|accepted|merged|rejected|unknown)
```

### CandidatePool (`radial-growth.ts:96-105`)

```
poolId, goalId, sourceRootletOutputRefs[], candidates[],
candidatesByKind (Record<RootletClusterKind, candidates>), counts, updatedAt
```

### CandidateConvergenceDecision (`radial-growth.ts:112-121`)

```
decisionId, candidateId, sourceCandidateRefs[], status (accepted|merged|rejected|unknown),
decidedByRole: "convergence_judge", reason, provenanceRefs[], evidenceRefs[]
```

### UndergroundConvergenceReport (`radial-growth.ts:131-159`)

Large type with: reviewId, reviewedByAgentIds, leadAgentId, crossCheckedCandidateRefs,
deduplicated/accepted/merged/rejected/unknownCandidateRefs, conflictResolutionRefs,
provenanceRefs, decisions[], candidateComparisons?, evidenceLedgerRef?,
recommendedOptionId?, rejectedCandidateRefsWithReasons, userDecisionRequired,
abovegroundReferenceOptionIds, summary, outcome (approved|awaiting_user|stopped),
userEscalationRequired, userClarificationRequest?, openQuestions[], budgetExhausted,
stopReason?, handoffCandidateRefs[], aiAdvisory?

### UndergroundConvergenceAiAdvisory (`radial-growth.ts:161-175`)

LLM advisory overlay with: advisoryId, recommendedOptionId?, candidateAnalyses[],
conflictsNeedingUserInput[], constraintViolations[], overallDirectionSummary, status.

### DirectionHandoff (`contracts.ts:92-120`)

The final output package: id, version, sourceGoalId, rawUserInputRef, clarifiedGoal,
nonGoals[], assumptions[], missingInformation[], soilRefs[], evidenceRefs[],
constraintRefs[], candidateConstraintRefs[], risks[], options[], decisionRecord,
riskRegister[], sourceCandidateRefs[], convergenceReviewRef, recommendedOptionId?,
growthEntry, status (draft|awaiting_user|approved|superseded).

### DirectionOption (`contracts.ts:6-18`)

```
optionId, directionSummary, supportingEvidenceRefs[], soilAssetFitRefs[],
constraintImpact[], riskProfile[], costProfile[], unknowns[], whyNot[],
recommendationScore?, doNotChooseWhen[]
```

### UndergroundAutonomyDecision (`autonomy.ts:31-42`)

```
decisionId, cycleId, action (continue_exploration|request_convergence|
request_user_clarification|stop), completionAssessment, informationGaps[],
spawnRequests[], rationale, sourceRefs[], modelCallRefs[], status, stopReason?
```

## Hardcoded vs Dynamic

| Aspect | Hardcoded | Dynamic |
|---|---|---|
| RootletClusterKind | 6 fixed kinds | None |
| GoalIntentProfile keywords | ~100 keyword hints in 7 tables | None |
| Max outputs per rootlet kind | Fixed numbers (2-3) | None |
| Steward roles per rootlet kind | Fixed mapping | None |
| Rootlet objectives | Fixed string per kind | Appends goalStatement when profile exists |
| Convergence outcome logic | Deterministic rules | AiAdvisory is optional LLM overlay |
| Candidate comparison | Fully deterministic by kind | AiAdvisory enriches contentDifference/whyPreferred |

## Caveats

- The `NutrientRequest` and `NutrientPatch` types exist in contracts.ts but appear unused in the current underground agent cluster flow.
- `DirectionRiskRecord.blockingLevel` has 5 levels but convergence comparison only uses 4-level `CandidateComparisonLevel` (strong/partial/weak/blocking).
