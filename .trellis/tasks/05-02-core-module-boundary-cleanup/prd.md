# refactor: 清理核心模块边界

## Goal

清理第一阶段核心模块边界，降低核心域、观测与内核之间的反向依赖和测试耦合风险，同时保持现有最小闭环 happy path 与 clarification-required 路径行为不变。

## Requirements

* 保留 `src/domain/contracts.ts` 作为兼容 barrel。
* focused domain、observation、kernel 模块不得再从 `src/domain/contracts.ts` 反向导入。
* observation 相关类型导入改为 focused modules，例如 `common`、`aboveground/contracts`、`agentarbor/direction-handoff-package/contracts`、`fruits/contracts`、`governance/contracts`、`underground` 或其他真实 focused module。
* `src/kernel/messages/in-memory-message-bus.test.ts` 直接构造 `InMemoryEventLog` 与 `InMemoryMessageBus`，不再依赖 `src/app/**` fixture。
* `src/kernel/state-machine/task-state-machine.test.ts` 使用本地最小 `DirectionHandoff`、`GrowthPlan`、`TaskSpec`、`Constraint` fixture，不再 import `runMinimalLoop`。
* 新增 observation 事件元数据集中模块，作为 `summary`、`scope`、`severity`、`progress`、`phase`、`stage` 的单一来源。
* `event-view.ts` 和 `phase-stage.ts` 必须从同一个事件元数据模块读取。
* 测试覆盖每个 `ArborMessageType` 都有 metadata，并证明 event view 与 phase/stage 使用同一来源。
* 抽出 app 层地下运行 helper，复用 rootlet 启动、候选池、收束报告、事件发布流程，避免 `UndergroundAnalyzer` 和 `clarification-flow` 继续复制地下流程。
* 保持现有 happy path 18-step 与 clarification-required 路径行为不变。

## Acceptance Criteria

* [ ] `pnpm build` 通过。
* [ ] `pnpm test` 通过。
* [ ] `git diff --check` 通过。
* [ ] `rg 'from "\.\./contracts|from "\.\./\.\./domain/contracts|domain/contracts' src/domain src/kernel` 只剩兼容 barrel 或允许的 app 层使用。
* [ ] `rg 'from "\.\./\.\./app|from "\.\./app|from "../../app|from "../app|app/' src/kernel src/domain` 不显示 kernel/domain 到 app 的导入。

## Definition of Done

* 变更范围仅限第一阶段结构质量清理。
* 不提交、不暂存、不重置、不回退用户改动。
* 不新增 UI、HTTP、SSE、WebSocket、数据库、真实 LLM、MCP、A2A、AG-UI adapter。
* 不写 repo-root `.agentarbor/` 运行资产。
* 不实现用户澄清恢复、package lineage、`user_approval.received` 业务流。
* 不新增根目录 `Plan/` 或 `Plans/`。

## Technical Approach

* 先建立导入影响图，定位 observation metadata、kernel tests、地下 app flow 的现有重复点。
* 将观测事件展示字段收敛到单一 metadata 模块，保留原有外部 API 行为。
* 通过 app 层 helper 合并 UndergroundAnalyzer 与 clarification-flow 的地下流程共同步骤，避免向 domain/kernel 下沉 app 依赖。
* 用现有测试证明行为不变，并新增 focused regression 测试覆盖 metadata 完整性与单一来源。

## Out of Scope

* 第二阶段澄清恢复谱系。
* package lineage。
* `user_approval.received` 业务流。
* 新 adapter、持久化、网络接口或真实模型集成。
* `.agentarbor/` 运行资产初始化。

## Technical Notes

* 用户明确要求工作区初始应干净，且本任务不能提交、暂存、重置或回退用户改动。
* 任务标题与提交范围口径：`refactor: 清理核心模块边界`。
