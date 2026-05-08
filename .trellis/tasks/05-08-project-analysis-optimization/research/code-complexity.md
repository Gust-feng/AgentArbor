# Research: AgentArbor src code complexity

- **Query**: 分析 AgentArbor `src/app`、`src/domain`、`src/kernel`、`src/adapters` 的模块分布、重复抽象、关键链路（underground、panel、tool runtime、soil/task/workspace）和测试；回答核心闭环、过度抽象/重复/低价值或未闭环模块、可能的瘦身/合并方向。
- **Scope**: internal
- **Date**: 2026-05-08

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/app/minimal-loop.ts` | Desktop/full minimal loop：地下 Plan Package → Soil/TaskSoil → Aboveground plan → worker artifact → verification → governance → observation snapshot。 |
| `src/app/underground-direction-session.ts` | 地下方向会话入口；创建 runtime、goal message、orchestrator，并生成 package/ref/snapshot/path。 |
| `src/app/underground/orchestrator.ts` | Underground Cognitive Runtime 主调度器；串接 IntentCore、GrowthGovernor、RootletExplorer、CandidateCollector、AutonomyReviewer、ConvergenceJudge、HandoffSteward。 |
| `src/app/underground-message-dispatcher.ts` | message-driven 地下调度壳；当前主要把 `goal.received` 转交 `UndergroundAgentOrchestrator.runAsync()`。 |
| `src/app/panel-server.ts` | 本地 HTTP panel/API/SSE/job server；配置、同步/异步 run、desktop/underground run、read-model/canvas/transcript 汇聚点。 |
| `src/app/panel-assets.ts` | 静态 HTML/CSS/JS 字符串；承载本地 panel UI，无前端构建链。 |
| `src/app/panel-run-read-model.ts` | Panel observation/tracking/trace/transcript/SSE read model。 |
| `src/app/panel-canvas-read-model.ts` | Desktop Shell canvas 安全投影。 |
| `src/app/panel-run-jobs.ts` | Panel async run job store and stream event state。 |
| `src/app/task-soil-workspace.ts` | Desktop TaskSoil 输入解析、权限/context refs 校验、脱敏和 TaskSoil 创建。 |
| `src/domain/soil/task-soil.ts` | TaskSoil 与 GlobalSoilView 类型/构造/clone。 |
| `src/domain/soil/store.ts` | 只读 Soil store、能力资产/path bias/历史 run refs。 |
| `src/domain/underground/contracts.ts` | DirectionOption、DirectionHandoff、ConvergenceReview、NutrientRequest/Patch 等地下核心契约。 |
| `src/domain/underground/workspace.ts` | 泛型 InMemoryWorkspace / WorkspaceView / projection view。 |
| `src/domain/underground/agent-loop.ts` | 通用 observe/reason/act/guard/reflect/decide_next agent loop 协议与 round executor。 |
| `src/domain/underground/agent-fabric.ts` | agent tree / parent-child delegation / synthesis fabric types and validation。 |
| `src/domain/underground/radial-growth.ts` | rootlet/candidate/convergence/Plan Package 输入规则。 |
| `src/domain/underground/candidate-comparison.ts` | candidate comparison and deterministic decision logic。 |
| `src/domain/agentarbor/direction-handoff-package.ts` | Plan Package legacy-compatible barrel。 |
| `src/domain/agentarbor/direction-handoff-package/*` | Plan Package schema/contracts/builder/validation/serialization/stores/errors。 |
| `src/kernel/intelligence/agent-turn-runtime.ts` | Agent turn runtime：policy → model request → tool-use loop → normalized result。 |
| `src/kernel/intelligence/tool-use-loop.ts` | 模型工具调用循环。 |
| `src/kernel/intelligence/channel.ts` | NativeIntelligenceChannel event/bus backed model channel。 |
| `src/app/tool-center/tool-center.ts` | App-level tool broker。 |
| `src/app/research/research-runtime.ts` | InformationAccess/research source aggregation runtime。 |
| `src/adapters/intelligence/openai-compatible-chat-completions-provider.ts` | OpenAI-compatible model provider adapter。 |
| `src/adapters/intelligence/fake-model-provider.ts` | Fake model provider；包含多个 underground contract 默认输出分支。 |
| `src/app/agents/aboveground-planner.ts` | Aboveground minimal Plan Package consumer；加载/校验 package 后生成 growth/workflow/task。 |
| `src/app/agents/worker-agent.ts` | Minimal worker artifact producer。 |
| `src/app/agents/verifier.ts` | Minimal verification report producer。 |
| `src/app/agents/governance-review.ts` | Minimal fruit/run-memory/experience/path-bias producer。 |

### Module Distribution Snapshot

Count from `src/app`, `src/domain`, `src/kernel`, `src/adapters`:

| Area | TS files | Tests | Heaviest subdirectories |
|---|---:|---:|---|
| `src/app` | 104 | 33 | `src/app` root 58, `src/app/underground/agents` 16, `src/app/underground` 11, `src/app/agents` 7, `src/app/research` 6 |
| `src/domain` | 76 | 10 | `src/domain/underground` 21, `src/domain/agentarbor/direction-handoff-package` 17, `src/domain/observation` 9, `src/domain/agentarbor` 7 |
| `src/kernel` | 25 | 6 | `src/kernel/intelligence` 12, `messages` 3, `events` 2, `state-machine` 2 |
| `src/adapters` | 8 | 2 | `intelligence` 5, `config` 2 |

Observed test files include 51 `src/**/*test.ts` entries. The densest test coverage is around underground orchestration/intelligence/panel paths (`src/app/underground*.test.ts`, `src/app/panel-server.test.ts`, `src/app/minimal-loop.test.ts`, `src/app/task-soil-workspace.test.ts`) plus kernel primitives and adapter tests.

### Core Closed Loops

#### 1) Desktop/full loop

`src/app/minimal-loop.ts:89-190` is the clearest end-to-end runtime loop:

```ts
export async function runMinimalLoop(...): Promise<MinimalLoopResult> {
  const underground = await runUndergroundDirectionSessionWithIntelligence(...);
  const taskSoil = createTaskSoilFromDesktopInput(...);
  const abovegroundPlanner = new AbovegroundPlanner();
  const workerAgent = new WorkerAgent();
  const verifier = new Verifier();
  const governanceReview = new GovernanceReview();
  ...
  const { directionHandoffPackage, growthPlan, workflow, task } = abovegroundPlanner.plan(...);
  const assignedTask = workerAgent.assignTask(...);
  const artifact = workerAgent.produceArtifact(...);
  const verification = verifier.verify(...);
  const { fruit, runMemory, experienceCandidate, pathBias } = governanceReview.review(...);
  const observationSnapshot = createRunObservationSnapshot(...);
}
```

This loop is core because it traverses the product-visible path from user goal to Plan Package, TaskSoil, execution artifacts, governance outputs, and observation snapshot.

#### 2) Underground Plan Package loop

`src/app/underground-direction-session.ts:66-107` exposes deterministic and intelligence-backed session entrypoints. Both create a `MinimalRuntime`, build a `goal.received` message, run `UndergroundAgentOrchestrator`, then call `completeUndergroundDirectionSession()`.

`src/app/underground/orchestrator.ts:145-170` names the orchestrator as compatibility class but actual Underground Cognitive Runtime scheduler:

```ts
// Compatibility class name retained; this is the Underground Cognitive Runtime scheduler for
// directional intelligence, child delegation, parent synthesis, convergence, and Plan Package creation.
export class UndergroundAgentOrchestrator { ... }
```

`src/app/underground/orchestrator.ts:172-239` shows the start of the manager sequence: workspace/mailbox creation, agent run tree creation, goal publish, IntentCore, workspace patch, `underground.exploration_planned`, then autonomy loop with GrowthGovernor and downstream agents.

This loop is core because it produces `directionHandoffPackage`, `directionHandoffPackageRef`, `loadedDirectionHandoffPackage`, `undergroundReport`, and observation snapshot inputs.

#### 3) Panel/Desktop Shell loop

`src/app/panel-server.ts:122-149` creates the local server and handler. Route handling at `src/app/panel-server.ts:256-294` exposes:

- `POST /api/underground/run`
- `POST /api/underground/runs`
- `POST /api/desktop/runs`
- `GET /api/underground/runs/:id`
- `GET /api/desktop/runs/:id`
- `GET /api/*/runs/:id/stream`

`src/app/panel-server.ts:715-729` routes panel executions to `runDesktopForPanel()` or `runUndergroundForPanel()`. `runDesktopForPanel()` at `src/app/panel-server.ts:731-757` calls `runMinimalLoop()` with configured AI/tool center and TaskSoil input.

This loop is core because it is the user-facing local Desktop Shell / Observation Panel path.

#### 4) Intelligence + tool runtime loop

`src/kernel/intelligence/agent-turn-runtime.ts:77-134` normalizes policy, handles disabled/max-round states, calls `executeToolUseLoop()`, and maps loop results. It sits between app agents and provider/tool adapters.

```ts
const loop = await executeToolUseLoop(
  { intelligenceChannel, toolCenter, callerAgentId, traceId, goalId, ... },
  createModelRequest({ input, policy, requestId })
);
```

`src/adapters/intelligence/openai-compatible-chat-completions-provider.ts` and `src/adapters/intelligence/fake-model-provider.ts` implement provider-side behavior. `src/app/tool-center/tool-center.ts` and `src/app/tool-center/adapters/web-search-tool.ts` provide tool execution.

This loop is core because underground agents use `AgentTurnRuntime` for model/tool calls while panel emits live model deltas and safe read models.

#### 5) Soil / Task / Workspace loop

`src/app/task-soil-workspace.ts:41-76` parses Desktop TaskSoil input and creates TaskSoil refs from goal, workspace, context refs, permission refs, global soil refs, and run material refs. `src/domain/soil/task-soil.ts:44-100` defines TaskSoil/GlobalSoilView constructors. `src/domain/underground/workspace.ts:16-34` provides in-memory workspace snapshots/patch/replace for agent coordination.

This is a supporting core loop: TaskSoil is created in the full loop (`src/app/minimal-loop.ts:111-120`) and workspace drives the underground orchestrator, but Soil remains read-only refs and not a full persistent knowledge system.

### Code Patterns

#### Barrel export layers are widespread

Barrel exports appear in `src/index.ts`, `src/domain/index.ts`, `src/domain/contracts.ts`, `src/domain/underground/index.ts`, `src/kernel/index.ts`, `src/kernel/intelligence/index.ts`, `src/app/agents.ts`, and package-specific indexes. Examples:

- `src/domain/contracts.ts:1-20` re-exports common, constraints, soil, underground, agentarbor, aboveground, governance, fruits, intelligence, observation, tools, research.
- `src/domain/underground/index.ts:2-14` re-exports 13 underground modules.
- `src/domain/agentarbor/direction-handoff-package.ts:1-8` re-exports contracts/schema/errors/builder/validation/serialization/stores.

This creates convenient imports but also multiple parallel public surfaces for the same concepts (`../domain/contracts.js`, `../domain/underground/index.js`, `../domain/agentarbor/direction-handoff-package.js`, direct submodule imports).

#### Legacy compatibility naming is explicit and common

Compatibility notes appear in active code:

- `src/app/underground/orchestrator.ts:145-147` retains compatibility class name while redefining it as cognitive runtime scheduler.
- `src/app/agents/aboveground-planner.ts:15-17` states Aboveground still loads legacy `DirectionHandoffPackage` wire shape while product semantics are Plan / Plan Package.
- `src/domain/agentarbor/direction-handoff-package/schema.ts:5` states Plan Package compatibility payload references Soil and is not a Soil copy/final asset store.
- `src/domain/observation/contracts.ts:207-217` includes V0.3 compatibility views.

This explains duplicate names such as `DirectionHandoffPackage` vs `PlanPackage` and old event keys like `direction_handoff.*`.

#### Kernel imports domain contracts directly

`src/kernel/state-machine/task-state-machine.ts:1-4` imports `GrowthPlan`, `TaskSpec`, `Constraint`, `TaskState`, and `DirectionHandoff` from domain. `src/kernel/router/simple-router.ts:1-2` imports `AgentManifest` and `TaskSpec`. Kernel is therefore not purely domain-agnostic; it is an in-memory runtime kernel bound to AgentArbor domain contracts.

#### App layer carries most orchestration and read-model complexity

`src/app` has 104 TS files. Root-level files include `minimal-*`, `underground-*`, panel files, config, demo, smoke, task soil workspace, direction derivation, recovery, convergence, rootlets, events, report, and read models. Panel-specific logic is split across server/assets/read-model/canvas/jobs, but `panel-server.ts` still contains HTTP routing, job scheduling, SSE flushing, config parsing, run execution, error mapping, and response construction.

#### Generic agent abstractions exist below concrete underground agents

`src/domain/underground/agent-loop.ts` defines generic `AgentLoop<P,D,A,W,C>` with observe/reason/act/guard/reflect/decide phases and optional capability surfaces (`AgentTurnRuntimeSurface`, `AgentToolSurface`, `AgentMemoryView`, `AgentTraceWriter`, `AgentBudgetView`, `AgentConstraintView`). `src/app/underground/orchestrator.ts` then instantiates fixed concrete agents and manually sequences them.

This means the generic loop is used as a phase contract, while the actual topology remains hard-coded in the orchestrator.

### Modules That Look Over-Abstracted, Duplicated, Low-Value, or Not Fully Closed

The following are descriptive findings from code structure and linkage, not implementation changes.

#### A) DirectionHandoff / PlanPackage compatibility surface

Observed files:

- `src/domain/agentarbor/direction-handoff-package.ts`
- `src/domain/agentarbor/direction-handoff-package/*` (17 files incl. tests)
- `src/domain/agentarbor/plan-package.ts`
- `src/domain/underground/contracts.ts` (`DirectionHandoff`)
- `.trellis/spec/backend/direction-handoff-package.md`

The spec says current product fact is Plan Package, while legacy `DirectionHandoffPackage`, store names, and `direction_handoff.*` keys remain compatibility types. Code confirms this with comments in `aboveground-planner.ts` and `orchestrator.ts`.

Complexity signal: Plan Package has one product concept but multiple public names and barrels. Validation is split into many files (`validation`, `content-integrity-validation`, `file-boundary-validation`, `lineage-validation`, `convergence-validation`, `candidate-index-validation`, `hard-constraint-boundary`, `validation-issues`). This is a high-surface core module, not unused, but its naming compatibility layer increases cognitive load.

Possible slimming/merge direction to consider: expose one product-facing Plan Package import path in app code, keep legacy names as internal compatibility aliases, and group validation helpers by validation phase rather than by many tiny modules if future edits keep touching them together.

#### B) Underground orchestration has both message dispatcher and direct session path

Observed files:

- `src/app/underground-direction-session.ts`
- `src/app/underground/orchestrator.ts`
- `src/app/underground-message-dispatcher.ts`

`runUndergroundDirectionSessionWithIntelligence()` directly creates `AgentTurnRuntime` and `UndergroundAgentOrchestrator`, then calls `orchestrator.runAsync()` (`src/app/underground-direction-session.ts:82-107`). `MessageDrivenUndergroundDispatcher` also creates an orchestrator from `goal.received` messages and calls `runAsync()` (`src/app/underground-message-dispatcher.ts:51-107`). Its sync path explicitly does not run the full dispatch and throws for full sync use (`src/app/underground-message-dispatcher.ts:37-49`).

Complexity signal: two orchestration entry surfaces point to the same orchestrator, with dispatcher mostly acting as an adapter over bus messages. Tests exist (`src/app/underground-message-dispatcher.test.ts`), so it is not untested; value depends on whether external callers use bus-driven dispatch rather than the session API.

Possible slimming/merge direction to consider: choose one primary runtime entrypoint for current MVP (session API or message-driven dispatcher), and keep the other as a thin compatibility adapter only if a caller needs it.

#### C) Generic AgentLoop / AgentFabric abstractions are broader than current fixed topology

Observed files:

- `src/domain/underground/agent-loop.ts`
- `src/domain/underground/agent-fabric.ts`
- `src/app/underground/orchestrator.ts`
- `src/app/underground/agents/*`

The generic loop supports memory/tool/budget/trace/constraint surfaces and both `decideNext` and `decide_next`. The orchestrator manually sequences concrete agents (`IntentCoreAgent`, `GrowthGovernorAgent`, `CandidateCollectorAgent`, `AutonomyReviewerAgent`, `ConvergenceJudgeAgent`, `HandoffStewardAgent`) rather than discovering topology dynamically.

Complexity signal: abstractions describe a future flexible agent fabric, while current core loop is a fixed manager pipeline. AgentFabric also has compatibility comments around MVP depth.

Possible slimming/merge direction to consider: for MVP, treat generic loop/fabric as internal underground implementation detail, and keep concrete orchestrator flow as the main documented concept; delay expanding public fabric surfaces until dynamic topology is needed.

#### D) Panel server is a core module but carries many responsibilities

Observed files:

- `src/app/panel-server.ts`
- `src/app/panel-run-jobs.ts`
- `src/app/panel-run-read-model.ts`
- `src/app/panel-canvas-read-model.ts`
- `src/app/panel-assets.ts`

`panel-server.ts` handles routing, config APIs, sync run, async run, SSE, job execution, model delta append, desktop/underground run selection, response shaping, body parsing, and error mapping. It delegates to read-model/canvas/job modules, but remains the main integration surface.

Complexity signal: panel is core to the user-facing loop; the risk is not lack of closure but concentration of unrelated HTTP/job/SSE/config/run code in one file. `panel-assets.ts` is also a very large static UI string, but that follows the spec's no-front-end-build-chain constraint.

Possible slimming/merge direction to consider: if file size becomes the main cost, split by route group or run-job API while keeping one factual source for run state (`PanelRunJobStore`) and read models.

#### E) ResearchRuntime / InformationAccess may be under-closed relative to panel/tool runtime

Observed files:

- `src/domain/research/contracts.ts`
- `src/app/research/research-runtime.ts`
- `src/app/research/source-adapters.ts`
- `src/app/research/research-tools.ts`
- `src/app/tool-center/adapters/web-search-tool.ts`

`ResearchRuntime` aggregates sources (`web`, `codebase`, `soil`, `run_memory`, `docs`, `packages`, `github`) and keeps `searchResultsByRef`. It is connected to `intelligence-channel-factory.ts` via `createConfiguredResearchRuntime`/tool center paths (imports at `src/app/intelligence-channel-factory.ts:11-18` in grep output), but the primary visible web tool path also exists in `src/app/tool-center/adapters/web-search-tool.ts`.

Complexity signal: there are two adjacent concepts: tool execution for web search and higher-level research/information access. The current MVP-visible panel exposes web search config/tooling, while research source aggregation looks broader than visible user flows.

Possible slimming/merge direction to consider: for MVP, keep one user-visible information access path; if research runtime is only used as tool backing, document/shape it as tool internals rather than another product-level runtime.

#### F) Soil / TaskSoil is connected but intentionally read-only and ref-only

Observed files:

- `src/domain/soil/store.ts`
- `src/domain/soil/task-soil.ts`
- `src/app/task-soil-workspace.ts`
- `src/app/minimal-loop.ts`
- `.trellis/spec/backend/soil-store.md`

TaskSoil is created and returned by the full loop, and global soil refs are read from `runtime.soilStore`. Current `createMinimalRuntime()` seeds `soilStore` from `createMinimalSoilConstraints()` and returns `constraints: soilStore.listConstraints()` (`src/app/runtime.ts:18-42`).

Complexity signal: TaskSoil is part of the Desktop Shell story, but current runtime uses minimal in-memory/read-only stores and refs. It is a connected supporting module, not a standalone knowledge base.

Possible slimming/merge direction to consider: keep Soil as read-only refs in MVP; avoid adding writable/global Soil lifecycle unless a visible loop consumes it.

#### G) Aboveground/Worker/Verifier/Governance are closed but minimal/deterministic

Observed files:

- `src/app/agents/aboveground-planner.ts`
- `src/app/agents/worker-agent.ts`
- `src/app/agents/verifier.ts`
- `src/app/agents/governance-review.ts`
- `src/app/minimal-growth-plan.ts`
- `src/app/minimal-verification.ts`
- `src/app/minimal-governance.ts`

The full loop calls these in sequence after approved Plan Package. `AbovegroundPlanner` loads a package by id/version and validates it before planning. Worker/verifier/governance produce deterministic artifacts/reports/events.

Complexity signal: these modules are closed in tests and loop output, but deliver mostly demo/minimal deterministic value compared with the larger underground architecture.

Possible slimming/merge direction to consider: preserve them as a single simple Aboveground execution demo until there is real task execution; avoid expanding agent taxonomy here before user-visible execution improves.

#### H) Kernel runtime primitives are small but domain-bound

Observed files:

- `src/kernel/events/in-memory-event-log.ts`
- `src/kernel/messages/in-memory-message-bus.ts`
- `src/kernel/artifacts/in-memory-artifact-store.ts`
- `src/kernel/registry/in-memory-agent-registry.ts`
- `src/kernel/router/simple-router.ts`
- `src/kernel/state-machine/task-state-machine.ts`
- `src/kernel/intelligence/*`

Kernel primitives are mostly small in-memory classes with tests. However, `task-state-machine.ts` and `simple-router.ts` import domain contracts directly. This is a useful observation for architecture naming: kernel is not a reusable generic framework, but AgentArbor's local in-memory runtime kernel.

Possible slimming/merge direction to consider: keep kernel scoped to local runtime needs; do not treat it as a generic framework boundary unless cross-product reuse becomes real.

### Tests and Closure Notes

Representative test coverage by chain:

| Chain | Tests observed |
|---|---|
| Panel/Desktop | `src/app/panel-server.test.ts`, `src/app/panel-args.test.ts`, `src/app/panel-desktop-launcher.test.ts`, `src/app/panel-run-read-model.test.ts` |
| Full minimal loop | `src/app/minimal-loop.test.ts`, `src/app/task-soil-workspace.test.ts`, `src/app/real-ai-smoke.test.ts` |
| Underground orchestration | `src/app/underground/orchestrator.test.ts`, `src/app/underground-direction-session.test.ts`, `src/app/underground-intelligence.test.ts`, `src/app/underground-autonomy-loop.test.ts`, `src/app/underground-message-dispatcher.test.ts` |
| Underground agents | `src/app/underground/agents/*test.ts` |
| Domain underground | `src/domain/underground/*test.ts` |
| Plan Package | `src/domain/agentarbor/direction-handoff-package.test.ts`, `src/domain/agentarbor/direction-handoff.test.ts` |
| Intelligence runtime | `src/kernel/intelligence/agent-turn-runtime.test.ts`, `src/kernel/intelligence/tool-use-loop.test.ts`, `src/kernel/intelligence/intelligence-channel.test.ts`, adapter provider tests |
| Kernel primitives | event log, message bus, task state machine tests |

The most tested product paths are underground intelligence/orchestration and panel server behavior. ResearchRuntime and some compatibility barrels have less direct evidence in the file list than panel/underground paths.

### Related Specs

| Spec | Relevant Notes |
|---|---|
| `.trellis/spec/backend/direction-handoff-package.md` | States product fact source is Plan Package while `DirectionHandoffPackage`/store/event keys are legacy-compatible names; requires Aboveground to load by directionId+version from validated store. |
| `.trellis/spec/backend/quality-guidelines.md` | Defines `pnpm demo:underground`, `pnpm panel`, desktop smoke, no raw secret/prompt/provider output exposure, and test requirements for panel and underground AI boundaries. |
| `.trellis/spec/backend/soil-store.md` | Defines Soil store as read-only refs and Task Soil input boundaries for Desktop Shell / Underground / evidence / Plan material. |
| `.trellis/spec/backend/tool-runtime.md` | Relevant to `AgentTurnRuntime`, `ToolCenter`, model/tool events, and safe tool output boundaries. |
| `.trellis/spec/backend/observation-read-model.md` | Relevant to panel read models, observation snapshots, transcript/tracking/canvas projections. |
| `.trellis/spec/backend/underground-radial-growth.md` | Relevant to underground rootlet/candidate/convergence behavior and Plan Package boundary. |
| `.trellis/spec/frontend/directory-structure.md` | Documents panel files and says panel must be Desktop Shell prototype, not second run-fact store. |
| `.trellis/spec/frontend/quality-guidelines.md` | Documents panel smoke, no fake default success when real config incomplete, Chinese UI/status requirements, and safe display constraints. |

### External References

None. This task was internal codebase research only.

## Caveats / Not Found

- `python3 ./.trellis/scripts/task.py current --source` failed because `python3` is unavailable in this shell; `python ./.trellis/scripts/task.py current --source` returned `Current task: (none)`. The user explicitly supplied the research output path, so the report was written there.
- This report did not modify business code or specs. It created/updated only `Z:\AgentArbor\.trellis\tasks\05-08-project-analysis-optimization\research\code-complexity.md`.
- The analysis is structural and based on file search/read results, not a full dynamic execution trace.
- Some possible slimming/merge directions are phrased as candidate directions because the Research Agent role does not implement or decide architecture changes.
