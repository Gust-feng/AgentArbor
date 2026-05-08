# implement: Cognitive Work Session Runtime 与项目分析验收

## Goal

把 Desktop Shell 首选运行路径从旧的固定 Underground 流水线切换到 `CognitiveWorkSessionRuntime`。新主线必须让主 Agent 通过模型决定下一步行动，能够动态派生一层同能力 child agent，父层综合后产出可审阅的项目分析报告。

## Background

当前 Desktop Shell 已能跑通 fake-AI demo 闭环，但它仍把 `UndergroundAgentOrchestrator` 的固定七 agent 流水线包装成 approved Plan，再交给最小 Aboveground consumer。这条路径能证明链路存在，却不能证明 AgentArbor 已经具备真实工作会话能力。

ADR-0022 定义的产品入口是 Desktop Shell，用户期待的是通用桌面 Agent：接收任务、读取上下文、按需调工具、派生 child、综合材料、产出报告或停止。旧 Underground-only 运行时继续作为兼容路径保留，但不能再作为 Desktop 产品主线。

## Requirements

* 新增 `runCognitiveWorkSession(goal, options)`，作为 Desktop Shell 主入口。
* Work Session 主 Agent 使用单一认知循环语义：observe Task Soil -> model decide_next -> act / tool / delegate / synthesize -> produce artifact or stop。
* Work Session 必须支持多步循环，模型每步可选择 `use_tools`、`spawn_children`、`wait_children`、`synthesize`、`ask_user`、`produce_artifact` 或 `stop`。
* `produce_artifact` 必须在父层 synthesis 之后发生；工程守卫只能阻断非法顺序、预算耗尽、越权工具和 child depth，不得替 agent 决定语义路线。
* 复用 `AgentTurnRuntime`、`ToolCenter`、Task Soil、EventLog、Agent Fabric 和现有配置边界；不直接接 provider adapter，不新增 SDK。
* Agent Fabric 支持通用 `child` agent kind；MVP 仍只允许 depth=1，child 不可再派生。
* child output 只能作为局部材料，最终 artifact 必须引用父层 synthesis。
* 工具调用结果只能以 `tool-call:*`、`research:*` 或 safe evidence refs 进入 Work Session 材料；不得把 raw tool output、完整文件正文或 provider raw response 写入 artifact、canvas、transcript 或 EventLog。
* `POST /api/desktop/runs`、polling 和 SSE 默认进入 Work Session；旧 `/api/underground/*` 保持兼容。
* Work Session 成功输出 `WorkSessionResult`，包含 Task Soil、Agent Run Tree、final report artifact、evidence refs、uncertainty、next actions、model/tool refs 和安全事件投影。
* `aiMode=none` 或无可用 `AgentTurnRuntime` 不得产出 completed artifact。
* OpenAI-compatible 配置缺失必须在 provider fetch 前失败，并返回安全配置边界。
* 显式真实 AI smoke 必须运行 `CognitiveWorkSessionRuntime`，不再调用旧 `runMinimalLoop()`；配置缺失时输出 skipped/configuration，配置完整时走 openai-compatible + ToolCenter + safe evidence refs。
* Main Canvas 展示项目分析报告、关键发现、证据、不确定性和下一步；Observation Panel 展示 agent tree、父层 synthesis、模型/工具 refs 和预算。

## Acceptance Criteria

* [x] `pnpm build` 通过。
* [x] `pnpm test` 通过。（273 tests pass）
* [x] `POST /api/desktop/runs` fake AI 路径不调用 `runMinimalLoop` / `UndergroundAgentOrchestrator`，且不出现 legacy underground happy-path events。
* [x] fake AI Work Session 至少派生 1 个 child agent，并在父层 synthesis 后生成项目分析 report artifact。
* [x] fake/stub AI Work Session 至少覆盖一个 `use_tools -> spawn_children -> synthesize -> produce_artifact` 多步路径。
* [x] `produce_artifact` 在缺少 parent synthesis 时停止，不生成 completed artifact。
* [x] 工具 evidence refs 能进入父层 synthesis 输入和最终 report refs，但 raw tool output 不进入 HTTP JSON / SSE / transcript / canvas。
* [x] child output 未经父层 synthesis 不能进入 final artifact。
* [x] no-AI / `aiMode=none` 返回配置或能力边界，不生成 completed artifact。
* [x] Desktop canvas / tracking / transcript / SSE 不泄漏 raw prompt、raw provider response、hidden reasoning、raw tool output、API key、token、runtime/store refs 或未授权文件正文。
* [x] 旧 `/api/underground/*` 兼容测试继续通过。
* [x] `pnpm panel:smoke` 和 `pnpm panel:desktop:smoke` 通过。
* [x] `pnpm smoke:real-ai` 作为显式真实 provider smoke 入口存在；默认测试只用 stubbed provider 验证该路径，不触发真实网络。

## Out of Scope

* 不删除旧 Underground 运行时。
* 不把 Work Session 产物强行包装成 approved Plan Package。
* 不接 Aboveground patch preview、文件修改或 verification phase。
* 不引入 React/Vite、新 SDK、新包管理器或新测试框架。
* 不写 repo-root `.agentarbor/` 运行资产。

## Technical Notes

* 任务目录：`.trellis/tasks/05-08-project-analysis-optimization`
* 关键入口：`src/app/panel-server.ts`、`src/app/panel-canvas-read-model.ts`、`src/app/panel-run-read-model.ts`
* 新模块建议：`src/app/cognitive-work-session.ts`
* 旧兼容入口：`runUndergroundDirectionSessionWithIntelligence()`、`runMinimalLoop()`
