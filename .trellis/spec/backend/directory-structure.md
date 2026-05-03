# 后端/运行时目录结构

当前已出生的 `src/` 代码是第一阶段确定性最小运行内核，并包含本地 Underground panel 原型。目录结构必须承接 `docs/开发指南/06-工程实现/02-模块划分.md` 的 `domain / kernel / adapters / app` 思路。

## Scope / Trigger

- Trigger：修改 `src/` 下运行时内核、领域契约、fake agents、demo、本地 panel、配置中心或测试。
- Scope：内存版最小闭环与本地 Node HTTP panel 原型；不包含数据库、正式前端框架、MCP、A2A 或 AG-UI adapter。真实模型接入必须先遵守 [智能通道运行时规范](./intelligence-channel.md)。

## Signatures

- 根入口：`src/index.ts`。
- 完整闭环 demo 入口：`src/app/demo.ts`，由 `pnpm demo` 调用。
- 地下-only demo 入口：`src/app/underground-demo.ts`，由 `pnpm demo:underground -- "<goal>"` 调用；默认目标只能证明地下单环，不进入 Aboveground。
- 本地 panel 入口：`src/app/panel.ts`，由 `pnpm panel` 调用；只启动本机 HTTP 服务并打印 URL。
- 本地 panel HTTP 编排：`src/app/panel-server.ts`；只能调用地下-only API、配置中心和 JSON-safe summary / snapshot 投影；可生成由 summary / snapshot / sanitized config 派生的 tracking read model。
- 静态 panel 资产：`src/app/panel-assets.ts`；使用 Node 内置 HTTP 服务发送静态 HTML/CSS/JS，不引入前端构建链；默认简体中文 UI，并用中文标签包裹必要技术 id。
- 配置中心：`src/app/config-center.ts` 组合普通 settings store 与 local-dev secret store；领域契约位于 `src/domain/config/`，文件系统实现位于 `src/adapters/config/`。
- 最小闭环 API：`runMinimalLoop(goal?: string, options?: RunMinimalLoopOptions): MinimalLoopResult`。
- 地下-only API：`runUndergroundDirectionSession(goal: string, options?: RunUndergroundDirectionSessionOptions): UndergroundDirectionSessionResult`。

## Contracts

- `src/domain/` 保存 AgentArbor 产品语义和最小运行契约类型。
- `src/domain/config/` 只保存本地运行配置契约和脱敏视图；配置中心不是 Soil、RunMemory、Experience Candidate 或 Capability Asset。
- `src/kernel/` 保存消息、事件、注册、路由、状态机、产物存储和确定性守卫。
- `src/app/` 保存应用编排、fake agents 和 demo；fake agents 不是长期 Capability Asset。
- `src/app/panel-server.ts` 是本地用户面板 API 边界；它不能直接导入 provider adapter，真实模型仍必须通过 `src/app/intelligence-channel-factory.ts` 装配后的 `IntelligenceChannel`。
- `src/app/underground-demo-summary.ts` 保存地下-only demo 的纯 summary 投影；CLI 入口只负责读取参数和打印，不把 console 输出逻辑塞进地下运行核心。
- `src/app/intelligence-channel-factory.ts` 保存 CLI / demo 组合根的智能通道装配；它是 app 层唯一允许导入 provider adapter 的窄入口，地下业务编排只接收注入的 `IntelligenceChannel`。
- `src/adapters/config/` 只处理本地文件读写；普通 settings store 和 local-dev secret store 必须分文件保存，普通 settings 不得保存 raw secret。
- `src/adapters/` 本阶段只能保留 adapter 边界；真实模型 provider adapter 只能在智能通道任务中进入 `src/adapters/intelligence/`。
- `src/domain/contracts.ts` 是兼容 barrel；新增领域类型应优先落到 `common`、`constraints`、`underground`、`agentarbor`、`aboveground`、`governance` 或 `fruits` 的 focused module，再由 barrel 重导出。
- `src/app/minimal-underground.ts` 是兼容 barrel；地下确定性材料必须按职责拆到 `underground-rootlets`、`underground-candidates`、`underground-convergence`、`underground-evidence`、`underground-goal-profile` 和 `underground-report` 等 focused modules。
- `src/app/minimal-direction.ts` 只保留 Direction Handoff material 入口；字段派生和 7 gate constraint refs 由 `direction-handoff-derivation` 负责，避免 package 创建、目标画像派生和风险/约束组装堆在一个文件。

## 生效规则

- 除 `src/app/panel-server.ts` 的本地 panel 原型外，不新增 routes、controllers、repositories、ORM 或通用 HTTP backend。Panel HTTP JSON 和 tracking read model 只是未来工作台读模型入口，不能成为 EventLog / Observation / Soil 之外的事实源。
- `domain/` 不能依赖 `adapters/`。
- `kernel/` 不能保存 Soil、DirectionHandoff、GrowthPlan 或 Governance 的业务事实，只保存横切机制。
- `app/` 可以编排 fake agents，但不能把 fake agent 清单写成 AgentArbor 原生长期资产。
- `.agentarbor/` 不因 demo 运行而写入真实运行资产。
- `pnpm panel` 默认不得触发真实网络；`openai-compatible` 只有在用户显式选择并且配置中心具备 base URL、model 和 secret 时才能进入 provider 路径。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Aboveground Center 试图创建方向探索候选 | 抛出 `StateGuardError` |
| 内部 agent 试图用 `to.id` 私聊 | 抛出 `MessageBusPolicyError` |
| demo 需要数据库、通用 HTTP backend 或非智能通道 adapter | 超出当前目录规范，应拆新任务和新 spec |
| 真实模型接入绕过智能通道 | 违反智能通道规范，测试必须失败 |
| `pnpm demo:underground` 进入 Growth Plan / Aboveground / Fruits / Governance | 违反地下-only 边界，测试必须失败 |
| panel HTTP 响应、settings store、EventLog、Snapshot 或 summary 出现 API key / token | 密钥边界失败 |

## Good / Base / Bad Cases

- Good：focused domain modules 定义类型，`domain/contracts.ts` 重导出兼容入口，`kernel/messages` 记录总线策略，`app/minimal-loop.ts` 编排 demo。
- Good：app 层 deterministic factory 保持模块化，compatibility barrel 只负责稳定导出，不再承担业务逻辑。
- Good：地下-only demo 复用 `runUndergroundDirectionSession` 和 `createUndergroundDemoSummary`，输出 7 步地下 EventLog 与 package validation 摘要。
- Good：本地 panel 复用 `runUndergroundDirectionSession` / `runUndergroundDirectionSessionWithIntelligence`、`createUndergroundDemoSummary` 和 Observation Snapshot，只返回脱敏配置与 JSON-safe 读模型。
- Base：`src/adapters/index.ts` 只暴露空 adapter 边界。
- Bad：在 `app/` 中直接写 `.agentarbor/` 文件、让地下-only demo 或 panel 继续规划 Growth Plan，或在 `domain/` 中引用平台 adapter。

## Tests Required

- 固定 EventLog 顺序。
- 未批准 DirectionHandoff 不得进入 Planning。
- 未收束候选不得进入 DirectionHandoff。
- Assigned 前必须有 GrowthPlan。
- hard constraint 阻断或要求确认。
- 内部 agent 私聊被 MessageBus 阻断。
- 配置中心 raw secret 不进入普通 settings store、EventLog、Observation Snapshot、demo summary、panel HTTP JSON 响应或测试快照。
- panel no-AI / fake AI / openai-compatible 缺配置失败路径均有测试，且缺 key 时不调用 provider fetch。

## Wrong vs Correct

### Wrong

把 WorkerAgent 直接调用 Verifier 的方法，绕过 MessageBus 和 EventLog。

### Correct

WorkerAgent 产出 `artifact.produced` 消息，MessageBus 写入 EventLog，再由编排层进入验证。
