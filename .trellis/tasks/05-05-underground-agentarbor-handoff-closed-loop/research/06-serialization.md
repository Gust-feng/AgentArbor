# Research: DirectionHandoffPackage Serialization

- **Query**: How direction.md, options.json etc. are rendered
- **Scope**: internal
- **Date**: 2026-05-05

## Files Found

| File Path | Description |
|---|---|
| `src/domain/agentarbor/direction-handoff-package/serialization.ts` | File rendering |
| `src/domain/agentarbor/direction-handoff-package/contracts.ts` | Package type definitions |
| `src/domain/agentarbor/direction-handoff-package/file-system-store.ts` | File-system persistence |

## Package File Structure

The package contains 11 files (defined in `contracts.ts:3-14`):

| File | Role | Format |
|---|---|---|
| `handoff.meta.json` | Full package payload (canonical) | JSON |
| `direction.md` | Direction brief | Markdown |
| `options.json` | Direction options array | JSON |
| `decision-record.md` | Decision record summary | Markdown |
| `constraints.json` | Constraint refs + candidate constraint refs | JSON |
| `soil-refs.json` | Soil refs | JSON |
| `evidence-index.md` | Evidence refs, source candidates, comparisons, decisions | Markdown |
| `risk-register.md` | Risk register list | Markdown |
| `open-questions.md` | Missing information list | Markdown |
| `escalation-rules.md` | Escalation rules list | Markdown |
| `growth-entry.json` | Growth entry (runtime shapes, workflow nodes) | JSON |

## Rendering Functions

### `serializeDirectionHandoffPackageFiles(pkg)` (line 6)

Returns `Record<DirectionHandoffPackageFilePath, string>` with all 11 files rendered.

### `renderDirection(handoff)` (line 31)

Renders `direction.md`:
```
# Direction Handoff
Direction: {clarifiedGoal}
## Non Goals
- {nonGoals...}
## Assumptions
- {assumptions...}
## Risks
- {risks...}
```

### `renderDecisionRecord(handoff)` (line 47)

Renders `decision-record.md` with retainedOptionId, mergedOptionIds, rejectedOptionIds, userDecisionRequired, abovegroundReferenceOptionIds.

### `renderEvidenceIndex(pkg)` (line 58)

Renders `evidence-index.md` with:
- Direction evidence refs
- Source candidates (id, status, kind, sourceRefs)
- Candidate comparisons (comparisonId, candidateId, conclusion, evidenceRefs)
- Convergence decisions (decisionId, candidateId, status, evidenceRefs)
- Candidate reference index

### `renderRiskRegister(handoff)` (line 98)

Renders `risk-register.md` with riskId, name, blockingLevel.

### `renderList(title, entries)` (line 108)

Generic markdown list renderer for open-questions.md and escalation-rules.md.

## Package Contracts

### DirectionHandoffPackageManifest

```
packageId, schemaVersion: "direction-handoff-package/v0.2",
directionId, directionVersion, status, sourceGoalId,
createdAt, updatedAt, files[]
```

### DirectionHandoffPackage

```
manifest, lineage, directionHandoff, convergenceReview,
candidateReferenceIndex[], files[], validation
```

### DirectionHandoffPackageStore interface

```typescript
save(pkg): DirectionHandoffPackage
load(directionId, version): DirectionHandoffPackage
listVersions(directionId): number[]
validate(pkg): DirectionHandoffPackageValidationResult
```

## What Would Need to Change for LLM Mainline

1. The serialization is template-based and data-driven -- it reads from DirectionHandoff fields. If those fields are populated by LLM rather than deterministic logic, serialization does not need to change.
2. The `renderDirection()` function is minimal -- just lists. A richer rendering could include the LLM advisory's `overallDirectionSummary`.
3. `renderEvidenceIndex()` could include AiAdvisory candidate analyses for richer evidence documentation.

## Caveats

- V0.2 treats `handoff.meta.json` as the canonical payload; split files are rendered views (comment on line 9).
- All markdown rendering uses simple `- {entry}` lists with no nesting or rich formatting.
- The schema version is hardcoded to `"direction-handoff-package/v0.2"`.
