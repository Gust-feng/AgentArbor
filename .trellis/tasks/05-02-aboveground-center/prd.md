# brainstorm: 实现地上中心

## Goal

实现 Aboveground Center 的完整功能，使 AgentArbor 能够：
1. 接收地下中心产出的 `.agentarbor` Direction Handoff Package
2. 制定 Growth Plan（执行前计划）
3. 生成 Workflow IR（工作流中间表示）
4. 建立上下文拓扑（Context Topology）
5. 管理执行组织（Execution Organization）
6. 设置验证门（Verification Gates）
7. 支持约束分发（Constraint Distribution）
8. 支持 GrowthPlan Revision（计划修订）
9. 支持 Nutrient Request（养料请求）

## What I already know

### 已实现的地上中心功能
- `AbovegroundPlanner` 类（`src/app/agents/aboveground-planner.ts`）：
  - 加载 DirectionHandoffPackage
  - 验证 package 有效性
  - 创建 GrowthPlan、WorkflowIR、TaskSpec
  - 发布 `growth_plan.completed`、`workflow.created`、`task.created` 消息

- `createMinimalGrowthPlanMaterial`（`src/app/minimal-growth-plan.ts`）：
  - 创建最小的 GrowthPlan（单任务、单工作流）
  - 包含基本的约束分发和验证门

- DirectionHandoffPackage 验证：
  - 必须是 `approved` 状态
  - 必须有 `convergenceReviewRef`
  - 必须有 `sourceCandidateRefs`
  - 不能内联 Soil 资产

### 需要实现的地上中心功能
根据文档 `docs/开发指南/04-模型与契约/05-方向交接包与GrowthPlan.md`：

1. **GrowthPlan 完整实现**：
   - `selectedDirection`：地上中枢选定方向
   - `pathBiasDecision`：采用、调整、拒绝或无可用 Path Bias
   - `runtimeShape`：运行组织形态
   - `reuseStrategy`：资产复用策略
   - `sedimentationStrategy`：Run Memory、Experience Candidate 和 Capability Asset 的沉淀策略
   - `constraintDistribution`：约束如何分发到任务、工具执行门和验证门
   - `verificationGates`：验证和验收门
   - `nutrientRequestTriggers`：允许向地下中枢请求养料的触发点

2. **Workflow IR 完整实现**：
   - 支持暂停、恢复、分叉和验证
   - 节点类型：generate、verify、memory、govern
   - 依赖关系
   - 执行条件
   - 失败处理

3. **GrowthPlan Revision**：
   - 来源 GrowthPlan 版本
   - 新 Direction Handoff 版本、Nutrient Patch 或无需补充证据
   - 修订原因
   - 影响范围
   - 继续、回退、分叉或停止决策
   - Workflow IR 变化

4. **Nutrient Request**：
   - 触发条件
   - 请求消息结构
   - 响应处理
   - GrowthPlan 修订

5. **约束分发**：
   - hard constraint 阻断或要求确认
   - soft constraint 记录偏离
   - preference 只能影响方案排序

## Assumptions (temporary)

- 第一阶段使用内存实现，不引入数据库
- 不实现完整的 Context Topology（上下文拓扑）
- 不实现完整的 Execution Organization（执行组织）
- 保留 Nutrient Request 接口但最小 demo 可以不触发
- 保留 GrowthPlan Revision 接口但最小 demo 可以不触发

## Open Questions

### 1. MVP 范围选择（Blocking）

根据文档，地上中心需要实现以下功能。请选择 MVP 范围：

**选项 A：最小可行产品（推荐）**
- 完善 GrowthPlan 结构（所有必填字段）
- 完善 Workflow IR 结构（支持暂停、恢复、分叉和验证）
- 实现约束分发（按任务分发约束）
- 实现验证门（支持 hard/soft/preference 约束验证）
- 保留 Nutrient Request / GrowthPlan Revision 接口（但最小 demo 不触发）

**选项 B：完整实现**
- 选项 A 的所有内容
- 实现 Nutrient Request 完整流程
- 实现 GrowthPlan Revision 完整流程
- 实现上下文拓扑（Context Topology）
- 实现执行组织（Execution Organization）
- 支持多运行形态（single_agent、multi_agent、pipeline、parallel）

**选项 C：接口优先**
- 只定义完整的类型契约（接口）
- 实现最小的内存版本
- 为未来扩展保留接口

### 2. Workflow IR 节点类型扩展（Preference）

当前节点类型：`generate`、`verify`、`memory`、`govern`

文档建议增加：`clarify`、`research`、`design`、`execute`、`nutrient_request`

**选项 A：保持最小（推荐）**
- 只使用当前 4 种节点类型
- 足够覆盖第一阶段需求

**选项 B：扩展节点类型**
- 增加 `research`、`design`、`execute` 节点类型
- 支持更复杂的工作流

**选项 C：完整节点类型**
- 实现文档中所有 9 种节点类型
- 支持最灵活的工作流定义

### 3. Nutrient Request 触发条件（Preference）

当前保留：`verification_failed`、`nutrient_gap`

**选项 A：保持最小（推荐）**
- 只支持 `verification_failed`、`nutrient_gap`
- 足够覆盖第一阶段需求

**选项 B：扩展触发条件**
- 增加 `constraint_conflict`、`evidence_insufficient`
- 支持更复杂的场景

**选项 C：完整触发条件**
- 实现文档中所有触发条件
- 支持最完整的养料请求流程

## Requirements (evolving)

### 核心需求
1. **GrowthPlan 完整结构**：实现文档中定义的所有字段
2. **Workflow IR 完整结构**：支持暂停、恢复、分叉和验证
3. **GrowthPlan Revision**：支持计划修订的完整流程
4. **Nutrient Request**：支持养料请求的触发和处理
5. **约束分发**：支持按任务分发约束

### 扩展需求
1. **多运行形态**：支持 `single_agent`、`multi_agent`、`pipeline`、`parallel`
2. **Workflow 节点类型扩展**：支持更多节点类型
3. **约束冲突处理**：支持约束冲突的检测和处理

## Acceptance Criteria (evolving)

- [ ] GrowthPlan 包含所有必填字段
- [ ] Workflow IR 支持暂停、恢复、分叉和验证
- [ ] GrowthPlan Revision 能正确修订计划
- [ ] Nutrient Request 能正确触发和处理
- [ ] 约束分发能正确应用到任务
- [ ] hard constraint 能阻断或要求确认
- [ ] soft constraint 能记录偏离
- [ ] preference 只能影响方案排序
- [ ] 所有现有测试通过
- [ ] 新增测试覆盖新功能

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated if behavior changes
- Rollout/rollback considered if risky

## Out of Scope (explicit)

- A2A Adapter
- MCP Adapter
- AG-UI Adapter
- 完整模型调用
- 完整插件市场
- 企业多租户
- 大规模 agent 自治网络
- 完全自动自我修改
- 无人值守高风险命令执行
- 数据库持久化
- 复杂可视化编排器

## Technical Notes

### 关键文件
- `src/app/agents/aboveground-planner.ts` - 现有 AbovegroundPlanner 实现
- `src/app/minimal-growth-plan.ts` - 现有最小 GrowthPlan 实现
- `src/domain/contracts.ts` - 核心类型定义
- `src/app/minimal-loop.ts` - 最小循环测试
- `docs/开发指南/04-模型与契约/05-方向交接包与GrowthPlan.md` - GrowthPlan 契约
- `docs/开发指南/04-模型与契约/02-工作流中间表示.md` - Workflow IR 契约
- `docs/开发指南/06-工程实现/06-最小实现边界.md` - 最小实现边界

### 现有测试
- 56 个测试全部通过
- 需要确保新功能不破坏现有测试

### 约束
- 第一阶段使用内存实现
- 不引入新的包管理器、构建系统、运行时代码框架或测试框架
- 实现以 TypeScript 自研架构为主
- 外部模型、工具、协议和平台通过 adapter 接入，不能反向污染核心领域模型
