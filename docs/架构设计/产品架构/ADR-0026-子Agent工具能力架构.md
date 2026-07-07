# ADR-0026: 子 Agent 工具能力架构

日期：2026-06

状态：Accepted

承接关系：补充 [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)（双运行时长期架构）、演进 [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)（基础 Agent 工具体系扩展）、与 [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)（deep 一期最小闭环）互补不冲突。本 ADR 是子 Agent（Sub-Agent）作为普通 Agent 工具能力的权威决策，是 `src/app/sub-agents/` 代码实现的契约依据；不引入新的运行时概念，不维护独立任务生命周期。

> 命名口径：遵循 [05-Agent口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)。子 Agent（Sub-Agent）是普通 Agent 会话中的工具能力扩展，不是 deep / Underground 多 Agent 编排；不维护独立任务生命周期，不替换 deep 编排。产品对用户统一显示“子 Agent”或“专家助手”，`sub-agent` / `SubAgent` 保留为内部实现与代码命名。

## 决策

将子 Agent 实现为**普通 Agent 的工具能力**，而非独立编排流程。三个子 Agent 工具（`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`）注册到 `desktop-basic` scope，模型在普通会话中可自主调用，不需要用户显式切换到 deep 模式。

本 ADR 记录九项核心决策：

1. **子 Agent 作为工具**：子 Agent 通过标准工具接口暴露给普通 Agent，模型自主选择调用，不引入新的会话入口或运行模式切换。
2. **定义格式复用 Skill 模式**：子 Agent 定义采用 Markdown + YAML frontmatter，与 Skill 定义格式一致，降低用户学习成本。
3. **三级发现**：`builtin / user / project` 三级发现，与 Skill 发现机制一致。
4. **stub + 动态注册运行时集成**：capability snapshot 阶段注册 stub 工具定义，运行时由 `ToolExecutionBroker` 注入真实 executor。
5. **一层约束**：子 Agent 不能递归派生子 Agent，只有顶层 Agent 拥有 `spawn_sub_agent`。
6. **复用基础设施**：子 Agent 执行复用 `IntelligenceChannel` / `ToolExecutionBroker` / `ToolCenter` / 确认机制，不另起平行运行时。
7. **当前工具权限策略**：子 Agent 以父 run 当前 `allowedTools` 为上限；若 `SUB_AGENT.md` 的 `allowed-tools` 或 `spawn_sub_agent.allowed_tools` 声明了更窄工具集，则实际工具集合为父 run 权限与声明集合的交集，并始终强制排除 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output`，避免递归派生、跨子 Agent 读取和权限扩张。
8. **确认冒泡**：子 Agent 内部工具触发确认时，不包装成失败摘要，而是作为父 run 的 pending confirmation 进入既有确认流程；用户可见、可批准、可拒绝或补充指引。
9. **运行视图与本地 trace**：普通 Agent read model 以 `subAgentRuns` 作为子 Agent UI 的唯一数据源；运行时保存模型可见消息、模型输出、工具事实和失败信息到本地 `sub-agent-runs.jsonl`，用于只读复盘，不保存 provider 原始 HTTP 响应。

## 动机

ADR-0022 定义了双运行时架构（普通 Agent + deep / Underground），ADR-0024 确立了基础设施优先路线，ADR-0025 定义了 deep 一期一层 child 最小闭环。但在实际开发中发现，很多场景需要的不是完整的 deep 编排流程，而是**轻量级的专家助手能力**：

- deep 架构（`DeepRuntime` / `DeepTaskBoard` / child / rootlet 派生 / Plan 交接 / run tree 综合）对普通用户来说过于沉重；它要求显式入口、manager 决策循环、task board 调度、parent synthesis 与 `SynthesizedConclusion` 产物，适合需要多路探索并由父层综合的复杂任务。
- 用户更需要的是：模型在普通会话中能**自主调用专家助手**完成特定子任务（例如代码审查、测试生成、文档整理），不需要显式切换到 deep 模式，也不需要维护一个完整的 run tree。
- 子 Agent 工具化能复用普通 Agent 已成熟的工具体系（`ToolCenter` / `Confirmation Gate` / `ToolExecutionBroker` / capability snapshot），不引入新的运行时概念，与 ADR-0024 的“基础设施优先、不另起平行运行时”口径一致。

经评估，子 Agent 工具能力与 deep 编排是**互补**关系而非替代：简单场景用子 Agent 工具，复杂场景仍可走 deep 编排。本 ADR 把子 Agent 工具化决策固化为正式架构事实，避免后续把工具化子 Agent 误并入 deep 编排或反向污染 deep 运行时边界。

## 关键决策

### 决策一：子 Agent 作为工具（注册到 desktop-basic scope）

- 子 Agent 通过三个标准工具暴露给普通 Agent，注册到 `desktop-basic` scope：
  - `call_sub_agent`：同步调用单个子 Agent，等待其返回结果后继续主流程。
  - `call_sub_agents`：调用多个子 Agent，聚合已完成结果；遇到内部工具确认时暂停父 run。
  - `spawn_sub_agent`：派生一次性子 Agent 执行任务，完成或遇到确认后把结果交回父层模型。
- 三个工具均通过 `ToolCenter` 注册与发现，模型在普通会话中按工具契约自主选择调用，**不需要用户显式切换模式**，也不存在自动升级到 deep 的路径。
- 子 Agent 工具调用经共享 `Confirmation Gate`，沿用普通 Agent 的工具边界与确认语义；不因“子 Agent”命名而绕过确认或扩权。
- 当前实现中，子 Agent 内部工具事件复用父 run 的事件发布通道；内部工具的 `tool.requested`、`tool.completed`、`tool.failed`、`user_approval.requested` 均进入父 run 事件流。

### 决策二：定义格式复用 Skill 模式（Markdown + YAML frontmatter）

- 子 Agent 定义采用 **Markdown + YAML frontmatter** 格式，与 Skill 定义格式一致：frontmatter 承载结构化元数据（名称、描述、角色、可选工具集、可选预算），正文承载子 Agent 的指令与行为说明。
- 复用 Skill 模式的目的不是把子 Agent 等同于 Skill，而是**降低用户学习成本**：用户已经熟悉 Skill 的 Markdown + frontmatter 定义方式，子 Agent 沿用同一格式即可在项目或用户目录中自定义专家助手，不需要学习第二套定义语言。
- 子 Agent 与 Skill 的职责边界仍然区分：Skill 是“能力片段”，子 Agent 是“带自身模型-工具循环的专家助手”；格式复用不等于语义合并。

### 决策三：三级发现（builtin / user / project）

- 子 Agent 定义来源分为三级，与 Skill 发现机制一致：
  - `builtin`：随产品内置分发的子 Agent 定义。
  - `user`：用户全局目录下的自定义子 Agent 定义。
  - `project`：当前工作区项目目录下的子 Agent 定义。
- 三级发现的优先级、合并与覆盖规则沿用 Skill 发现口径；`SubAgentSourceKind` 在类型层显式区分来源，capability snapshot 据此向模型投影可用子 Agent 清单。
- 发现机制不引入新的目录约定或第二套扫描路径，复用 Skill 已建立的目录职责与忽略规则。

### 决策四：stub + 动态注册运行时集成

- 子 Agent 工具采用 **stub + 动态注册**的运行时集成模式：
  - **capability snapshot 阶段**：`CapabilityCenter` 在生成快照时注册子 Agent 工具的 **stub 定义**（工具名、描述、参数 schema），使模型在会话开始时即可看到可用子 Agent 工具并按需选择。
  - **运行时阶段**：`ToolExecutionBroker` 通过可选的 `register` 方法注入真实 executor，把工具调用路由到 `SubAgentRunner` 执行真实的模型-工具-模型循环。
- 该模式使 capability snapshot 与运行时执行解耦：snapshot 阶段不需要加载全部子 Agent 定义正文，运行时才按需解析与执行；既保证模型可见性，又避免快照阶段过重。
- `ToolExecutionBroker` 接口的 `register` 方法为**可选**扩展，不破坏既有 broker 契约；未注册 executor 时子 Agent 工具调用按标准失败语义返回，不静默吞掉。

### 决策五：一层约束（不可递归派生）

- 子 Agent **不能递归派生子 Agent**：只有顶层普通 Agent 拥有 `spawn_sub_agent`，子 Agent 自身的工具集不包含 `spawn_sub_agent`。
- 一层硬约束由确定性校验在子 Agent 工具集装配阶段强制：子 Agent 的可用工具集在派生时排除 `call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`，递归派生在执行前被拒绝。
- 该约束与 ADR-0025 的“强制一层 child（`depth = 1`）”口径一致：无论是 deep 编排还是子 Agent 工具，当前阶段都不允许形成多层递归 Agent Fabric；多层递归属长期范围，不在本期。

### 决策六：当前工具权限在父 run 上限内声明式收敛

- 子 Agent 默认继承父 run 已解析出的 `allowedTools`，但这只是权限上限，不是扩权来源。
- 若 `SUB_AGENT.md` 的 `allowed-tools` 或 `spawn_sub_agent.allowed_tools` 声明了工具集合，runner 必须将其与父 run `allowedTools` 取交集；声明为空或省略时不额外收敛。
- 无论声明如何，`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` / `read_sub_agent_output` 都必须从子 Agent 的工具集合中移除，`policyOverrides` 不能重新打开这些递归或跨子 Agent 读取工具。
- 父 run capability snapshot、ToolCenter executable restriction 与确认门仍是最终上界；子 Agent 不能拿到父 run 不可见或未授权的工具，也不能绕过确认。

### 决策七：子 Agent 工具确认冒泡到父 run

- 子 Agent 内部调用高影响工具时仍走共享 `ToolCenter` 与 `Confirmation Gate`。
- 若内部工具返回 `approval_required`，`SubAgentRunner` 返回携带 `pendingApproval` 的 `approval_required` 结果；`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent` executor 把该 pending approval 转换成父工具调用的 `ToolCallResult.status = "approval_required"`。
- 父 run 因而进入既有 `confirmation_needed` 流程，确认卡展示内部工具的标题、影响资源和确认 id；approve 后恢复同一个子 Agent pending turn，deny/guidance 走父 run 现有确认决策路径。
- `call_sub_agents` 当前采用确认安全优先的保守调度：任一子 Agent 触发确认时停止后续未启动任务，已完成结果保留在事件流，父 run 等待该确认。

### 决策八：复用基础设施（不另起平行运行时）

- 子 Agent 执行**复用**普通 Agent 已成熟的共享设施，不另起平行运行时：
  - `IntelligenceChannel`：子 Agent 经此接入 provider，不直接绑定外部 LLM SDK（遵循 `AGENTS.md` 模型接入层独立模块演进边界）。
  - `ToolExecutionBroker`：子 Agent 工具调用经同一套执行入口路由。
  - `ToolCenter`：子 Agent 使用的工具经同一套工具注册与发现机制。
  - `Confirmation Gate`：子 Agent 工具调用沿用普通 Agent 的确认语义与边界。
  - `capabilitySnapshot` 冻结机制：子 Agent 工具清单纳入同一快照口径。
- 子 Agent 不维护独立任务生命周期、独立 task board 或独立 run tree；其执行事实作为普通 Agent 会话的工具调用记录沉淀，不写入 deep 的 `AgentRunTree` 或 `DeepTaskBoard`。

### 决策九：运行视图与本地 trace 持久化

- 子 Agent 拥有普通 Agent 内的专门运行视图，但它仍是普通 Agent 工具能力，不升级为 deep / Underground 运行树。
- read model 新增 `subAgentRuns`，作为 UI 展示子 Agent 内联卡片、批次卡片和右侧详情抽屉的唯一数据源；前端不从散落的 `tool.*` / `model.*` 事件中猜测归属。
- `SubAgentRunner` 为每个子运行生成 `SubAgentRunTrace`，显式记录父 run id、父工具调用 `toolCallId`、`subRunId`、`batchId` / `batchIndex`、任务、上下文、状态、耗时、模型轮次、内部工具事实和摘要。
- trace 记录的是 Agent 可复盘的调试投影：模型 request messages、模型 response 文本 / 工具请求 / 失败类型 / usage，以及工具 name、input、status、duration、确认和现有 display / envelope / errorFacts。它不保存底层 provider 原始 HTTP JSON，也不额外保存命令 stdout/stderr 全量；长输出仍通过既有 logRef / logPath 查看。
- RuntimeDatabase 持久化 `sub-agent-runs.jsonl`，历史 run 恢复时继续展示子 Agent 详情；老 run 没有该文件时只显示原有普通工具节点。
- 第一版运行视图只读，不提供重试、续跑、取消或子 Agent 生命周期控制。子 Agent 内部工具确认仍展示为父 run 既有确认卡，详情视图只标注其等待父 run 确认。

## 与 ADR-0025 的关系

- **ADR-0025 定义的是 deep 一期最小闭环**（Manager + child 编排流程）：显式 `/api/deep/*` 入口、`DeepRuntime` 编排策略边界、`DeepTaskBoard` 调度、`SynthesizedConclusion` / `DeepExplorationReport` 产物、完整 run tree 与 parent synthesis。
- **本 ADR 定义的是子 Agent 工具能力**（普通 Agent 的工具扩展）：注册到 `desktop-basic` scope、模型在普通会话中自主调用、不维护独立任务生命周期。
- **两者不冲突**：
  - 子 Agent 工具服务于**普通 Agent 会话**，deep 编排服务于**显式多 Agent 入口**。
  - 子 Agent 工具不维护独立任务生命周期，deep 编排维护完整的 run tree。
  - 子 Agent 工具的调用记录沉淀为普通会话工具调用事实，不写入 deep 的 `DeepTaskBoard` 或 `AgentRunTree`；deep 编排也不读取子 Agent 工具的调用记录。
- **一层约束同源**：本 ADR 的“子 Agent 不可递归派生”与 ADR-0025 的“强制一层 child（`depth = 1`）”同属当前阶段不允许多层递归 Agent Fabric 的口径，两个 ADR 在该约束上保持一致。
- **不互为前提**：子 Agent 工具能力不依赖 deep 运行时存在，deep 运行时也不依赖子 Agent 工具存在；两者独立演进，仅在“一层约束”口径上对齐。

## 复用边界（复用而非另起）

子 Agent 工具能力通过契约使用以下共享设施，不复制其实现：

- `IntelligenceChannel` / 模型运行时：子 Agent 经此接入 provider，不直接绑定外部 LLM SDK。
- `ToolExecutionBroker`：通过可选 `register` 方法注入子 Agent executor，不新建第二套执行入口。
- `ToolCenter`：子 Agent 工具与子 Agent 内部使用的工具均经同一套注册与发现机制。
- `Confirmation Gate`：子 Agent 工具调用沿用普通 Agent 确认语义，不另建确认门。
- `CapabilityCenter`：`subAgentCatalog` 作为 capability snapshot 的子投影，复用同一快照口径，不另建快照实现。
- `RunEvent` 安全投影口径：子 Agent 执行事实按同一安全口径投影，不另建投影实现；不以“安全投影”“脱敏”为名削弱模型继续工作所需的材料。
- `RuntimeDatabase` 本地 trace 投影：`sub-agent-runs.jsonl` 只保存模型可见 I/O 与工具事实投影，用于刷新、重启后的只读复盘，不替代 provider 诊断日志。

## 范围与排除项

本期明确**包含**：

- 三个子 Agent 工具（`call_sub_agent` / `call_sub_agents` / `spawn_sub_agent`）注册到 `desktop-basic` scope。
- Markdown + YAML frontmatter 定义格式与 `builtin / user / project` 三级发现。
- stub + 动态注册运行时集成模式。
- 一层约束（子 Agent 不可递归派生）。
- 子 Agent 执行复用 `IntelligenceChannel` / `ToolExecutionBroker` / `ToolCenter` / 确认机制。
- 子 Agent 内部工具权限在父 run `allowedTools` 上限内按声明式交集收敛，同时强制排除递归派生和跨子 Agent 读取工具。
- 子 Agent 内部工具确认冒泡为父 run pending confirmation。
- 子 Agent 运行视图、`subAgentRuns` read model 与本地 `sub-agent-runs.jsonl` trace 持久化。

本期明确**不包含**（Out of Scope）：

- 多层递归子 Agent（子 Agent 派生子 Agent）。
- 子 Agent 独立任务生命周期、独立 task board 或独立 run tree。
- 子 Agent 工具与 deep 编排的自动互转或自动升级。
- 子 Agent 运行视图中的重试、续跑、取消或独立生命周期控制。
- Plan / Plan Package / DirectionHandoffPackage / Fruits / Governance Pipeline / Global Soil 回流。
- 子 Agent 定义的正向 / 逆向迁移到 Skill 或反向合并。

## 后果

- 子 Agent 工具能力以“普通 Agent 工具扩展”为权威实现口径，`src/app/sub-agents/` 全部代码以本 ADR 为契约依据。
- 架构影响：
  - 新增 `src/app/sub-agents/` 模块作为子 Agent 工具能力的功能闭环所有者（工具定义、加载、注册、运行、事件、校验）。
  - `CapabilityCenter` 扩展 `subAgentCatalog` 子投影，纳入 capability snapshot。
  - `ToolExecutionBroker` 接口新增**可选** `register` 方法，用于运行时注入子 Agent executor；不破坏既有 broker 契约。
  - 构建流程新增 `copy:sub-agents` 步骤（`scripts/copy-sub-agent-assets.mjs`），把 builtin Markdown 资源复制到 `dist`，保证 builtin 子 Agent 定义在产物中可用。
  - RuntimeDatabase 新增 `sub-agent-runs.jsonl` 本地持久化文件；Panel read model 新增 `subAgentRuns`，前端据此渲染内联卡片和详情抽屉。
- 与 deep 架构互补：简单场景用子 Agent 工具，复杂场景仍可走 deep 编排；两者独立演进，不互为前提。
- ADR-0025 不受影响：deep 一期最小闭环口径不变；子 Agent 工具不写入 deep 的 `DeepTaskBoard` / `AgentRunTree`，不污染 deep 运行时边界。
- ADR-0024 不受影响：基础 Agent 路线继续作为默认主线；子 Agent 工具是基础 Agent 工具体系的扩展，不引入新的运行模式或默认入口切换。

## 相关文档

- [CURRENT_RUNTIME_MODE](../../../CURRENT_RUNTIME_MODE.md)
- [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md)
- [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0020-智能通道与模型接入边界](ADR-0020-智能通道与模型接入边界.md)
- [Agent 口径与命名](../../开发指南/01-基础/05-Agent口径与命名.md)
