# 默认 Agent 后续开发流程

## 目标

后续开发沿统一 Workbench 主线推进：Ordinary Agent 是默认工作方式，Multi-Agent 是显式功能，Sub-Agent 是 Ordinary 的 Pi AgentTool。Ordinary 与 Multi-Agent 共享中性模型、工具、确认、上下文算法和系统 adapter，不共享业务状态、事件、仓储或 read-model；Sub-Agent 调用事实进入父 Ordinary run。

每轮开发先回答：

1. 变更由哪个 feature 或中性能力拥有？
2. 是否只通过公开 command/query/event facade 或中性端口调用？
3. 是否创建了第二个组合根、service locator、全局业务状态或通用 Run 抽象？
4. 同一个执行事实是否被 route、runtime、event、read-model 或 UI 重复加工？
5. 是否保持模型正文、工具输出、错误和 continuation 完整可用？
6. 是否有行为测试与依赖测试证明边界？

## 当前默认行为

- 启动和普通提交默认走 Ordinary Agent。
- Multi-Agent 只能由用户显式选择，不根据关键词、长度、文件数或模型判断自动升级。
- Sub-Agent 由 Ordinary 模型按工具契约自主调用，不要求用户切换模式。
- 当前 Multi-Agent 的设置 beta 开关和侧栏 `Agent 集群` 入口暂时隐藏，后端仍使用 `/api/deep/*`、内部 surface 和独立数据分区；这是待收口实现，不能把入口隐藏写成已经迁移完成。

## 开发顺序

### 1. 事实源与架构依赖门

- ADR-0028 与《功能模块边界与组合根》是当前事实源。
- 约束 neutral capability 不依赖 feature。
- 约束 Multi-Agent 不依赖 Ordinary/Desktop 实现。
- 约束 feature 不依赖 Panel。
- 约束只有 Composition Root 能装配多个 feature。
- 先补 Ordinary、Sub-Agent 与 Deep 行为测试，再移除只锁定 legacy facade、文件名或源码字符串的测试。

验收：依赖越界能被测试稳定阻止，现有三条行为基线不变。

### 2. 唯一后端 Composition Root

- `createPanelRuntime()` 装配 `OrdinaryAgentFeature` 与 `MultiAgentFeature`；Ordinary route 只调用 feature 的 command/query/event facade，不再持有 run job、conversation store 或恢复投影。
- Multi-Agent factory 拥有 Deep store、control/continuation registry、instruction queue、active run tracking 和资源释放。
- `/api/deep/*` route 只解析 HTTP、调用 feature facade、映射响应。
- route 不得创建 `MinimalRuntime`、store、provider 或 ToolCenter 工厂，也不得以 `WeakMap` 保存 feature 状态。
- Deep DTO、API、SSE、存储格式和 manager/TaskBoard/scheduler/child/synthesis 行为保持不变。

验收：Deep route 薄适配测试、共享资源释放测试与正式 Deep smoke 通过。

### 3. 共享能力中性化

- `model-runtime` 只创建 provider/channel 与协议能力，不创建 ToolCenter、Desktop Skill 或 feature registry。
- ToolCenter 工厂归工具能力模块；Host 向 ToolCenter 装配文件、命令、浏览器、HTTP、研究、MCP 与 Skills 资源工具，并向 Ordinary Agent Session loop 装配 Sub-Agent AgentTool。
- Ordinary 使用中性的 `AgentLoop` 端口，生产实现由 Pi AgentHarness/Session adapter 提供；Multi-Agent 仍可使用自己的运行端口，两者不共享业务状态或完成语义。
- Deep 只共享 tokenizer、消息完整性和压缩执行等机械能力，不依赖 Ordinary compaction facade。
- 拆除 `MinimalRuntime` service locator，改为精确依赖注入；不新建 `RuntimeServices` 属性包。

验收：共享模块不包含 feature import，Ordinary 与 Deep 行为测试不变。

### 4. Workbench 入口收口

- 前端拆分 shell/config、ordinary surface、multi-agent surface 状态。
- Ordinary 与 Multi-Agent 分别拥有 controller、SSE/poll cursor、busy、confirmation 和 view projection。
- 用 `ActiveWorkbenchSurface` 判别联合导航，用 `WorkbenchItemSummary` 判别联合按更新时间展示历史。
- 底层 conversation/store 继续分离，不新增 `/api/work`、`WorkAggregate` 或统一 Run API。
- 移除持久化全局 AgentMode 与独立侧栏入口；beta 开关只控制输入区单次“深入协作”动作是否可用。

验收：默认提交走 Ordinary；深入协作只影响本次提交；切换 surface 后旧 SSE/poll 回调不能污染当前视图。

### 5. Legacy 退役

- 已删除 `/api/underground/*`、旧 root exports、demo、BasicAgent/Desktop/Panel 旧执行链、应用层 Underground 与未被正式路径使用的旧实现。
- Ordinary 持久化已归 feature-owned repository，旧 RuntimeDatabase 与旧 snapshot 不兼容读取。
- Sub-Agent 已切换到 Pi AgentTool，旧 runner、事件、trace、批量与专用续读能力已退役。
- Deep 仍需要的 `domain/underground/agent-fabric` run-tree 契约保持有效；后续只做 Multi-Agent owner 内部归位。
- 不提前抽象通用 blob/journal/repository；出现两个稳定消费者后再提取。

验收：legacy 删除有行为测试替代，正式入口和本地有效数据不被误删。

## Ordinary 纵向开发顺序

普通 Agent 新功能必须覆盖完整 slice：

1. 输入/输出契约与 AgentDefinition/capability snapshot。
2. canonical 模型消息、工具调用/结果配对与模型输入顺序。
3. 工具执行、确认、取消和 continuation。
4. Ordinary event 与业务 outcome。
5. repository 与后端 read-model。
6. Panel Ordinary surface 投影。
7. 行为测试、依赖测试和必要文档。

不能只修改 prompt、route 或 UI 文案来伪造一个完整能力。

## Multi-Agent 纵向开发顺序

Multi-Agent 新功能必须留在自身闭环：

1. Deep command/query/event 契约。
2. manager/TaskBoard/scheduler/child/synthesis 业务状态。
3. Deep store 与恢复。
4. `/api/deep/*` 薄适配。
5. Multi-Agent surface read-model 与交互。
6. child 调度、纠正、停止、综合和历史恢复测试。

不能为了复用而调用 Ordinary store、conversation reducer 或完成语义。

## Sub-Agent 纵向开发顺序

- 父 run 权限始终是上限。
- nested Agent 工具集合强制排除全部 Sub-Agent AgentTool。
- 确认冒泡到父 Ordinary run，不能包装成普通失败。
- 完整输出、工具事实和错误直接回到父模型，不建设专用续读状态。
- 不新增 Sub-Agent runner、事件、trace、持久化或 read-model。

## 状态和事件规则

- 一个 feature 只消费自己的业务 event。
- 技术结果在调用 feature 边界映射一次 outcome。
- `ToolCallResult` 是工具执行唯一事实，模型、事件和 UI 单向派生。
- SSE 是通知或事件传输，不是前端业务状态事实源。
- read-model 不写回业务状态，UI summary 不覆盖正式材料。

## 质量门

每阶段按影响面运行目标测试。阶段门至少完成：

```text
pnpm build:node
pnpm typecheck:panel
pnpm build:panel
git diff --check
```

最终收口运行 `pnpm test`。核心回归包括：

- Ordinary：完成、确认、取消、失败、恢复。
- Sub-Agent：权限继承、禁止递归、完整输出、确认冒泡。
- Multi-Agent：启动、child 调度、纠正、停止、综合、历史恢复。
- Workbench：统一历史排序、单次深入协作、surface 回调隔离。

非必要不进行浏览器视觉检查；UI 视觉或真实交互变化无法由结构/行为测试证明时再执行。

## 禁止回退

- 不从 `.trellis/tasks` 创建或续接当前任务。
- 不恢复 Ordinary/Multi-Agent 并列产品或自动模式路由。
- 不建设 universal Run API、统一业务状态机、全局 workflow 或事件总线重写。
- 不以共享为名让 neutral capability 依赖 feature。
- 不让 route、Panel 或兼容 facade 继续拥有 feature 状态。
- 不把普通编辑、helper、adapter、状态更新或一次工具循环命名为 Plan、Handoff、Agent cluster 或 atomic mutation。
- 不以摘要、脱敏或安全投影吞掉模型/工具事实。
