# Research: Testing Patterns and Handoff/Panel Related Files

- **Query**: Research AgentArbor underground test patterns and handoff/panel related files
- **Scope**: internal
- **Date**: 2026-05-06

---

## 1. Agent Test Patterns

### Files Found

| File Path | Description |
|---|---|
| `src/app/underground/agents/intent-core.test.ts` | IntentCore agent tests (5 tests) |
| `src/app/underground/agents/growth-governor.test.ts` | GrowthGovernor agent tests (4 tests) |
| `src/app/underground/agents/rootlet-explorer.test.ts` | RootletExplorer agent tests |
| `src/app/underground/agents/convergence-judge.test.ts` | ConvergenceJudge agent tests |
| `src/app/underground/agents/handoff-steward.test.ts` | HandoffSteward agent tests |

### Test Structure Pattern

All AI-ified agent tests follow an identical `describe`-less `test()` structure using Node's built-in `node:test` and `node:assert/strict`. There are no `describe` or `beforeEach` blocks; each test is a standalone `test("label", async () => { ... })`.

#### Common Flow Per Test

```
1. Create agent instance:  const agent = new XxxAgent();
2. Create context with helper:  const ctx = createXxxContext({ agentTurnRuntime?: ... })
3. Observe:   const percept = agent.observe(ctx);
4. Reason:    const decision = await agent.reason(ctx, percept);
5. Act:       const output = agent.act(ctx, decision);
6. Guard:     const guarded = agent.guard(ctx, output);
7. Assert on decision/output/guarded
```

#### Standard Test Categories

Each agent test file covers:

1. **AI path test** -- verifies `decision.source === "ai"`, `confidence > 0.7`, `modelCallRefs.length === 1`, `fallbackRefs === []`.
2. **Deterministic fallback test** -- verifies when `AgentTurnRuntime` is absent: `source === "deterministic_fallback"`, `confidence < 0.2`, `fallbackRefs.includes("agentturnruntime:missing")`.
3. **Redaction / safety test** (IntentCore only) -- verifies that unsafe provider summaries (containing "chain-of-thought", "Raw goal:", "raw provider response", "sk-test-secret") are replaced with `[redacted-reasoning-detail]`.
4. **Guard structural boundary test** -- verifies `guard()` rejects structurally invalid outputs (e.g., conflicting hard constraints, missing invocations, empty output IDs).

### Mock Model Provider Pattern

Tests do NOT use `FakeModelProvider` from `src/adapters/intelligence/fake-model-provider.ts`. Instead, each test file defines its own inline `IntelligenceChannel` implementation:

```typescript
class IntentProfileTestChannel implements IntelligenceChannel {
  async request(request: ModelRequest): Promise<ModelResponse> {
    return {
      responseId: "model-response-intent-test",
      requestId: request.requestId,
      providerId: "intent-profile-test-provider",
      providerKind: "fake",
      protocolKind: "openai_compatible_chat_completions",
      model: "intent-profile-test-model",
      status: "completed",
      outputKind: request.outputContract.outputKind,
      structuredOutput: { /* hardcoded fixture */ },
      finishReason: "stop",
      validation: { status: "passed", checkedAt: "...", issues: [] },
      completedAt: "...",
    };
  }
  validateResponse(_request, response) { return response.validation; }
}
```

The channel is then wrapped: `new AgentTurnRuntime({ intelligenceChannel: new XxxTestChannel() })`.

The `GrowthGovernorTestChannel` demonstrates a slightly smarter fixture that reads the request content to extract `availableRootletKinds` from the prompt, making the fixture output dynamic.

### Context Creation Pattern

Each test has a helper function `createXxxContext(input)` that:

1. Creates `InMemoryWorkspace<WorkspaceSnapshot<...>>` with traceId, goalId, goal string, and domain-specific `data`.
2. Creates `InMemoryMailbox` and optionally routes a synthetic message into it.
3. Returns `AgentRunContext` with `workspace`, `mailbox`, and `capabilities` (constraints array + optional `agentTurnRuntime`).

### IntentCore `safeHandoffText` Redaction

The `safeHandoffText()` function in `handoff-steward.ts` uses a chain of regex replacements:
- `chain[-\s]?of[-\s]?thought` -> `[redacted-reasoning-detail]`
- `hidden reasoning` -> `[redacted-reasoning-detail]`
- `raw prompt` -> `[redacted-reasoning-detail]`
- `raw provider response` -> `[redacted-reasoning-detail]`
- `system|user|assistant|tool :` -> `[redacted-reasoning-detail]`
- `raw goal :` -> `[redacted-reasoning-detail]`

This is verified by the IntentCore test `"reasoning trace redacts unsafe provider summary fragments"`.

---

## 2. HandoffSteward Agent

### File: `src/app/underground/agents/handoff-steward.ts`

#### Agent Identity
- `agentId = "underground-handoff-steward-loop"`
- Implements `AgentLoop<HandoffStewardPercept, HandoffStewardDecision, HandoffStewardAction, HandoffStewardWorkspace, HandoffStewardCapabilities>`

#### Workspace / Capabilities
- **Workspace** contains: `traceId`, `goalId`, `rawGoal`, `goalIntentProfile?`, `convergenceReport?`, `candidatePool?`, `constraints`
- **Capabilities** contain: `agentTurnRuntime?`, `directionHandoffPackageStore`

#### Guard Logic (lines 279-372)

The guard performs these structural checks:

1. **Missing convergence report** -> reject with `HANDOFF_NO_CONVERGENCE_REPORT`
2. **Package validation failed** -> checks each validation error; if `terminalStatus === "approved_package_created"` OR error code not in expected-failure set -> reject with `HANDOFF_PACKAGE_<code>`
3. **Constraint weakening check** -> if `terminalStatus === "approved_package_created"`, all hard constraints from workspace must appear in the handoff package's `constraintRefs`; missing ones produce `HANDOFF_CONSTRAINT_WEAKENED`
4. **Candidate evidence refs** -> every source candidate must have non-empty `sourceRefs`; empty -> `HANDOFF_CANDIDATE_NO_EVIDENCE_REFS`
5. **Manifest consistency** -> `manifest.directionId` must match `directionHandoff.id`; mismatch -> `HANDOFF_PACKAGE_STRUCTURE_ILLEGAL`
6. **Convergence review match** -> `pkg.convergenceReview.reviewId` must match workspace `convergenceReport.reviewId`; mismatch -> `HANDOFF_CONVERGENCE_REF_MISMATCH`

Expected failure codes that are NOT treated as errors for non-approved terminal statuses:
- `DIRECTION_HANDOFF_NOT_APPROVED`
- `MISSING_SOURCE_CANDIDATE_REFS`
- `MISSING_CONVERGENCE_REVIEW_REF`
- `UNCONVERGED_SOURCE_CANDIDATES`

#### Reasoning Logic (lines 169-231)

The `reason()` method:
1. Creates a fallback material (low-confidence, `source === "deterministic_fallback"`)
2. Calls `reasonWithAgentTurn()` with purpose `"handoff_narrative"` and `HANDOFF_NARRATIVE_CONTRACT`
3. Parses output with `parseHandoffNarrativeOutput()` which enforces:
   - `status` must be one of `approved | awaiting_user | stopped`
   - Cannot approve when convergence report outcome is not `"approved"`
   - Cannot approve without handoff candidate refs
   - Cannot set `awaiting_user` without an existing clarification request
   - Requires non-empty `clarifiedGoal`, `evidenceBoundary`, `decisionSummary`
   - Approved status requires at least one `optionNarrative` with a handoff candidate ref

#### Decision / Action Types

```typescript
HandoffStewardDecision: {
  handoffStrategy: "ai_narrative" | "deterministic_fallback"
  handoffMaterial: HandoffDecisionMaterial
  source: "ai" | "deterministic_fallback"
  confidence: number
  reasoningTrace: UndergroundReasoningTraceEntry[]
}

HandoffStewardAction: {
  directionHandoffPackage: DirectionHandoffPackage
  directionHandoffPackageRef: DirectionHandoffPackageRef
  terminalStatus: "approved_package_created" | "awaiting_user" | "stopped"
  source: "ai" | "deterministic_fallback"
  confidence: number
  reasoningTrace: UndergroundReasoningTraceEntry[]
}
```

#### Terminal Status Mapping

```typescript
convergence outcome "approved"     -> terminalStatus "approved_package_created"
convergence outcome "awaiting_user" -> terminalStatus "awaiting_user"
convergence outcome "stopped"       -> terminalStatus "stopped"
```

---

## 3. ConvergenceJudge Agent

### File: `src/app/underground/agents/convergence-judge.ts`

#### Agent Identity
- `agentId = "underground-convergence-judge-loop"`

#### Guard Logic (lines 265-365)

1. **Approved convergence must use AI** -> if `report.outcome === "approved"` and `report.source !== "ai"` -> `CONVERGENCE_APPROVED_WITHOUT_AI_JUDGMENT`
2. **Hard constraint violation not blocked** -> if approved, any accepted candidate referencing a hard constraint without evidence -> `HARD_CONSTRAINT_VIOLATION_NOT_BLOCKED`
3. **Fallback confidence too high** -> if `source === "deterministic_fallback"` and `confidence > 0.3` -> `CONVERGENCE_FALLBACK_CONFIDENCE_TOO_HIGH`
4. **Empty summary** -> `CONVERGENCE_EMPTY_SUMMARY`
5. **No decisions** -> `CONVERGENCE_NO_DECISIONS`
6. **Decision without evidence** -> each decision's `evidenceRefs.length === 0` produces a WARNING (not error): `CONVERGENCE_DECISION_NO_EVIDENCE`
7. **AI advisory desensitization** -> if aiAdvisory analysis `contentDifference` was fully redacted to empty -> `CONVERGENCE_AI_ADVISORY_DESENSITIZATION_EMPTY` (warning)

#### Evidence Reference Pattern

Each candidate decision has:
```typescript
{
  candidateId: string
  status: "accepted" | "merged" | "rejected" | "unknown"
  reason: string
  evidenceRefs: string[]           // must be non-empty (warning if empty)
  clarificationReason?: UserClarificationReason
  contentDifference?: string
  whyPreferred?: string
  conflictWith?: string[]
  openQuestion?: string
  blockingLevel?: "blocking" | "non_blocking"
}
```

#### Reasoning Flow

The `reason()` method has three paths:
1. **Terminal autonomy** (when `autonomyDecision.status !== "completed"` or `action !== "request_convergence"`) -> returns a terminal convergence report directly, no AI call
2. **AI judgment** -> calls `reasonWithAgentTurn()` with purpose `"convergence_judgment"` and `CONVERGENCE_JUDGMENT_CONTRACT`
3. **Deterministic fallback** -> creates a fallback judgment that rejects all candidates and stops

#### Parse Validation

`parseConvergenceJudgmentOutput()` enforces:
- `nextAction` must be one of: `approve_handoff | continue_exploration | request_user_clarification | stop`
- `candidateDecisions` must be an array covering exactly every candidate ID in the pool
- `request_user_clarification` requires at least one `"unknown"` candidate
- `approve_handoff` requires at least one `"accepted"` or `"merged"` candidate
- `continue_exploration` or `stop` cannot have `"accepted"` or `"merged"` candidates
- Non-empty `overallDirectionSummary` and `decisionSummary` required

---

## 4. RootletExplorer Agent

### File: `src/app/underground/agents/rootlet-explorer.ts`

#### Agent Identity
- `agentId` is dynamic: `rootlet-explorer-${kind.replace("_", "-")}` (e.g., `rootlet-explorer-option`)
- Constructor takes `kind: RootletClusterKind`

#### evidenceRefs Pattern

Each candidate material produced by RootletExplorer has:

```typescript
{
  summary: string
  sourceIndex: number
  sourceRefs: string[]    // contractId, variant ref, model-candidate ref, requestId, responseId
  evidenceRefs: string[]  // evidenceId(...), model-call responseId
}
```

The `evidenceRefs` are built from:
```typescript
evidenceRefs: [
  evidenceId(percept.goalId, `rootlet:${percept.cluster.kind}:${candidate.sourceIndex + 1}`),
  `model-call:${response.responseId}`,
]
```

Tool call refs are merged into `evidenceRefs` during the `reason()` post-processing:
```typescript
evidenceRefs: unique([...material.evidenceRefs, ...ai.toolCallRefs])
```

#### Guard Logic (lines 297-343)

1. **Non-empty outputId** per rootlet output -> `ROOTLET_EXPLORER_EMPTY_OUTPUT_ID`
2. **Non-empty clusterId** per rootlet output -> `ROOTLET_EXPLORER_EMPTY_CLUSTER_ID`
3. **Non-empty summary** per rootlet output -> `ROOTLET_EXPLORER_EMPTY_SUMMARY`
4. **Budget exhausted** -> `ROOTLET_EXPLORER_BUDGET_EXHAUSTED` (warning)
5. **Hard constraint violated** -> `ROOTLET_EXPLORER_HARD_CONSTRAINT_VIOLATED` (error)
6. Guard sanitizes all rootlet output summaries with `sanitizeUndergroundConvergenceAiAdvisoryText()`

#### AI Reasoning Options

```typescript
{
  maxModelRounds: 3,
  maxToolRounds: 2,
  fallback: "deterministic",
  budget: { maxOutputTokens: 256, maxLatencyMs: 30_000 },
  allowedTools: strategy.availableTools,
}
```

---

## 5. Fallback Output

### File: `src/app/underground/fallback.ts`

Small file (27 lines). Exports `createDeterministicFallbackRootletOutputs()` which:
1. Delegates to `createRootletOutputsForInvocation()` (from `underground-rootlets.ts`)
2. Overrides `source` to `"deterministic_fallback"` on each output
3. Accepts `sourceRefs` and `goalIntentProfile` as optional inputs

This is used by `RootletExplorerAgent.actDeterministic()` when no AI candidate materials are available.

---

## 6. Panel Read-Model

### File: `src/app/panel-run-read-model.ts`

1282 lines. The primary panel data projection layer.

#### Key Types

| Type | Description |
|---|---|
| `PanelRunStatus` | `"pending" | "running" | "completed" | "failed"` |
| `PanelObservationReadModel` | Thin pick from `RunObservationSnapshot` |
| `PanelRunTraceReadModel` | Event views + waitingPoint |
| `PanelRunTrackingReadModel` | Comprehensive run tracking with provider info, rootlet tracking, model/tool totals, candidates, autonomy, convergence, package |
| `PanelRootletTrackingReadModel` | Per-kind rootlet tracking (cluster status, invocation status, model status, candidates, ai/fallback counts) |
| `AgentWorkNote` | Per-agent structured note with noteId, agentId, agentLabel, stage, status, summary, detail, refs |
| `PanelTranscriptModelCall` | Per-model-call tracking (requestId, responseId, status, purpose, rootletKind, provider, visibleOutput, refs) |
| `PanelRunStreamEvent` | Streaming event for UI (eventId, runId, sequence, type, agentLabel, summary, delta, status, refs) |
| `PanelRunTranscript` | Full transcript (runId, status, updatedAt, events, workNotes, modelCalls) |

#### Stream Event Types
```
"run.started" | "agent.note.delta" | "agent.note.completed" | "model.output.delta" |
"model.output.completed" | "tool.requested" | "tool.completed" | "tool.failed" |
"final.result" | "run.failed"
```

#### Agent Work Notes (7 notes generated)

1. **Intent Core** -- `intent-core`, stage `intent_profile`
2. **Growth Governor** -- `growth-governor`, stage `rootlet_planning`
3. **Rootlet Agents** -- `rootlet-agents`, stage `rootlet_outputs`
4. **Model Calls** -- `model-calls`, stage `model_call`
5. **Autonomy Core** -- `autonomy-core`, stage `autonomy_review`
6. **Convergence Judge** -- `convergence-judge`, stage `convergence_review`
7. **Handoff Steward** -- `handoff-steward`, stage `direction_handoff`

Each note has a status derived from which events have been observed in the event log.

#### Key Functions

- `toPanelObservation()` -- thin projection of `RunObservationSnapshot`
- `createPanelRunTrace()` -- creates trace from event entries with waitingPoint
- `createPanelRunTracking()` -- comprehensive tracking combining config, observation, events, summary
- `createPanelRunTranscript()` -- generates full transcript with stream events, work notes, model calls
- `createPanelRunStreamEvents()` -- generates streaming event sequence from event log

---

## 7. Direction Handoff Package Types

### File: `src/domain/agentarbor/direction-handoff-package.ts` (barrel)
### File: `src/domain/agentarbor/direction-handoff-package/contracts.ts` (actual types)

#### Core Types

```typescript
DirectionHandoffPackage = {
  manifest: DirectionHandoffPackageManifest
  lineage: DirectionHandoffPackageLineage
  directionHandoff: DirectionHandoff
  convergenceReview: ConvergenceReview
  candidateReferenceIndex: DirectionHandoffPackageCandidateReference[]
  files: DirectionHandoffPackageFile[]
  validation: DirectionHandoffPackageValidationResult
}
```

#### Manifest
```typescript
DirectionHandoffPackageManifest = {
  packageId: string
  schemaVersion: "direction-handoff-package/v0.2"
  directionId: string
  directionVersion: number
  status: DirectionHandoff["status"]
  sourceGoalId: string
  createdAt: string
  updatedAt: string
  files: DirectionHandoffPackageFile[]
}
```

#### Package Files (11 possible files)
```
handoff.meta.json, direction.md, options.json, decision-record.md,
constraints.json, soil-refs.json, evidence-index.md, risk-register.md,
open-questions.md, escalation-rules.md, growth-entry.json
```

#### Store Interface
```typescript
interface DirectionHandoffPackageStore {
  save(pkg: DirectionHandoffPackage): DirectionHandoffPackage
  load(directionId: string, version: number): DirectionHandoffPackage
  listVersions(directionId: string): number[]
  validate(pkg: DirectionHandoffPackage): DirectionHandoffPackageValidationResult
}
```

#### Candidate Reference
```typescript
DirectionHandoffPackageCandidateReference = {
  candidateId: string
  kind: ExplorationCandidateRef["kind"]
  producedByAgentId: string
  clusterId: string
  sourceRefs: string[]
  status: ExplorationCandidateRef["status"]
  convergenceReviewRef: string
}
```

---

## 8. Underground Direction Session (Entry Point)

### File: `src/app/underground-direction-session.ts`

208 lines. Two entry functions:

#### `runUndergroundDirectionSession(goal, options?)`
- Synchronous orchestrator path (no intelligence channel)
- Creates `MinimalRuntime` + `UndergroundAgentOrchestrator`
- Calls `orchestrator.run(message)` (synchronous)

#### `runUndergroundDirectionSessionWithIntelligence(goal, options)`
- Async orchestrator path (with intelligence channel)
- Creates `IntelligenceChannel` via `options.createIntelligenceChannel(runtime)`
- Optionally creates `ToolExecutionBroker` via `options.createToolCenter`
- Instantiates `AgentTurnRuntime` with intelligence channel and tool center
- Calls `orchestrator.runAsync(message)`

#### Options
```typescript
RunUndergroundDirectionSessionOptions = {
  constraints?: Constraint[]
  packageStore?: DirectionHandoffPackageStore
  outputDirectory?: string
  requireAutonomy?: boolean
  maxAutonomyCycles?: number
  onRuntimeReady?: (context) => void
}
```

#### Terminal Statuses
```
"approved_package_created" | "awaiting_user" | "stopped"
```

#### Result Shape
```typescript
UndergroundDirectionSessionResult = {
  runtime: MinimalRuntime
  traceId: string
  goalId: string
  terminalStatus: UndergroundDirectionSessionTerminalStatus
  undergroundReport: UndergroundExplorationReport
  directionHandoff?: DirectionHandoff
  directionHandoffPackage: DirectionHandoffPackage
  directionHandoffPackageRef: DirectionHandoffPackageRef
  loadedDirectionHandoffPackage: DirectionHandoffPackage
  observationSnapshot: RunObservationSnapshot
  undergroundOrchestratorRun: UndergroundAgentOrchestratorRunTrace
  eventTypes: ArborMessageType[]
  packageVersions: number[]
  writtenPackagePath?: string
  outputDirectory?: string
}
```

---

## 9. AgentTurnRuntime Interface

### File: `src/kernel/intelligence/agent-turn-runtime.ts`

235 lines. The core AI execution runtime.

#### Constructor
```typescript
new AgentTurnRuntime({
  intelligenceChannel: IntelligenceChannel
  toolCenter?: ToolExecutionBroker
  publishToolEvent?: (message: ArborMessage) => void
})
```

#### Execute Method
```typescript
execute(input: AgentTurnRuntimeInput): Promise<AgentTurnRuntimeResult>
```

#### Input
```typescript
AgentTurnRuntimeInput = {
  policy: AgentTurnPolicy
  callerRef: ModelRequest["callerRef"]
  inputRefs: ObservationRef[]
  sanitizedMessages: ModelMessage[]
  constraintRefs: ConstraintRef[]
  requestId?: string
  toolChoice?: ModelToolChoice
  requestedAt?: string
}
```

#### Policy
```typescript
AgentTurnPolicy = {
  allowModel: boolean
  allowedTools?: string[]
  maxModelRounds: number
  maxToolRounds: number
  fallback: "deterministic" | "disabled"
  callerAgentId: string
  traceId: string
  goalId: string
  purpose: ModelPurpose
  outputContract: ModelOutputContract
  sensitivity: ModelRequest["sensitivity"]
  budget: ModelBudget
}
```

#### Result
```typescript
AgentTurnRuntimeResult = {
  status: "completed" | "failed" | "disabled"
  stoppedReason: "completed" | "no_tool_calls" | "model_disabled" | "max_tool_rounds" |
                 "max_model_rounds" | "model_failed" | "runtime_error"
  fallback: AgentTurnFallbackBehavior
  modelRequestId?: string
  modelResponseId?: string
  finalOutput?: ModelResponse
  toolCalls: ToolCallResult[]
  modelRounds: number
  toolRounds: number
}
```

#### Tool Use Loop

Delegates to `executeToolUseLoop()` from `./tool-use-loop.js`. A `NO_TOOL_BROKER` sentinel is used when no tool center is provided.

---

## 10. FakeModelProvider

### File: `src/adapters/intelligence/fake-model-provider.ts`

619 lines. A comprehensive fake model provider for tests and demos.

#### Constructor Options
```typescript
FakeModelProviderOptions = {
  providerId?: string       // default "fake-model-provider"
  model?: string            // default "fake-deterministic-model"
  output?: unknown          // fixed output
  textOutput?: string       // fixed text output
  toolCalls?: ModelToolCall[] // fixed tool calls
  fail?: boolean            // always fail
  failureMessage?: string
  responses?: FakeModelProviderResponse[]  // sequenced responses
  onOutputDelta?: (delta: ModelOutputDelta) => void  // streaming callback
}
```

#### Sequenced Responses
When `responses` array is provided, calls step through them sequentially. After exhausting the array, falls back to the default options.

#### Default Output Generation

The provider generates contract-aware default outputs based on `contractId`:

| contractId | Default Output |
|---|---|
| `underground.intent_profile.v1` | Goal-aware intent profile with keyConcepts, domainConcepts, nonGoals, etc. |
| `underground.growth_governor.v1` | Rootlet dispatch with dynamic rootletKinds parsed from prompt |
| `underground.convergence_judgment.v1` | Candidate-aware convergence judgment with status logic based on goal keywords |
| `underground.handoff_narrative.v1` | Handoff narrative with candidate references parsed from prompt |
| `convergence-advisory` | Advisory with empty candidate analyses |
| `underground.autonomy_decision.v1` | `request_convergence` action |
| Any contract with `requiredFields: ["candidates"]` | Two fake candidates per kind |

#### Key Dynamic Behavior

- **Goal-aware**: Reads `Raw goal:` from prompt content; generates concepts, risk hints, constraint hints, nonGoals, unknowns based on goal text
- **Candidate-aware**: Parses `[kind] candidateId=xxx outputId=xxx` patterns from convergence prompt
- **Stop/clarification keywords**: Detects "stop", "no viable", "permission", "hard constraint" in goal text to adjust convergence behavior
- **Rootlet kind aware**: Parses `Available rootlet kinds:` from growth governor prompt

---

## 11. Cluster Directory Content

### Directory: `src/app/underground/cluster/`

12 files, all from May 5-6, 2026.

| File | Size | Description |
|---|---|---|
| `index.ts` | 361B | Barrel exports (9 files) |
| `agent-context.ts` | 9,888B | Agent context creation |
| `shared-context.ts` | 8,083B | Shared context |
| `intent-core-agent.ts` | 3,347B | IntentCore agent |
| `growth-governor-agent.ts` | 3,301B | GrowthGovernor agent |
| `rootlet-agent.ts` | 7,674B | Rootlet agent |
| `candidate-pool-agent.ts` | 3,463B | CandidatePool agent |
| `convergence-judge-agent.ts` | 13,010B | ConvergenceJudge agent |
| `handoff-steward-agent.ts` | 8,265B | HandoffSteward agent |
| `autonomy-core-agent.ts` | 11,696B | AutonomyCore agent |
| `agent-runner.ts` | 9,707B | Agent runner |
| `agent-runner.test.ts` | 3,962B | Agent runner tests |

This is the **old cluster-based architecture** that coexists with the newer `src/app/underground/agents/` pattern. The `agents/` directory contains the newer, AI-first agents that use `AgentTurnRuntime`, `reasonWithAgentTurn()`, and the `observe/reason/act/guard` protocol. The `cluster/` directory contains an older implementation.

Note: The `index.ts` barrel does NOT export `autonomy-core-agent.ts`.

---

## Caveats / Not Found

1. **No active task was set** -- wrote research to `.trellis/tasks/05-06-underground-completion-and-hardening/research/` as it was the most recent untracked task directory.
2. **`FakeModelProvider` is NOT used in agent unit tests** -- agent tests inline their own `IntelligenceChannel` implementations. `FakeModelProvider` appears to be used by integration/demo tests elsewhere.
3. **`cluster/` vs `agents/` duplication** -- both directories contain implementations of the same agents. The `cluster/` directory appears to be the older, pre-AI-mainline version. The newer `agents/` directory is the active AI-first implementation.
4. **No `describe` blocks** -- all agent tests use flat `test()` calls without describe grouping.
5. **The `direction-handoff-package.ts` barrel** just re-exports from subdirectory files (`contracts.ts`, `schema.ts`, `errors.ts`, `builder.ts`, `validation.ts`, `serialization.ts`, `in-memory-store.ts`, `file-system-store.ts`). Only `contracts.ts` was read for this research.
