# Research: AgentArbor 项目综合概览

- **Query**: Explore the AgentArbor project comprehensively: structure, architecture, aboveground vs underground, implementation state, active tasks
- **Scope**: internal
- **Date**: 2026-05-02

---

## 1. 项目定位

AgentArbor 是**目标驱动的 Agent / AgentApp 孕育与演化平台**。不是聊天机器人、提示词集合、外部平台配置仓库或一次性脚手架。

核心设计哲学：
- 本地优先（local-first）是底座
- AgentApp 是从目标、能力、工作流、验证和工程目录共同形成的可运行单元
- 所有交付必须完整、清楚、可继承

---

## 2. 根目录结构

```
Z:/AgentArbor/
  AGENTS.md            # AI 开发者行为规则（根规则、协作规则、目录边界等）
  README.md            # 项目入口文档
  package.json         # pnpm + TypeScript 项目
  tsconfig.json        # TypeScript 配置
  pnpm-lock.yaml
  docs/                # 人类可读正式文档（开发指南、架构设计、任务看板、研究资料）
  src/                 # TypeScript 源码（确定性最小运行内核）
  dist/                # 编译输出
  node_modules/
  .trellis/            # AI 开发工作流（任务、规范、脚本）
  .agentarbor/         # 未来运行时方向交接包目录（当前几乎空）
  .agents/             # Agent Skills 兼容层
  .codex/              # Codex 适配
  .opencode/           # OpenCode 适配
  .claude/             # Claude Code 适配
```

---

## 3. 技术栈

- **语言**: TypeScript (ES2022 target, NodeNext module)
- **包管理**: pnpm
- **构建**: tsc
- **测试**: node:test（内建）
- **无外部框架**: 不引入 React/Vue/Express 等，纯自研架构
- **运行时**: 内存版闭环（无数据库、无 LLM、无 UI）

### package.json 关键信息

```json
{
  "name": "agentarbor",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "pnpm build && node --test \"dist/**/*.test.js\"",
    "demo": "pnpm build && node dist/app/demo.js",
    "demo:underground": "pnpm build && node dist/app/underground-demo.js"
  }
}
```

---

## 4. 原生概念树架构（ADR-0018）

这是当前产品架构事实源（2026-05-01 Accepted）。

```
Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil
```

### 各节点职责

| 概念树节点 | 职责 | 主要交付物 |
|---|---|---|
| **Soil（土壤）** | 固定资产与治理土壤 | Capability Asset、治理规则、历史证据、失败模式、长期约束、Path Bias |
| **Underground Center（地下中枢）** | 需求成形、用户确认、约束提取、证据探索、方向综合、养料供给 | 方向判断、约束候选、证据索引、Nutrient Patch |
| **.agentarbor（方向交接包）** | 从地下到地上的方向交接层 | Direction Brief、ConstraintRef、Soil 引用、证据索引、Growth Entry |
| **Aboveground Center（地上中枢）** | 计划化和生长控制 | Growth Plan、Workflow IR、Context Topology、TaskSpec、Verification Plan |
| **Fruits（果实）** | 交付物与候选沉淀 | AgentApp、能力包、Run Memory、Experience Candidate |
| **Governance（治理）** | 治理回流入土 | 晋升、拒绝、退役、版本、权限、谱系 |

### "地上"（Aboveground）vs "地下"（Underground）

**地下中枢**：
- 把用户"想象"（模糊目标、意图）整理为可判断的目标、非目标、约束、风险和验收条件
- 在授权边界不清、目标冲突、关键事实缺失时询问用户
- 读取 Soil 中的历史证据、能力资产、Path Bias
- 形成方向判断，写入 `.agentarbor` 方向交接包
- 响应地上中枢的 Nutrient Request
- **不生成 Growth Plan，不调度地上执行**

**地上中枢**：
- 读取 `.agentarbor` 方向交接包
- 制定 Growth Plan（选择 Path Bias、复用策略、沉淀策略）
- 生成 Workflow IR（工作流中间表示，支持暂停/恢复/分叉/验证）
- 选择运行组织形态（single_agent / sub_agent_tree / shared_team_cluster / competitive_team_cluster）
- 约束分发到任务、工具执行门和验证门
- 组织地上生长节点执行、提交证据
- 形成果实，交给 Governance
- **不绕过方向交接包直接执行，不自建方向探索集群替代地下组织**

---

## 5. 源码结构 (`src/`)

```
src/
  index.ts                              # 顶层导出
  adapters/index.ts                     # 外部适配器入口（当前几乎空）
  kernel/                               # 确定性运行内核
    id.ts                               # ID 生成（createId, nowIso）
    index.ts                            # 导出所有 kernel 模块
    artifacts/in-memory-artifact-store  # 内存版产物存储
    events/in-memory-event-log          # 内存版事件日志
    messages/in-memory-message-bus      # 内存版消息总线
    messages/create-message             # 消息构造器
    registry/in-memory-agent-registry   # 内存版 Agent 注册表
    router/simple-router               # 简单路由器
    state-machine/task-state-machine    # 任务状态机
  domain/                               # 领域模型
    common.ts                           # 核心类型：RuntimeShape, TaskState, AgentLayer, ArborMessage, AgentManifest
    constraints.ts                      # 约束模型：Constraint, ConstraintRef
    contracts.ts                        # 统一导出所有 domain 契约
    index.ts                            # 领域统一入口
    aboveground/                        # 地上中心领域
      contracts.ts                      # GrowthPlan, WorkflowIR, TaskSpec, GrowthPlanRevision 类型
      index.ts
    underground/                        # 地下中心领域
      contracts.ts                      # DirectionHandoff, DirectionOption, NutrientRequest, NutrientPatch 等
      clarification.ts                  # 用户澄清机制
      evidence-ledger.ts               # 证据账本
      candidate-comparison.ts          # 候选比较
      intent-core.ts                   # 意图核心
      radial-growth.ts                 # 辐射生长模型
    agentarbor/                         # 方向交接包领域
      direction-handoff.ts             # DirectionHandoff 逻辑
      direction-handoff-package/       # 方向交接包完整实现
        contracts.ts                   # 契约定义
        schema.ts                      # Schema 定义
        builder.ts                     # 构建器
        validated-package.ts           # 已验证包
        validation.ts                  # 验证逻辑（含多层验证：lineage, convergence, candidate-index, file-boundary, hard-constraint-boundary）
        in-memory-store.ts             # 内存存储
        file-system-store.ts           # 文件系统存储
        serialization.ts               # 序列化
    soil/store.ts                      # 土壤存储
    governance/contracts.ts            # 治理契约
    fruits/contracts.ts                # 果实契约
    observation/                       # 观测层
      contracts.ts, snapshot.ts, event-metadata.ts, event-view.ts, layer-views.ts, phase-stage.ts
    lineage/index.ts                   # 谱系
  app/                                  # 应用层（编排逻辑）
    agents/                            # Agent 实现
      aboveground-planner.ts           # 地上中心规划器
      underground-analyzer.ts          # 地下分析器
      governance-review.ts             # 治理审查
      verifier.ts                      # 验证器
      worker-agent.ts                  # 工作 Agent
      manifests.ts, types.ts
    runtime.ts                         # MinimalRuntime 接口
    minimal-loop.ts                    # 最小闭环（完整端到端 demo）
    minimal-growth-plan.ts            # 最小 GrowthPlan 创建
    minimal-verification.ts           # 最小验证
    minimal-governance.ts             # 最小治理
    underground-runner.ts             # 地下运行器
    underground-candidates.ts         # 地下候选管理
    underground-rootlets.ts           # 地下根系管理
    underground-evidence.ts           # 地下证据管理
    underground-goal-profile.ts       # 地下目标画像
    underground-report.ts             # 地下报告
    underground-demo.ts               # 地下演示
    underground-demo-summary.ts       # 地下演示摘要
    underground-direction-session.ts  # 地下方向会话
    underground-direction-recovery.ts # 地下方向恢复
    direction-handoff-derivation.ts   # 方向交接包派生
    minimal-direction.ts              # 最小方向
    minimal-underground.ts            # 最小地下
    clarification-recovery.ts         # 澄清恢复
    demo.ts                           # 完整演示入口
```

### 关键类型体系

**TaskState**（16 种状态）：Draft -> DirectionReady -> Planning -> Assigned -> Running -> Blocked/NutrientRequested/Revising -> Verifying -> AcceptedForDelivery -> Fruiting -> GovernanceReview -> Delivered/Archived/Cancelled/Failed

**AgentLayer**（8 层）：soil, underground_center, agentarbor_handoff, aboveground_center, aboveground_growth, verification, fruits, governance

**ArborMessageType**（37 种消息类型）：覆盖从 goal.received 到 governance.review.completed 的完整生命周期

**RuntimeShape**：single_agent, sub_agent_tree, shared_team_cluster, competitive_team_cluster, fruit_run

**Constraint** 三级约束：hard（阻断）、soft（记录偏离）、preference（仅影响排序）

---

## 6. 文档结构 (`docs/`)

```
docs/
  README.md                          # 文档入口
  任务看板/                           # 人类态势看板（从 .trellis/tasks/ 派生）
    README.md, 规则.md
  开发指南/                           # 当前稳定开发口径
    00-总览.md                        # 产品主线、当前稳定结论
    01-基础/                          # 愿景、产品定义、非目标、术语表
    02-核心闭环/                      # 目标驱动元循环、智能体孕育、资产生长、方向修正、运行沉淀、路径倾向、土壤治理
    03-系统架构/                      # 系统总览、核心模块、工作台界面、Agent 集群运行结构、植物学语义映射、运行时组织模型
    04-模型与契约/                    # 核心数据模型、工作流中间表示、智能体应用标准目录、最小运行契约、约束工程
    05-智能体生命周期/                # 组织与果实、脱离母体、出生与退役
    06-工程实现/                      # 技术主线、AI与确定性边界、测试验收、文档治理、最小实现边界、阶段验收边界
  架构设计/                           # 长期架构决策
    产品架构/                         # ADR-0011 到 ADR-0019
    协议边界/                         # ADR-0002, ADR-0003, ADR-0010
    工作区结构/                       # ADR-0001, ADR-0004
  研究资料/                           # 工程研究、外部参考、能力资产资料卡
```

---

## 7. .trellis 任务系统

### 所有任务状态

| 任务 | 状态 | 标题 |
|---|---|---|
| `00-bootstrap-guidelines` | completed | Bootstrap Guidelines |
| `04-30-formal-development-guide-integration` | completed | Formal Development Guide Integration |
| `04-30-opencode-compatibility` | completed | Add OpenCode compatibility |
| `05-01-architecture-constraint-engineering-docs` | completed | 全景架构与约束工程文档优化 |
| `05-01-minimal-runtime-kernel` | in_progress | AgentArbor 最小闭环实现 |
| `05-01-seed-root-trunk-boundary` | in_progress | AgentArbor 原生概念树架构文档调整 |
| `05-01-v0-2-1-modular-hardening` | in_progress | V0.2.1 Modular Hardening |
| `05-01-v0-3-underground-observation` | in_progress | V0.3 Underground Center radial growth + observation |
| `05-01-v0-4-observation-kernel-refinement` | in_progress | V0.4 Observation Kernel refinement |
| `05-01-v0-5-underground-user-clarification-escalation` | in_progress | V0.5 Underground user clarification and escalation |
| **`05-02-aboveground-center`** | **planning** | **brainstorm: 实现地上中心** |
| `05-02-clarification-recovery-lineage` | in_progress | 完善澄清恢复与方向包谱系 |
| `05-02-core-module-boundary-cleanup` | in_progress | 清理核心模块边界 |
| `05-02-fix-p1-quality-audit-regressions` | in_progress | Fix P1 quality audit regressions |
| `05-02-underground-minimal-usable-loop` | in_progress | 实现地下组织最小使用闭环 |

**当前活跃任务**: 无（trellis task current 返回 none）

---

## 8. Aboveground Center 任务详情 (`05-02-aboveground-center`)

**状态**: planning（尚未开始实现）
**优先级**: P2
**创建者**: xzf28

### PRD 要点

该任务旨在实现 Aboveground Center 的完整功能，包含：

1. **接收方向交接包** — 从地下中心接收 `.agentarbor` Direction Handoff Package
2. **制定 Growth Plan** — 执行前计划
3. **生成 Workflow IR** — 工作流中间表示
4. **上下文拓扑** — Context Topology
5. **执行组织** — Execution Organization
6. **验证门** — Verification Gates
7. **约束分发** — Constraint Distribution
8. **计划修订** — GrowthPlan Revision
9. **养料请求** — Nutrient Request

### 已有实现

- **AbovegroundPlanner**（`src/app/agents/aboveground-planner.ts`）：已实现基础版
  - 加载 DirectionHandoffPackage
  - 验证 package 有效性（approved 状态、convergenceReviewRef、sourceCandidateRefs）
  - 创建 GrowthPlan、WorkflowIR、TaskSpec
  - 发布 growth_plan.completed、workflow.created、task.created 消息

- **createMinimalGrowthPlanMaterial**（`src/app/minimal-growth-plan.ts`）：
  - 创建最小 GrowthPlan（单任务、单工作流，4 节点链：generate -> verify -> memory -> govern）
  - 包含基本约束分发和验证门

### 地上中心领域类型（`src/domain/aboveground/contracts.ts`）

已定义完整类型契约：
- **GrowthPlan**: id, version, goalId, directionHandoffId/Version, selectedOptionId, pathBiasDecision, workflowId, runtimeShape, tasks, reuseStrategy, sedimentationStrategy, constraintRefs, constraintDistribution, verificationGates, nutrientRequestTriggers
- **WorkflowIR**: 支持 9 种节点类型（clarify, research, design, generate, execute, verify, memory, govern, nutrient_request），含依赖、执行条件、权限、失败处理、暂停/恢复点
- **TaskSpec**: 完整任务规格
- **GrowthPlanRevision**: 计划修订（continue/rollback/branch/stop）

### 待实现

PRD 中列出三个 MVP 选项：
- **选项 A（推荐）**: 完善 GrowthPlan 结构 + Workflow IR（暂停/恢复/分叉/验证）+ 约束分发 + 验证门
- **选项 B**: 完整实现含 Nutrient Request + GrowthPlan Revision + Context Topology + Execution Organization
- **选项 C**: 接口优先，最小实现

### 待回答的开放问题

1. MVP 范围选择（A/B/C）
2. Workflow IR 节点类型范围（保持 4 种 / 扩展 / 完整 9 种）
3. Nutrient Request 触发条件范围

### 测试状态

- 56 个测试全部通过（截至 PRD 编写时）
- implement.jsonl 和 check.jsonl 均为空（尚未开始实现）

---

## 9. 当前实现状态总结

### 已完成

1. **确定性最小运行内核**（Phase 1 基础）：
   - 内存版 EventLog、MessageBus、ArtifactStore、AgentRegistry、Router、TaskStateMachine
   - ID 生成、消息构造

2. **地下中心（Underground Center）** 基础实现：
   - DirectionHandoffPackage 完整验证链（lineage, convergence, candidate-index, file-boundary, hard-constraint-boundary）
   - 辐射生长模型（Radial Growth）
   - 用户澄清与升级机制
   - 证据账本、候选比较
   - 方向会话与恢复

3. **地上中心（Aboveground Center）** 骨架：
   - AbovegroundPlanner 基础版
   - 最小 GrowthPlan 创建
   - 类型契约已完整定义

4. **观测层（Observation）**：
   - 事件元数据、快照、层视图、阶段-阶段映射

5. **约束系统**：
   - Constraint + ConstraintRef 三级模型

### 进行中

- 地下组织最小使用闭环
- 澄清恢复与方向包谱系
- 核心模块边界清理
- P1 质量审计回归修复

### 未开始

- 地上中心完整实现（任务 `05-02-aboveground-center` 仍在 planning 阶段）
- 数据库持久化
- 真实 LLM 集成
- UI/工作台
- 外部 Adapter（A2A, MCP, AG-UI）

---

## Caveats / Not Found

- `docs/开发指南/04-模型与契约/05-方向交接包与GrowthPlan.md` 被 PRD 引用但未在 glob 结果中找到，可能已被移除或重命名
- 无当前活跃的 trellis 任务（`task current` 返回 none）
- `implement.jsonl` 和 `check.jsonl` 为空，说明 `05-02-aboveground-center` 尚未进入实现阶段
- 项目仍处于极早期（v0.1.0），当前 focus 是确定性内核闭环验证

---

## Files Found

| File Path | Description |
|---|---|
| `Z:/AgentArbor/README.md` | 项目入口文档 |
| `Z:/AgentArbor/AGENTS.md` | AI 开发者行为规则 |
| `Z:/AgentArbor/package.json` | 项目配置 |
| `Z:/AgentArbor/tsconfig.json` | TypeScript 配置 |
| `Z:/AgentArbor/docs/开发指南/00-总览.md` | 开发指南总览 |
| `Z:/AgentArbor/docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md` | 核心架构 ADR |
| `Z:/AgentArbor/docs/开发指南/03-系统架构/06-运行时组织模型.md` | 运行时组织模型 |
| `Z:/AgentArbor/src/domain/contracts.ts` | 核心类型定义 |
| `Z:/AgentArbor/src/domain/aboveground/contracts.ts` | 地上中心类型契约 |
| `Z:/AgentArbor/src/domain/underground/contracts.ts` | 地下中心类型契约 |
| `Z:/AgentArbor/src/domain/constraints.ts` | 约束模型 |
| `Z:/AgentArbor/src/domain/common.ts` | 通用类型 |
| `Z:/AgentArbor/src/app/agents/aboveground-planner.ts` | 地上中心规划器（现有） |
| `Z:/AgentArbor/src/app/minimal-growth-plan.ts` | 最小 GrowthPlan 创建（现有） |
| `Z:/AgentArbor/.trellis/tasks/05-02-aboveground-center/prd.md` | 地上中心任务 PRD |
| `Z:/AgentArbor/.trellis/tasks/05-02-aboveground-center/task.json` | 任务元数据 |
| `Z:/AgentArbor/.trellis/config.yaml` | Trellis 配置 |
