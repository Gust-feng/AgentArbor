# 规划真实 AI 工作流与 Task Soil 工作台入口

## Goal

把 Desktop Shell 从“fake-AI demo 闭环”推进为接近真实使用的桌面 Agent 工作流：真实 openai-compatible 模型成为产品验证的一等入口，用户可以带入文件、项目、网页材料、临时约束和权限边界，系统组装 Task Soil 后进入 Underground -> Plan -> Aboveground -> Fruits 闭环；面板要像 Codex / Claude Code 这类成熟 agent 工具一样，清楚展示任务、agent 过程、模型/工具流、Plan 和结果，而不是只展示测试摘要。

一句话：下一轮不是继续证明 demo 能跑，而是让真实 AI 在真实任务入口中跑起来，并让面板成为可用的 agent 工作台。

## What I Already Know

- 当前已提交的 Desktop Shell 闭环可以通过 `/api/desktop/runs` 走 fake AI，产出 Task Soil、Plan、Aboveground 最小执行结果和 Fruits。
- 当前 Task Soil 仍主要由 goal 自动生成，workspace/context refs 是最小占位，不足以支撑桌面通用 Agent。
- 用户明确要求后续开发更接近真实工作流：使用真实 AI 去跑、去试，面板可以更大胆优化，不能被测试 demo 和保守边界锁死。
- 当前 shell 环境检查显示 `AGENTARBOR_MODEL_BASE_URL`、`AGENTARBOR_MODEL_NAME`、`AGENTARBOR_MODEL_API_KEY` 未配置；`OPENAI_API_KEY` 有值但长度异常短。真实 AI path 必须清楚报告配置状态，不能伪造通过。
- ADR-0022 明确 Task Soil 是当前任务级临时土壤，Global Soil 只能接收治理后的长期事实。
- Observation Panel 只能展示安全投影；Main Canvas 解释结果为什么合理，Panel 解释 agent 集群如何形成结果。
- 本阶段不应提前做完整 Governance、多层递归 Agent Fabric、真实 `.agentarbor/` 写入或复杂前端框架。

## Assumptions

- MVP 继续复用现有 Node HTTP panel，不引入 React/Vite 或新的前端构建链；但 UI 信息架构可以更大胆，不再按 demo 输出排版。
- fake AI 只作为 CI / 稳定测试路径；产品验证和本地手工 smoke 应优先使用 `openai-compatible`。
- 真实模型配置不完整时，面板必须给出明确配置边界和下一步，不 fallback 成 fake AI 成功。
- Task Soil 可以接收 refs、短摘要和只读短预览；不直接把大文件正文、网页全文或 secret 写入 EventLog / transcript / canvas。
- ToolCenter / Guard 仍是最终权限边界，不能相信前端或模型自称的权限。

## Open Questions

- 已按最新用户反馈决策：`openai-compatible` 设为面板推荐模式；配置完整时进入真实 AI，配置不完整时显示配置待办并停止在配置边界；fake AI 收进测试/开发选项。

## Requirements

- Desktop run 请求体应支持 goal 之外的 Task Soil 输入：workspace refs、context refs、临时约束、权限边界、本地文件只读短预览或等价结构。
- 面板必须把真实 AI run 当成一等工作流：可见配置状态、运行模式、模型 refs、工具 refs、失败边界和继续动作。
- 默认测试仍使用 fake/stub，真实 AI smoke 独立显式运行；但本地产品验证不能只看 fake AI。
- Task Soil 组装逻辑应成为明确 helper / contract，不继续散落在 `runMinimalLoop()` 内。
- Main Canvas 展示 Task Soil、Plan、Aboveground 和 Fruits 的连续任务故事：目标、refs、权限边界、为什么这样计划、结果是什么、下一步能做什么。
- Observation Panel 强化为监督台：Agent Run Tree、运行时间线、模型/工具流、父层 synthesis、风险/不确定性、配置状态和安全 refs 要更直观。
- Observation / transcript / SSE 不泄漏 raw prompt、raw provider response、hidden reasoning、raw tool output、API key、token、未授权文件正文或 runtime/store 引用。
- 无 AgentTurnRuntime 或 `aiMode=none` 仍不能产出 approved Plan。

## Acceptance Criteria

- [ ] `POST /api/desktop/runs` 可以接收 goal + context refs，并返回 `canvas.taskSoil.contextRefs`。
- [ ] 面板可以启动 `openai-compatible` Desktop run；配置缺失时 provider fetch 前失败并给出清晰配置待办，配置完整时可以真实调用模型。
- [ ] 真实 AI 输出不符合契约时，Desktop Shell 失败响应和右侧诊断区必须展示安全的 purpose、contract id、failure kind、validation status 和 call ref，不能只显示 `panel_internal_error`。
- [ ] 新增显式真实 AI smoke 命令或文档化验收路径：`pnpm build && node dist/app/real-ai-smoke.js "<goal>"`；不与默认 `pnpm test` 混在一起，环境缺失时报告 skip/config boundary。
- [ ] 无效、越权或空上下文 refs 有清晰边界结果，不导致 approved Plan 伪成功。
- [ ] Main Canvas 展示 Task Soil refs 和 permission boundary，不把 EventLog JSON 当主内容。
- [ ] 默认 fake AI 路径 0 网络调用；未配置 openai-compatible 时仍在 provider fetch 前失败。
- [ ] 面板首屏更接近真实 agent 工作台：任务输入、上下文、Plan、结果、运行树和模型/工具状态在同一工作流里可扫读。
- [ ] 右侧运行监督工作台不产生横向滚动；运行健康、真实 AI 诊断、模型 / 工具流、Agent Run Tree 和父层 synthesis 使用安全投影分层展示。
- [ ] panel JSON / SSE / transcript / canvas 不包含 secret、raw prompt、raw provider response、hidden reasoning、raw tool output 或未授权正文。
- [ ] `pnpm build`、`pnpm test`、`pnpm panel:smoke`、`pnpm panel:desktop:smoke` 通过。

## Implementation Update 2026-05-07

- 第一轮实现已把右侧从普通 inspector 收缩为 `运行监督工作台`：运行健康、真实 AI 诊断、模型 / 工具流、Agent Run Tree、父层 synthesis、风险 / 下一步分层展示。
- `PanelRunTranscript.modelCalls` 现在保留安全失败字段：`failureKind`、`retryable`、`sanitizedErrorRef`、validation status、purpose、contract id 和 call refs。
- Desktop async job 捕获真实 provider 输出契约失败时，会从 `model.requested` / `model.failed` 事件派生中文诊断，不再只返回通用内部错误；失败仍不生成 approved Plan。
- 浏览器检查已发现并修复右侧 / 左侧横向溢出，body/html 不再产生横向滚动。

## Out of Scope

- 不实现完整 Global Soil 写入或 Governance Pipeline。
- 不做真实 `.agentarbor/` 文件写入。
- 不引入正式前端框架、文件 watcher、索引数据库或后台 daemon；但允许在现有 `panel-assets.ts` 内做更大胆的信息架构和交互优化。
- 不让 Aboveground 执行真实文件修改；真实工作流先以研究、计划、摘要、只读上下文理解和可见 artifact 为主。
- 不扩展 Underground 内部智能、rootlet kind 或多层递归 Agent Fabric。

## Technical Notes

- 事实源：`docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md`。
- 当前入口：`src/app/panel-server.ts` 的 `/api/desktop/runs`。
- 当前 Task Soil 来源：`src/app/minimal-loop.ts`。
- 当前主画布投影：`src/app/panel-canvas-read-model.ts`。
- 当前 UI：`src/app/panel-assets.ts`。
- 相关规范：`.trellis/spec/backend/soil-store.md`、`.trellis/spec/backend/observation-read-model.md`、`.trellis/spec/frontend/component-guidelines.md`。

## Initial Implementation Shape

1. 把面板运行模式改成真实工作流导向：`openai-compatible` 成为推荐模式，fake AI 明确标为测试模式；配置不完整时显示待办。
2. 新增或收束 `DesktopRunInput` / `TaskSoilInput` 契约，支持 context refs 和只读短预览。
3. 提取 `createTaskSoilFromDesktopInput()`，由 Desktop runner 调用；旧 goal-only 请求继续兼容。
4. 扩展 Main Canvas：以任务故事展示 Task Soil -> Plan -> Aboveground -> Fruits，并显示 rejected/unknown refs。
5. 强化 Observation Panel：运行时间线、Agent Run Tree、模型/工具流、父层 synthesis、配置状态和安全 refs。
6. 增加真实 AI smoke：环境完整时运行一个真实模型任务；环境不完整时明确报告 skip / configuration boundary。

## Decision (ADR-lite)

Context：上一批已经证明 fake-AI Desktop 闭环能跑，但用户指出这仍像测试 demo，不像真实桌面 Agent 产品。

Decision：下一轮以真实 AI 工作流和面板体验为主线。fake AI 保留为 CI/stub；真实 openai-compatible 模型、真实上下文 refs 和更强 panel 监督体验成为产品验证中心。

Consequences：实现会更贴近产品，但必须继续保持 no-leak、配置边界、只读权限和测试稳定性；不能用“真实 AI”作为绕过 Guard / ToolCenter / Observation 安全投影的理由。
