# Research: AgentArbor 项目目标、文档叙事与代码实现偏差

- **Query**: 分析 AgentArbor 当前项目目标、文档叙事与代码实现之间的偏差；重点回答：1) 项目宣称要解决什么；2) 当前实现最能证明价值的闭环是什么；3) 目标与实现之间有哪些不一致、膨胀或漂移。
- **Scope**: internal
- **Date**: 2026-05-08

## Findings

### Files Found

| File Path | Description |
|---|---|
| `README.md` | 根入口仍描述旧概念树，并声明当前事实源为 ADR-0018。 |
| `AGENTS.md` | 开发规则与当前项目定位，明确 ADR-0022、Desktop Shell 和双运行时为现行主线。 |
| `docs/README.md` | 文档入口，明确当前产品架构事实源是 ADR-0022，并列出新开发者需要回答的问题。 |
| `docs/开发指南/01-基础/01-愿景.md` | 长期愿景与 MVP 愿景，收缩到桌面通用 Agent 与任务闭环。 |
| `docs/开发指南/01-基础/02-产品定义.md` | 当前一句话产品定义、用户获得物、核心对象和价值指标。 |
| `docs/开发指南/01-基础/03-非目标.md` | 明确不是聊天机器人、prompt 仓库、一次性脚手架、平台配置仓库、无边界自治系统或资料堆。 |
| `docs/开发指南/02-核心闭环/README.md` | 核心闭环索引，强调闭环必须指导实现。 |
| `docs/开发指南/02-核心闭环/03-资产与能力生长.md` | 资产与能力从任务运行进入 Run Memory、Experience Candidate、Path Bias、治理和 Capability Asset 的链路。 |
| `docs/开发指南/02-核心闭环/05-运行沉淀闭环.md` | 运行沉淀闭环，定义 Run Memory、Experience Candidate、Path Bias、Capability Asset。 |
| `docs/开发指南/03-系统架构/01-系统总览.md` | Desktop Shell -> Task Soil -> Underground -> Plan -> Aboveground -> Fruits -> Governance -> Global Soil 的系统图。 |
| `docs/开发指南/03-系统架构/04-Agent集群运行结构.md` | Agent 集群依附于 Desktop 任务闭环，MVP 一层 child agent。 |
| `docs/开发指南/06-工程实现/01-技术主线.md` | TypeScript 自研、本地服务、本地嵌入式数据库优先、先闭环再生态。 |
| `docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md` | Accepted ADR，正式把产品收缩为桌面通用 Agent 和双运行时架构。 |
| `docs/任务看板/看板.md` | 当前项目推进看板，说明 Desktop Shell + Task Soil + 真实 AI 工作流任务状态。 |
| `.agentarbor/README.md` | `.agentarbor` 旧说明，仍把目录称为 future startup assets/runtime protocol drafts，并引用旧 ADR-0012/v2 植物架构。 |
| `.trellis/spec/backend/soil-store.md` | 当前 Task Soil / Soil Store 契约；明确只读、内存、无长期写入治理。 |
| `.trellis/spec/backend/observation-read-model.md` | Observation Panel / read model 契约；说明 Aboveground、Fruits、Governance、Soil return 当前可为 summary/stub。 |
| `.trellis/spec/backend/tool-runtime.md` | ToolCenter、ResearchRuntime、AgentTurnRuntime 与工具边界契约。 |
| `.trellis/spec/backend/quality-guidelines.md` | 质量规范与测试脚本，记录当前工具链、panel、desktop smoke、真实 AI smoke 边界。 |
| `package.json` | 当前脚本和依赖：TypeScript、node:test、Electron；description 仍是 deterministic minimal runtime kernel。 |
| `src/app/minimal-loop.ts` | 当前最完整的端到端闭环实现入口。 |
| `src/app/task-soil-workspace.ts` | Desktop Shell 输入组装 Task Soil，支持 context refs、permission refs、只读 preview 和脱敏。 |
| `src/domain/soil/task-soil.ts` | Task Soil / Global Soil view 类型与创建函数。 |
| `src/app/underground-agent-cluster-runtime.ts` | 地下 rootlet / candidate pool / convergence / handoff 旧 cluster 形态核心实现之一。 |
| `src/app/agents/aboveground-planner.ts` | 轻量 Aboveground consumer：加载 Plan Package，生成 GrowthPlan、WorkflowIR、Task。 |
| `src/app/agents/worker-agent.ts` | 当前地上执行 worker：写入内存 document artifact。 |
| `src/app/agents/governance-review.ts` | 当前治理输出：Fruit、RunMemory、ExperienceCandidate、PathBias 事件与对象。 |
| `src/app/panel-server.ts` | 本地 panel HTTP API，包含 `/api/desktop/runs`、SSE、配置与同步/异步运行入口。 |
| `src/app/panel-canvas-read-model.ts` | Desktop Shell 主画布读模型，展示 Task Soil、Plan、Aboveground、Fruits 与解释。 |
| `src/app/panel-run-read-model.ts` | Observation Panel tracking、trace、transcript、stream read models。 |
| `src/app/panel-assets.ts` | 本地中文面板 HTML/CSS/JS 资源。 |

### Project Claims: 要解决什么

1. 当前正式叙事中，AgentArbor 要解决的是“桌面通用 Agent / 桌面任务工作台”问题，而不是聊天、IDE 替代或 prompt 仓库。
   - `docs/开发指南/01-基础/02-产品定义.md:2-5` 给出一句话定义：用户给任务，系统从 Task Soil 出发，地下认知运行时动态派生 child agent 做多方调研，父层综合裁决形成 Plan，地上执行运行时按 Plan 交付，结果经治理回流长期土壤。
   - `docs/开发指南/01-基础/03-非目标.md:2-24` 明确排除聊天机器人、prompt 仓库、一次性脚手架、平台配置仓库、无边界自治系统和资料堆。
   - `docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md:23-27` 用同一叙事定义现行产品，并说明地下 runtime 不再是孤立研发目标，`.agentarbor` 不再是产品概念树节点，Aboveground 不再是远未来概念。

2. 用户价值被描述为：用户不重复组织任务上下文，系统把文件/项目/网页/约束组织成 Task Soil，通过 agent 协作形成可执行、可解释、可监督的 Plan，并在相似任务中因 Run Memory / Path Bias 越用越聪明。
   - `docs/开发指南/01-基础/01-愿景.md:4-8` 说明用户只通过 Desktop Shell 给出任务和工作区材料，系统组织为 Task Soil，再由 Underground 和 Aboveground 完成交付；长期通过 Path Bias 让相似任务更快、更稳、更清楚。
   - `docs/开发指南/01-基础/02-产品定义.md:6-17` 列出用户获得物：Task Soil、地下认知过程、Plan、地上执行、Fruits、治理回流、监督解释。
   - `docs/开发指南/01-基础/02-产品定义.md:94-105` 给出价值指标：统一桌面入口、AI agent 真实探索裁决、child 输出经父层综合、Plan 被地上消费并产出成果、Panel 可监督、运行形成 Run Memory / Experience Candidate、相似任务更快更稳。

3. MVP 被收缩为比赛阶段的最小闭环，而不是完整平台。
   - `docs/开发指南/01-基础/01-愿景.md:10-31` 指定 MVP 闭环：任务输入 -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruit -> Run Memory，并要求 Desktop Shell、AI-first 地下 runtime、主画布和 Observation Panel、至少一种可见成果。
   - `docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md:227-245` 明确 MVP 优先 Desktop Shell、Task Soil、Underground + Plan 产品化、轻量 Aboveground、Main Canvas/Observation Panel；不做完整 IDE、终端代理、插件市场、多用户、完整治理/Capability Asset 平台、多层递归 Agent Fabric。

### Current Implementation: 当前最能证明价值的闭环

当前实现最能证明价值的是 `runMinimalLoop()` 及其 Desktop Panel 包装形成的端到端“任务输入到可见 Fruit/Run Memory”内存闭环。

1. 闭环入口和主流程在 `src/app/minimal-loop.ts:89-190`：
   - 创建 AI runtime config；
   - 调用 `runUndergroundDirectionSessionWithIntelligence()`；
   - 从 Desktop input 组装 Task Soil；
   - 读取 Global Soil view；
   - AbovegroundPlanner 加载并验证 Plan Package；
   - WorkerAgent 产出 artifact；
   - Verifier 验证；
   - GovernanceReview 产出 Fruit、RunMemory、ExperienceCandidate、PathBias；
   - 创建 Observation Snapshot；
   - 返回完整对象和事件列表。

2. 事件序列体现当前证明链路，`src/app/minimal-loop.ts:36-55` 固定了从 `goal.received` 到 `path_bias.suggested` 的 18 类事件：

```ts
export const EXPECTED_DEMO_EVENTS: ArborMessageType[] = [
  "goal.received",
  "underground.exploration_planned",
  "rootlet_cluster.started",
  "exploration_candidate.produced",
  "candidate_pool.updated",
  "convergence_review.completed",
  "direction_handoff.completed",
  "growth_plan.completed",
  "workflow.created",
  "task.created",
  "task.assigned",
  "artifact.produced",
  "verification.completed",
  "fruit.proposed",
  "governance.review.completed",
  "run_memory.captured",
  "experience_candidate.proposed",
  "path_bias.suggested",
];
```

3. Task Soil 入口已从纯 goal 扩展到 Desktop refs，但仍是安全引用/短 preview 形态：
   - `src/app/task-soil-workspace.ts:52-75` 用 goal、goalId、traceId、aiMode、constraints、soilStore、taskSoilInput 创建 TaskSoil。
   - `src/app/task-soil-workspace.ts:78-110` 默认加入 `goal:<id>`、`workspace:<id>`，再合并用户提供的 context refs 和只读 preview。
   - `src/app/task-soil-workspace.ts:113-123` 默认权限包含 `read:workspace:current-task`、`write:memory://artifacts` 和 AI 执行模式。
   - `src/app/task-soil-workspace.ts:196-238` 拒绝 `secret/runtime/store/api_key/token/authorization` 等 refs。

4. 地下层价值证明主要在“动态 rootlet/candidate/convergence/handoff 可观测”而非真实执行产物本身：
   - `src/app/underground-agent-cluster-runtime.ts:107-145` 的 `runUndergroundAgentClusterExplorationWithIntelligence()` 通过 `AgentTurnRuntime` 请求 rootlet 模型输出，并请求 convergence AI advisory，再完成地下探索。
   - `src/app/underground-agent-cluster-runtime.ts:247-356` 发布候选、candidate pool、convergence review 事件，并形成 `UndergroundExplorationReport`。
   - `docs/任务看板/看板.md:28-30` 记录前置任务已完成动态 child/rootlet 输出进入 Agent Run Tree、父层 synthesis/convergence 后才进入 Plan Package。

5. Aboveground 目前是最小 consumer，而非完整执行智能：
   - `src/app/agents/aboveground-planner.ts:15-18` 注释明确它是 “Aboveground Execution Runtime minimal consumer”。
   - `src/app/agents/aboveground-planner.ts:21-80` 加载 DirectionHandoffPackage/Plan Package、校验、创建 GrowthPlan/Workflow/Task 并发布事件。
   - `src/app/agents/worker-agent.ts:25-47` 产出固定内存文档 artifact：`Minimal desktop-agent artifact produced by the local WorkerAgent.`
   - `src/app/agents/governance-review.ts:22-98` 使用 `createMinimalGovernanceOutput()` 生成 Fruit、RunMemory、ExperienceCandidate、PathBias，并发布五个治理/沉淀事件。

6. 用户可见证明面在 panel：
   - `src/app/panel-server.ts:256-270` 暴露 `/api/underground/run`、`/api/underground/runs`、`/api/desktop/runs`。
   - `src/app/panel-server.ts:383-404` 支持 async run job，立即返回 202 并后台执行。
   - `src/app/panel-canvas-read-model.ts:96-210` 从 MinimalLoopResult、Observation、tracking、transcript 派生 Desktop Shell Canvas，展示 Task Soil、Plan、Aboveground、Fruits 和解释。
   - `src/app/panel-run-read-model.ts:168-213` 定义 stream/transcript 读模型；`src/app/panel-run-read-model.ts:88-108` tracking 中包含 autonomy、agentRunTree、convergence、package validation 等观测字段。
   - `.trellis/spec/backend/observation-read-model.md:36-40` 说明 panel HTTP/SSE 只返回安全派生视图；Aboveground/Fruits/Governance/Soil return 当前可为 summary/stub。

7. 当前运行与验证脚本在 `package.json:6-14`：`build`、`test`、`demo`、`demo:underground`、`panel`、`panel:smoke`、`panel:desktop`、`panel:desktop:smoke`。这说明可演示闭环主要是本地 Node/Electron panel + 内存 runtime。

### Goal / Narrative / Implementation Alignment

1. ADR-0022、开发指南、AGENTS.md 与当前代码大体对齐到 Desktop Shell + Task Soil + Underground + Plan + lightweight Aboveground + Panel 的 MVP 闭环。
   - `AGENTS.md:28-38` 与 `docs/架构设计/产品架构/ADR-0022...md:8-27` 均以 Desktop Shell -> Task Soil -> Underground -> Plan -> Aboveground -> Fruits -> Governance -> Global Soil 为现行主线。
   - `docs/开发指南/03-系统架构/01-系统总览.md:4-18` 对应 `src/app/minimal-loop.ts:89-190` 的实际顺序。
   - `.trellis/spec/backend/quality-guidelines.md:49-51` 将 Desktop Shell API、Task Soil、approved Plan、Aboveground artifact、Fruit canvas 摘要，以及 fake AI / AgentTurnRuntime 的模型路径列为测试验收重点。

2. 当前最强证明点不是“长期越用越聪明”或“完整 AgentApp 孕育平台”，而是“安全可观测的本地任务闭环”：
   - Task Soil 安全入口：`src/app/task-soil-workspace.ts:52-75`。
   - 地下 agent/candidate/convergence 可观测：`src/app/underground-agent-cluster-runtime.ts:247-356`。
   - Plan Package 不让 child output 直通执行：`src/app/agents/aboveground-planner.ts:29-41`。
   - 最小地上产物和治理沉淀：`src/app/agents/worker-agent.ts:25-47`、`src/app/agents/governance-review.ts:22-98`。
   - Canvas / Observation Panel 安全投影：`src/app/panel-canvas-read-model.ts:118-210`、`.trellis/spec/backend/observation-read-model.md:27-40`。

3. 文档中“价值判断”的许多长期项目前仍只是接口、summary、stub 或内存对象。
   - `.trellis/spec/backend/soil-store.md:2-7` 明确当前不实现数据库、文件持久化、写入治理或真实资产沉淀。
   - `.trellis/spec/backend/observation-read-model.md:40` 明确 Aboveground、Fruits、Governance 和 Soil return 当前可以是 summary/stub。
   - `docs/开发指南/02-核心闭环/05-运行沉淀闭环.md:73-82` 定义“凡入土必经过 Governance Pipeline”等硬规则，但当前 `GovernanceReview` 只是内存生成与事件发布，没有长期 Soil 写入。

### Drift / Inconsistency / Bloat: 不一致、膨胀或漂移

#### 1. 根 README 与现行事实源不一致

- `README.md:2-4` 仍写 AgentArbor 是“目标驱动的 Agent / AgentApp 孕育与演化平台”，以 `Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil` 为原生概念树，并声明当前产品架构事实源是 ADR-0018。
- `docs/README.md:11-12` 与 `AGENTS.md:38` 均声明当前事实源已是 ADR-0022，ADR-0018 只保留为历史概念树和植物语义来源。
- `README.md:30-31` 还说 `.agentarbor/` 是未来原生方向交接包目录、`src/` 当前只包含第一阶段确定性最小运行内核；而 `docs/README.md:82-83` 说 `.agentarbor` 是 Plan Package 默认存储目录，`src/` 当前已有地下 AI-first cognitive runtime、Agent Fabric 和监督面板基础。
- 偏差形态：根入口滞后于正式文档和代码，会让第一次阅读者以旧平台/AgentApp 孕育叙事理解当前项目。

#### 2. `.agentarbor/README.md` 仍保留旧 v2 / startup assets 叙事

- `.agentarbor/README.md:2-8` 将目录描述为 future startup assets and runtime protocol drafts，并说当前开发 work belongs in `docs/`。
- `.agentarbor/README.md:33` 仍引用 ADR-0012 和 v2 植物学融合架构路径，但当前 docs 实际事实源是 ADR-0022；Glob 结果显示现有产品架构文件为 ADR-0013/0014/0018/0019/0020/0021/0022 等，未在当前架构设计列表中看到 `ADR-0012-v2架构候选基线.md` 或 `v2植物学融合架构/` 这个路径。
- `docs/架构设计/产品架构/ADR-0022...md:125-140` 已把 `.agentarbor` 降级为 Plan Package 的实现/存储形态或目录名，且旧 10 文件方向交接包契约不再扩张。
- 偏差形态：`.agentarbor` 的目录说明与当前 Plan Package 叙事不完全一致，容易把它重新推回“原生 startup asset / product seed”概念层。

#### 3. 产品目标从“AgentApp 孕育平台”收缩到“桌面通用 Agent”，但部分旧文档/字段仍混用两套语言

- 旧叙事：`README.md:2` 使用 “Agent / AgentApp 孕育与演化平台”；`docs/开发指南/06-工程实现/01-技术主线.md:18` 仍写“先证明 AgentApp 可出生，再谈大规模 agent 市场”。
- 新叙事：`docs/开发指南/01-基础/01-愿景.md:4-8` 与 ADR-0022 均强调桌面通用 Agent 和任务工作台；`docs/架构设计/产品架构/ADR-0022...md:31-37` 明确旧平台愿景过大，比赛 MVP 应解释为桌面任务工作台。
- 偏差形态：旧 AgentApp/市场/孕育平台语言仍少量留在基础入口和工程原则中，与当前 MVP 的“任务工作台 + 可见成果”焦点并存。

#### 4. 当前代码中 Aboveground / Governance / Soil Return 的命名完整，但实现价值仍是最小 stub

- 文档目标要求 Aboveground 执行文件修改、文档生成、原型制作、工具调用和验证：`docs/开发指南/01-基础/02-产品定义.md:62-65`。
- 当前 WorkerAgent 只写内存 document artifact：`src/app/agents/worker-agent.ts:25-47`，内容为固定字符串，未体现真实文件修改、文档草案生成、原型或工具调用。
- 文档目标要求 Governance Pipeline 筛选、验证、归因、去重、版本化和退役管理：`docs/架构设计/产品架构/ADR-0022...md:203-215`；当前 GovernanceReview 发布 `approved_for_soil_review` 和 RunMemory/ExperienceCandidate/PathBias 事件，但仍是最小输出：`src/app/agents/governance-review.ts:42-95`。
- `.trellis/spec/backend/soil-store.md:2-7` 明确当前不做长期 Soil 写入或真实资产沉淀。
- 偏差形态：事件和对象名称覆盖了完整链路，但实际最有价值的部分集中在“闭环形状”和“观察面”，不是长期治理资产能力。

#### 5. 文档叙事对 AI-first 的强调强于当前端到端默认价值证明

- 文档要求地下 runtime 的探索和裁决真正由 AI agent 完成，且无 `AgentTurnRuntime` 不允许 approved Plan：`docs/开发指南/01-基础/02-产品定义.md:98-100`、`docs/开发指南/01-基础/01-愿景.md:30`。
- `src/app/minimal-loop.ts:93-102` 默认 `aiMode` 是 `fake`，并通过配置完整性控制真实 AI。
- `.trellis/spec/backend/quality-guidelines.md:19` 把真实 AI smoke 放在独立命令，不属于默认 `pnpm test`；`.trellis/spec/backend/quality-guidelines.md:70` 说明默认测试仍走 fake/stub，真实 provider 缺失时报告 skip/config boundary。
- 偏差形态：测试和可复现 demo 证明的是 fake/stub AI 路径和边界，真实 AI 工作流依赖显式配置与 smoke；这与“AI-first agent 协作”的产品叙事在演示强度上有距离。

#### 6. 架构文档和 spec 的面积明显大于当前可见用户价值

- 当前可运行脚本和依赖很轻：`package.json:6-20` 只有 TypeScript、node:test、Electron。
- 但 `.trellis/spec/backend/observation-read-model.md:27-40` 对 Underground view、evidence ledger、user escalation、Plan Package view、Desktop canvas、AI 输出、工具调用、SSE/transcript 等有大量详细契约；`.trellis/spec/backend/tool-runtime.md:37-64` 对 ToolCenter / ResearchRuntime / AgentTurnRuntime / OpenAI-compatible tool loop / source adapters / panel routes 也有大面积约束。
- `docs/开发指南/01-基础/02-产品定义.md:18-93` 已定义 Desktop Shell、Task Soil、Global Soil、Underground、Shared Agent Kernel、Agent Fabric、Plan、Aboveground、Nutrient Request、Path Bias、Governance、Fruits 等完整对象体系。
- 偏差形态：项目拥有较完整的“产品语言和契约语言”，但用户可见的核心成果仍是本地面板上的一个内存闭环和固定 artifact，存在文档/架构面宽于当前价值证明的漂移。

#### 7. 看板承认当前处于“真实 AI 工作流与 Task Soil 工作台入口”实现中，与 Git 状态/根 README 的阶段描述不一致

- `docs/任务看板/看板.md:12-18` 说明当前任务正在把真实 AI 工作流与 Task Soil 工作台入口落成实现，Desktop run 默认推荐 `openai-compatible`，fake AI 降为测试模式，右侧面板按产品级监督台重做。
- `README.md:4` 仍写当前仓库进入“第一阶段确定性最小运行内核实现”，运行时代码限制在内存版闭环、事件、状态、产物、验证和治理回流范围。
- 偏差形态：看板和代码已进入 Desktop/Task Soil/AI/panel 产品化入口，根 README 仍停在更早的“确定性最小运行内核”阶段。

#### 8. 旧 cluster 形态与新 cognitive runtime 叙事并存

- 看板称当前 cognitive runtime 已替代旧 cluster 形态，只继承边界：`docs/任务看板/看板.md:43-46`。
- 代码中 `src/app/underground-agent-cluster-runtime.ts` 仍是重要实现文件，包含 `runUndergroundAgentClusterExplorationWithIntelligence()`、rootlet invocations、candidate pool 和 convergence。
- 文档新叙事强调 `AgentLoop / AgentTurnRuntime / ToolCenter / WorkspaceView / Mailbox / Guard / Trace` 的 Shared Agent Kernel：`docs/架构设计/产品架构/ADR-0022...md:78-99`。
- 偏差形态：实现中保留旧命名和旧 cluster 模块承载部分主流程，读者需要额外理解“旧 cluster 已被重新解释/继承边界”这一迁移状态。

### Code Patterns

1. 端到端闭环通过 app 层组合多个内存组件，而不是数据库或外部服务：
   - `src/app/minimal-loop.ts:104-121`：先地下 session，再创建 Task Soil 和 Global Soil view。
   - `src/app/minimal-loop.ts:122-152`：依次 new `AbovegroundPlanner`、`WorkerAgent`、`Verifier`、`GovernanceReview` 并串行执行。
   - `src/app/minimal-loop.ts:153-168`：由运行结果派生 Observation Snapshot。

2. “事实源”和“观察面”分离：
   - `.trellis/spec/backend/observation-read-model.md:19-25`：EventLog 是 source of truth，Observation Kernel 只能派生；Event view 不能读取 runtime store。
   - `src/app/panel-canvas-read-model.ts:96-210`：Canvas 是从 result、observation、tracking、transcript 派生的 read model。

3. Task Soil 安全投影优先 refs 和短 preview：
   - `src/domain/soil/task-soil.ts:19-32`：TaskSoil 类型只包含 rawGoal、contextRefs、constraints、permissionBoundaryRefs、globalSoilRefs、runMaterialRefs 等。
   - `src/app/task-soil-workspace.ts:241-255`：preview text 统一截断并脱敏。

4. 轻量 Aboveground 仍使用旧 DirectionHandoffPackage wire shape，但产品语义按 Plan / Plan Package 解释：
   - `src/app/agents/aboveground-planner.ts:15-18` 注释明确 legacy wire shape 与 ADR-0022 语义关系。
   - `src/app/agents/aboveground-planner.ts:29-41` 强制从 store load + validate，再进入 planning。

5. Governance 当前是事件与候选对象生成，不是长期 Soil promotion：
   - `src/app/agents/governance-review.ts:42-95` 逐个发布 fruit、governance review、run memory、experience candidate、path bias 事件。
   - `.trellis/spec/backend/soil-store.md:31`：Soil Store 只读接口不是 Governance 入土流程，长期资产沉淀等后续任务。

### External References

- 未使用外部搜索。该任务要求分析仓库内部项目目标、文档叙事与代码实现偏差，内部文件已覆盖所需范围。

### Related Specs

- `.trellis/spec/backend/soil-store.md` — Task Soil / Soil Store 当前阶段契约，明确只读 refs、安全 preview、无真实长期 Soil 写入。
- `.trellis/spec/backend/observation-read-model.md` — Observation Panel / Snapshot / tracking / transcript 安全投影契约。
- `.trellis/spec/backend/tool-runtime.md` — ToolCenter、ResearchRuntime、AgentTurnRuntime、工具事件和工具输出边界。
- `.trellis/spec/backend/quality-guidelines.md` — 当前 build/test/demo/panel/desktop/real AI smoke 验收事实源。

## Caveats / Not Found

- 当前 Trellis active task 查询返回 none；本报告按用户显式要求写入 `Z:\AgentArbor\.trellis\tasks\05-08-project-analysis-optimization\research\goal-alignment.md`。
- 未运行 `pnpm build` / `pnpm test` / panel smoke；本报告只做静态研究。
- 未读取所有 `docs/研究资料/**` 早期研究材料；本任务重点是当前目标、正式文档叙事和实现偏差，已优先读取 README、开发指南、ADR-0022、看板、`.agentarbor`、`.trellis/spec` 和关键代码。
- 代码仓库 Git status 显示大量未提交改动；研究引用的是当前工作树内容，可能包含未提交状态。
