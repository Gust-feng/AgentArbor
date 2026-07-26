# 多 Agent 最小协作闭环

本文记录统一 Workbench 下显式 Multi-Agent 功能的当前稳定实现。它不是下一阶段任务书；长期决策以 ADR-0025/0028 为准。

## 产品边界

- Ordinary 始终是默认工作方式。
- Multi-Agent 只能由用户显式进入，不自动升级普通请求。
- 当前 release 暂时隐藏 beta 开关和侧栏 `Agent 集群` 入口；内部 Multi-Agent surface 仍是待收口的 Workbench 过渡实现，不代表第二个产品。
- 正式后端入口只有 `/api/deep/*`；旧 `/api/underground/*` 已删除。
- Multi-Agent 与 Ordinary 共享模型、工具、确认、上下文机械能力和 Host 适配，不共享业务状态、事件、仓储或 read-model。

## 当前闭环

```text
显式 Deep submission
  -> MultiAgentFeature
  -> Deep manager decision loop
  -> DeepTaskBoard + DeepChildScheduler
  -> one-level child Agent runs
  -> manager review / continue / wait
  -> parent synthesis
  -> Deep feature state/events/stores
  -> /api/deep/* read-model
```

manager 使用 `AgentTurnRuntime` 做语义决策，可以 direct answer、派生 child、等待、继续已有 child、追问、综合或停止。确定性代码只守 schema、预算、权限、一层 child、状态转换和 child output 不直通结论等边界。

## Feature 所有权

`MultiAgentFeature` 对外暴露 command/query facade，内部拥有：

- Deep conversation、run、task board、child run 和 synthesis 状态。
- conversation/run/child-message file stores。
- control/confirmation continuation registry。
- active run、instruction queue、scheduler 和资源释放。
- Deep events、live projection 和历史 read-model。

`deep-routes` 只做 HTTP 解析、错误映射和 facade 调用；不能创建 runtime、store、ToolCenter、provider 或第二份 active state。Panel 只消费 query/view，不从显示文本推导 child 或 run 状态。

## TaskBoard 与 scheduler

`DeepTaskBoard` 是单个 run 内 manager-owned 的权威 child 任务状态；`DeepChildScheduler` 负责有限并发和 FIFO 父层追加指令，不做语义判断。

- `spawn_children` enqueue 后按并发上限启动，不能串行伪装并发。
- `wait_children` 真实等待进展并回收材料。
- `continue_child` 复用同一 `childRunId`；running child 的追加指令排队，已进入可审查状态的 child 可以即时继续。
- stop/interrupt 后不再启动 pending child，并清空尚未执行的追加指令。
- 当前不强制 abort 已在进行中的 Deep 模型调用；其自然返回材料可以保留，但不能触发新的探索。

状态必须真实：`approval_required / out_of_fuel / context_overflow` 是 blocked，不是 failed 或 completed；内部异常停止是 interrupted；用户取消是 cancelled。

## Child Agent

- 强制 `depth = 1`，child 不能继续派生 child。
- 父层生成的 objective、工具上限和轮次预算在 child 出生时冻结；未显式设置时模型/工具轮次默认各 200，显式值上限同为 200，耗尽进入 blocked 而不是 completed。
- child 通过 `AgentTurnRuntime -> ToolCenter -> Confirmation` 执行标准模型-工具-模型循环。
- 同一 child 的多次继续写入 `executionHistory` 与 `parentInstructions`，不创建新 child。
- raw 父子追加消息由 feature-owned child message store 保存并通过 `messageRef` 关联；默认 read-model 只展示必要状态和摘要，但内部模型上下文不能被摘要替换。
- live confirmation continuation 只在进程内有效；丢失后明确不可恢复，不能伪造完成。

## Parent synthesis

- child output 是局部材料，不能直接成为最终结论。
- synthesis 必须由父层模型审查当前 child 材料后生成 `SynthesizedConclusion`。
- 没有可审查材料时拒绝伪造综合。
- child 继续后不会偷偷改写既有结论；需要纳入新材料时显式 resynthesize，并追加新的 synthesis 事实。
- `DeepExplorationReport` 保留 run tree、child 材料引用、父层综合和结论，不引入 Plan/Handoff/Fruits 语义。

## 持久化与恢复

Deep 使用 feature-owned file stores，conversation、run record、child message 和索引物理分离。恢复时优先使用 run 出生时冻结的模型模式与 capability snapshot，不能用当前全局设置覆盖历史 run。

Ordinary snapshot、Deep store 和 `ToolOutputStore` 生命周期互相独立。`tool-output://` 完整内容是 live-only transport，不写入 Deep 持久化；重启后引用失效必须明确返回 not found。

## API 与控制

正式 API 维持 `/api/deep/*` DTO 和 SSE/poll 行为。关键操作包括：

- 创建、读取、重命名、置顶和删除 Deep conversation。
- 启动、停止和查询 run/view。
- 对 child 追加指令、提交确认决策。
- 显式 resynthesize。

route 必须一对一委托 feature。控制请求找不到 child、scheduler 不再接收、continuation 丢失或 run 已终态时返回明确冲突/不可恢复错误，不能绕过 feature 创建替代执行路径。

## 非目标

- Ordinary 自动升级 Multi-Agent。
- 多层递归 child。
- child 互聊、team mailbox 或共享全局任务板。
- universal Run runtime、工作流 DSL、统一事件总线或跨 feature 事务。
- Plan、Aboveground、Governance 或 Global Soil 作为本闭环必经阶段。

## 变更检查

修改 Multi-Agent 时必须证明：

- Ordinary 的工具可见性、确认、状态、存储和首屏行为未改变。
- 同一 child 的状态、事件、store 和 view 从一个 owner 单向派生。
- 并发、stop、blocked、continue、confirmation 和 resynthesize 都有行为测试。
- route 没有获得 store/runtime/provider 所有权。
- shutdown 会停止新工作并释放 scheduler、continuation、store 与 ToolOutput owner。

## 验证

Multi-Agent 源码已归档到 `src/deferred/`，不再进入 `pnpm build:node` 与 `pnpm test`。验证改用归档入口：

```powershell
pnpm test:deferred
```

需要只跑单个用例时，先 `pnpm build:deferred`，再指向 `dist-deferred/`：

```powershell
pnpm build:deferred
node --test --test-concurrency=1 dist-deferred/deferred/deep/deep-task-board.test.js
```

`panel-server-deep-routes.test.ts` 断言 `/api/deep/*` 返回真实业务响应，与生产固定的 410 冲突，已从归档测试入口排除，恢复 Multi-Agent 时需连同 HTTP 契约一起重新设计。归档边界见[Multi-Agent 源码归档边界](17-Multi-Agent源码归档边界.md)。

跨模块提交门还需运行 `pnpm typecheck:panel`、`pnpm build:panel` 和完整 `pnpm test`。

## 相关文档

- [ADR-0025-deep一期Manager自由决策循环与一层child最小闭环](../../架构设计/产品架构/ADR-0025-deep一期Manager自由决策循环与一层child最小闭环.md)
- [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](../../架构设计/产品架构/ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)
- [功能模块边界与组合根](11-功能模块边界与组合根.md)
