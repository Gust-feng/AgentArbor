# 后端/运行时目录结构

当前已出生的 `src/` 代码是第一阶段确定性最小运行内核。目录结构必须承接 `docs/开发指南/06-工程实现/02-模块划分.md` 的 `domain / kernel / adapters / app` 思路。

## Scope / Trigger

- Trigger：修改 `src/` 下运行时内核、领域契约、fake agents、demo 或测试。
- Scope：内存版最小闭环；不包含 HTTP API、数据库、UI、MCP、A2A 或 AG-UI adapter。真实模型接入必须先遵守 [智能通道运行时规范](./intelligence-channel.md)。

## Signatures

- 根入口：`src/index.ts`。
- 完整闭环 demo 入口：`src/app/demo.ts`，由 `pnpm demo` 调用。
- 地下-only demo 入口：`src/app/underground-demo.ts`，由 `pnpm demo:underground -- "<goal>"` 调用；默认目标只能证明地下单环，不进入 Aboveground。
- 最小闭环 API：`runMinimalLoop(goal?: string, options?: RunMinimalLoopOptions): MinimalLoopResult`。
- 地下-only API：`runUndergroundDirectionSession(goal: string, options?: RunUndergroundDirectionSessionOptions): UndergroundDirectionSessionResult`。

## Contracts

- `src/domain/` 保存 AgentArbor 产品语义和最小运行契约类型。
- `src/kernel/` 保存消息、事件、注册、路由、状态机、产物存储和确定性守卫。
- `src/app/` 保存应用编排、fake agents 和 demo；fake agents 不是长期 Capability Asset。
- `src/app/underground-demo-summary.ts` 保存地下-only demo 的纯 summary 投影；CLI 入口只负责读取参数和打印，不把 console 输出逻辑塞进地下运行核心。
- `src/app/intelligence-channel-factory.ts` 保存 CLI / demo 组合根的智能通道装配；它是 app 层唯一允许导入 provider adapter 的窄入口，地下业务编排只接收注入的 `IntelligenceChannel`。
- `src/adapters/` 本阶段只能保留 adapter 边界；真实模型 provider adapter 只能在智能通道任务中进入 `src/adapters/intelligence/`。
- `src/domain/contracts.ts` 是兼容 barrel；新增领域类型应优先落到 `common`、`constraints`、`underground`、`agentarbor`、`aboveground`、`governance` 或 `fruits` 的 focused module，再由 barrel 重导出。
- `src/app/minimal-underground.ts` 是兼容 barrel；地下确定性材料必须按职责拆到 `underground-rootlets`、`underground-candidates`、`underground-convergence`、`underground-evidence`、`underground-goal-profile` 和 `underground-report` 等 focused modules。
- `src/app/minimal-direction.ts` 只保留 Direction Handoff material 入口；字段派生和 7 gate constraint refs 由 `direction-handoff-derivation` 负责，避免 package 创建、目标画像派生和风险/约束组装堆在一个文件。

## 生效规则

- 不新增 routes、controllers、repositories、ORM、HTTP server 或 adapter 实现来满足最小闭环。
- `domain/` 不能依赖 `adapters/`。
- `kernel/` 不能保存 Soil、DirectionHandoff、GrowthPlan 或 Governance 的业务事实，只保存横切机制。
- `app/` 可以编排 fake agents，但不能把 fake agent 清单写成 AgentArbor 原生长期资产。
- `.agentarbor/` 不因 demo 运行而写入真实运行资产。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Aboveground Center 试图创建方向探索候选 | 抛出 `StateGuardError` |
| 内部 agent 试图用 `to.id` 私聊 | 抛出 `MessageBusPolicyError` |
| demo 需要数据库、HTTP 或非智能通道 adapter | 超出当前目录规范，应拆新任务和新 spec |
| 真实模型接入绕过智能通道 | 违反智能通道规范，测试必须失败 |
| `pnpm demo:underground` 进入 Growth Plan / Aboveground / Fruits / Governance | 违反地下-only 边界，测试必须失败 |

## Good / Base / Bad Cases

- Good：focused domain modules 定义类型，`domain/contracts.ts` 重导出兼容入口，`kernel/messages` 记录总线策略，`app/minimal-loop.ts` 编排 demo。
- Good：app 层 deterministic factory 保持模块化，compatibility barrel 只负责稳定导出，不再承担业务逻辑。
- Good：地下-only demo 复用 `runUndergroundDirectionSession` 和 `createUndergroundDemoSummary`，输出 7 步地下 EventLog 与 package validation 摘要。
- Base：`src/adapters/index.ts` 只暴露空 adapter 边界。
- Bad：在 `app/` 中直接写 `.agentarbor/` 文件、让地下-only demo 继续规划 Growth Plan，或在 `domain/` 中引用平台 adapter。

## Tests Required

- 固定 EventLog 顺序。
- 未批准 DirectionHandoff 不得进入 Planning。
- 未收束候选不得进入 DirectionHandoff。
- Assigned 前必须有 GrowthPlan。
- hard constraint 阻断或要求确认。
- 内部 agent 私聊被 MessageBus 阻断。

## Wrong vs Correct

### Wrong

把 WorkerAgent 直接调用 Verifier 的方法，绕过 MessageBus 和 EventLog。

### Correct

WorkerAgent 产出 `artifact.produced` 消息，MessageBus 写入 EventLog，再由编排层进入验证。
