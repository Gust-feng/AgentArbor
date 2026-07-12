# ADR-0028：AgentArbor 统一 Workbench 与功能模块化单体架构

日期：2026-07-12

状态：Accepted

取代关系：本 ADR 部分取代 [ADR-0022-AgentArbor桌面通用Agent与双运行时架构](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md) 中“普通 Agent 与 deep 是并列产品结构”的口径，并将 [ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界](ADR-0023-LocalRuntimeLiteProfile与未来FullProfile演进边界.md) 退为历史 Profile 方案。它保留 [ADR-0024](ADR-0024-桌面基础Agent与基础设施优先路线.md) 的普通 Agent 默认地位和基础能力优先原则，保留 [ADR-0025](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md) 的 Multi-Agent 内部闭环，且不改变 [ADR-0026](ADR-0026-子Agent工具能力架构.md) 与 [ADR-0027](ADR-0027-工具执行事实与单向消费架构.md) 的有效契约。

## 背景

项目已经拥有普通 Agent、Sub-Agent 工具、deep / Multi-Agent、Panel、模型、工具、确认、上下文和持久化等实现，但产品入口、业务状态和基础设施所有权长期按不同路线叠加，形成了结构性问题：

- 普通 Agent 与 deep 被描述为两个并列产品入口，用户和开发者都需要先理解“模式”，再理解工作本身。
- route、Panel、业务编排和基础设施之间缺少稳定边界；同一个事件或状态可能被多层重复加工、重命名和推导。
- 共享设施包含普通 Agent 或 Deep 的业务假设，功能模块又直接创建 provider、store 或工具工厂，导致“共享”演变成双向耦合。
- 为未来能力提前设计通用 runtime、统一状态和兼容 facade，会冻结尚未稳定的业务流程，增加重构成本，却没有形成可复用能力。
- 大量代码和测试围绕现有文件形态与历史接口生长，基础能力没有成为可被不同功能按需调用的中性模块。

问题的根因不是缺少更多抽象，而是产品边界、功能所有权和装配边界没有统一。

## 决策

### 1. 产品只有一个 Workbench

AgentArbor 对用户是一个桌面任务工作台，不再以“普通运行时 / deep 运行时”作为并列产品结构：

```text
Workbench
  ├─ Ordinary Agent（默认工作方式）
  │    └─ Sub-Agent（按需调用的工具能力）
  └─ Multi-Agent（用户显式选择的深入协作功能）
       └─ manager / child / TaskBoard / synthesis

两类工作结果 -> Workbench 历史与活动展示
```

- Ordinary Agent 是默认工作方式，负责连续会话、模型工具循环、确认、取消、恢复和结果展示。
- Multi-Agent 是 Workbench 内的显式功能，不是第二个产品，也不会由关键词、长度、文件数量或模型判断自动触发。
- Sub-Agent 是 Ordinary Agent 的工具能力，不是第三种模式；它的输出是父 Agent 使用的局部材料。
- Workbench 只组合导航、输入、历史和展示，不拥有 Ordinary 或 Multi-Agent 的业务状态。

当前实现仍保留设置中的 beta 开关、侧栏“Agent 集群”按钮、`/api/deep/*`、Deep DTO 和独立数据目录。这些是统一 Workbench 下尚待收口的实现形态，不代表 UI 已经完成合并，也不构成新的产品边界。

### 2. 采用同仓功能模块化单体

项目继续使用一个仓库和现有 `pnpm + TypeScript` 工具链，不拆分 pnpm packages，不引入 DI 框架。模块边界由源码目录、公开端口、组合根和依赖测试守住。

模块化先按功能闭环，再按技术层分层：

- Ordinary Agent、Multi-Agent、Sub-Agent 分别拥有自己的 command、query、event、业务状态、仓储端口、read-model 和测试。
- Workbench Shell 拥有导航和展示组合，不拥有或持久化功能业务状态。
- 模型接入、工具执行原语、确认、上下文机械算法、tokenizer、消息完整性、配置读取和系统适配属于中性能力。
- `domain / app / kernel / adapters` 可以作为模块内部或跨模块的技术分层，但不能取代功能所有权。

不建设统一 `RunRuntime`、`WorkAggregate`、全局业务状态、跨功能工作流引擎或统一业务事件总线。名称相似不等于语义相同；只有两个真实消费者已经稳定使用同一机械契约时，才允许提取共享原语。

### 3. 功能拥有业务事实，共享层只提供中性能力

每个功能通过自己的 command/query/event facade 对外提供能力。调用者只依赖公开端口，不能读取功能内部 store、registry、live handle 或 provider 私有对象。

共享能力必须同时满足：

1. 不包含 Ordinary、Multi-Agent、Sub-Agent 或 Panel 的业务语义。
2. 不依赖任何 feature 实现。
3. 不保存跨 feature 的业务状态。
4. 不决定任务目标、模式选择、工具路径、综合结论或停止语义。
5. 能以明确输入输出被调用，并由调用 feature 映射技术结果为业务 outcome。

工具、模型、确认和上下文能力可以共享；工具可见性、确认后如何继续、何时完成、事件名称和 read-model 则由各 feature 决定。共享层不能以 service locator 或属性包把所有服务重新暴露给业务代码。

### 4. 唯一后端 Composition Root

后端只有一个 Composition Root。`createPanelRuntime()` 负责创建 Host 级资源、装配 `OrdinaryAgentFeature` 与 `MultiAgentFeature`，并把精确端口交给 HTTP/SSE adapter。

- 只有 Composition Root 可以同时导入并装配多个 feature 和具体 adapter。
- route 只解析 HTTP、调用 feature command/query、映射协议响应；不得创建 feature store、provider、ToolCenter 或隐藏的 runtime。
- feature 工厂负责其 live registry、store、continuation、active run tracking 和资源释放。
- 资源生命周期由创建者拥有；Composition Root 统一触发关闭，不由 route 通过 `WeakMap` 隐式维持。

前端沿用同样原则：Shell 组合 Ordinary surface 与 Multi-Agent surface；两者各自拥有 controller、SSE/poll cursor、busy、confirmation 和 view projection。切换 surface 后，旧回调不得更新当前 surface。

### 5. 事件和状态只加工一次

业务事实在 owning feature 内产生并归约：

```text
执行事实 -> feature event -> feature state / repository -> feature read-model
                                                    └-> UI projection
```

- 执行结果不能先被共享 runtime 改写成 Ordinary 结果，再被 Deep route 改写成 Multi-Agent 结果。
- SSE 是变化通知或 feature 事件传输，不是前端重建后端业务状态的第二事实源。
- UI 摘要是附加展示，不覆盖模型可继续使用的正文、工具事实、错误或 continuation。
- 跨功能历史只在 UI 层用判别联合做排序和导航，底层会话、状态和存储继续分离。

### 6. 长期能力是按需扩展，不是请求必经流水线

Task Soil、Underground、Plan、Aboveground、Fruits、Governance 和 Global Soil 仍保留架构价值，但不再被描述为每次请求必须依次经过的主线。

- Ordinary 工作可以直接在 Workbench 内完成。
- Multi-Agent 可以完成探索与父层综合，而不必伪造 Plan 或 Aboveground 交接。
- 只有真实需要持久化执行计划时才出生 Plan。
- 只有产生候选经验且满足治理契约时才进入 Governance / Global Soil。

长期能力必须作为独立纵向模块逐步出生，通过端口被现有 feature 调用，不能提前塞入一个全局工作流。

## 依赖方向

允许的主方向是：

```text
Workbench / HTTP / Desktop Host
  -> Composition Root
      -> Ordinary Agent Feature
      -> Multi-Agent Feature
      -> Sub-Agent contribution
      -> neutral capabilities + adapters

feature -> neutral capability ports
adapter -> neutral contracts
```

禁止：

- neutral capability 依赖 feature。
- Multi-Agent 依赖 Ordinary/Desktop 的具体实现。
- feature 依赖 Panel server 或 Panel UI。
- route 创建 feature 内部状态或基础设施工厂。
- feature 通过另一个 feature 的 store、事件或 read-model 传递业务事实。
- 为兼容旧文件名而永久保留无行为价值的 facade 或源码字符串测试。

## 迁移策略

迁移按可验证的纵向阶段推进，不做一次性全仓重写：

1. 建立本文档与依赖门，冻结 Ordinary、Sub-Agent 和正式 Deep 的行为基线。
2. 建立唯一后端 Composition Root，把 Deep store、registry、active run 和释放职责移入 Multi-Agent feature，保持 `/api/deep/*`、DTO 和存储格式不变。
3. 中性化模型、工具、确认和上下文机械能力，拆除 `MinimalRuntime` service locator 与跨 feature facade。
4. 收口 Workbench 产品入口；统一历史展示但不统一业务状态或存储。
5. 在正式 Deep smoke 覆盖后退役 `/api/underground/*` 及未被正式 Deep 使用的 legacy 实现。

每一阶段都必须先补行为测试，再删除兼容结构。开发期本地数据允许 clean break，但不主动删除旧字节，也不建设双读双写。

## 兼容与非目标

本决策不要求立即改变当前 UI、`/api/deep/*`、Deep DTO、Deep store 格式或 manager / TaskBoard / scheduler / child / parent synthesis 行为。

明确不做：

- pnpm 多包拆分。
- DI 框架或全局 service container。
- universal Run API、统一状态机或 `WorkAggregate`。
- 工作流 DSL、Event Sourcing、跨模块事务或全局事件总线重写。
- 在没有两个稳定消费者前抽象通用 blob、journal 或 repository。
- 把 Multi-Agent 状态转换成 Ordinary 状态，或把 Sub-Agent 变成独立产品模式。

## 验收约束

- 依赖测试能阻止 neutral -> feature、feature -> Panel、Multi-Agent -> Ordinary 实现和绕过 Composition Root 的装配。
- Ordinary 的完成、确认、取消、失败和恢复语义保持不变。
- Sub-Agent 的权限继承、禁止递归、完整输出和确认冒泡保持不变。
- Multi-Agent 的启动、child 调度、纠正、停止、综合和历史恢复保持不变。
- HTTP route 可通过薄适配测试证明一对一委托 feature。
- 跨 surface 的 SSE/poll 回调不能污染当前视图。
- 阶段门至少运行 Node build、Panel typecheck/build、目标测试和 `git diff --check`；最终收口再运行全量测试。

## 后果

收益是产品心智统一、业务事实归属清楚、共享能力可以被按需调用、功能能够独立演进和测试。代价是迁移期间仍会同时看到旧 API/目录命名和新 feature 边界，且需要先补依赖门与行为基线，短期代码量不一定下降。

本 ADR 优先减少未来变更的耦合面，不以“文件数更少”或“所有运行统一”为目标。模块化的判断标准是功能能否只通过公开端口被装配、替换、测试和释放。

## 相关文档

- [当前软件运行方式](../../../CURRENT_RUNTIME_MODE.md)
- [功能模块边界与组合根](../../开发指南/06-工程实现/11-功能模块边界与组合根.md)
- [ADR-0024-桌面基础Agent与基础设施优先路线](ADR-0024-桌面基础Agent与基础设施优先路线.md)
- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0026-子Agent工具能力架构](ADR-0026-子Agent工具能力架构.md)
- [ADR-0027-工具执行事实与单向消费架构](ADR-0027-工具执行事实与单向消费架构.md)
