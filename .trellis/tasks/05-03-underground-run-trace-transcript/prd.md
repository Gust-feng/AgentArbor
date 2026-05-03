# 地下运行可观察 Trace Transcript

## Goal

把本地地下运行工作台从“单次请求完成后刷新”推进到“可观察运行 / Agent Transcript”。用户启动一次真实需求的地下-only 运行后，页面应立即进入运行态，通过轮询看到事件游标、等待点、模型调用状态和各链路 agent 的可审计工作笔记；完成后展示最终 summary、observation、tracking 与方向包结果。

## Background

- 上一提交 `ab6de6e feat: 增加地下运行工作台` 已经让用户用真实 OpenAI-compatible API 跑通地下-only 流程。
- 真实模型运行耗时较长，现有面板在请求完成前只能显示骨架。
- 用户希望观察 Intent Core、Growth Governor、Rootlet Agents、Convergence Judge、Handoff Steward 等链路的可审计进展。

## Non-Negotiable Boundaries

- 不读取、不打印、不泄漏 raw API key/token。
- 不触发真实网络测试；所有测试使用 fake/stub。
- 不展示隐藏思维链。Transcript 只能是可审计工作笔记：观察、动作、产出、依据、下一步、引用。
- 不引入 React、Vite、Next、Tailwind、组件库或新依赖。
- 不写 repo-root `.agentarbor`。
- 面板仍只做 Underground，不进入 Aboveground、Fruits、Governance。
- 默认无网络；OpenAI-compatible 仍只能在显式完整配置后触发。

## Requirements

### Backend Panel API

- 新增 `POST /api/underground/runs`：
  - 立即返回 `runId`、初始 `status`、脱敏后的 config、初始 trace/transcript。
  - 不能阻塞到地下运行完成。
- 新增 `GET /api/underground/runs/:runId`：
  - 返回当前 `status`、event cursor、tracking、transcript/workNotes。
  - 运行中可返回 partial events 与 partial transcript。
  - 完成后包含完整 summary、observation、tracking 和最终方向包/结果。
- 保留现有同步 `POST /api/underground/run` 兼容测试与现有 panel smoke。
- 使用进程内内存 job store；本轮不做数据库、持久历史或跨进程恢复。

### Runtime Observability

- 运行 job 内部应尽量保留 runtime/eventLog 引用，让 polling 在模型请求期间看到已发布事件。
- 目标 partial events 包括但不限于 `goal.received`、`underground.exploration_planned`、`rootlet_cluster.started`、`model.requested`。
- 本轮只做 HTTP polling，不做 SSE/WebSocket。

### Agent Transcript

- 新增 JSON-safe read model：`AgentWorkNote` / `PanelRunTranscript`。
- 建议字段：
  - `noteId`
  - `agentId`
  - `agentLabel`
  - `stage`
  - `status`
  - `summary`
  - `detail`
  - `evidenceRefs`
  - `eventRefs`
  - `candidateRefs`
  - `modelCallRefs`
  - `createdAt`
- Transcript 从 EventLog + summary/observation 派生，不成为事实源。
- 展示 Intent Core / Growth Governor / Rootlet Agents / Convergence Judge / Handoff Steward 的工作笔记。
- 模型调用只展示脱敏目的、rootlet kind、状态、模型名、candidate refs；不展示完整 prompt、raw model output 或 secret。

### Panel UI

- 点击启动后改为先 start run，再每 1-2 秒 poll。
- 页面显示实时事件 cursor、当前等待点、agent transcript、模型调用状态。
- 完成后展示最终 summary/tracking/方向包。
- 保持简体中文工作台结构。

### Tests

- async start 返回 `runId` 且不阻塞到完成。
- polling running/completed 状态可返回 partial/final event cursor。
- fake AI run 的 transcript 包含 rootlet/model/convergence/handoff notes。
- transcript 不包含 API key/token、完整 prompt、raw model output。
- 现有 panel sync API、config API、no-AI/fake/missing config 测试不回归。

### Documentation

- 更新 `.trellis/spec/backend/observation-read-model.md` 或相关 panel/backend spec，记录 panel run job 和 transcript 是派生读模型。
- 更新 `.trellis/spec/frontend/component-guidelines.md`，记录 polling + transcript UI。
- 更新 `docs/任务看板/看板.md` 指向当前任务。

## Acceptance Criteria

- [ ] `POST /api/underground/runs` 在运行完成前返回 `runId` 和初始状态。
- [ ] `GET /api/underground/runs/:runId` 可在 running 阶段返回 partial event cursor、tracking 和 transcript。
- [ ] fake AI 完成态 transcript 至少包含 rootlet/model/convergence/handoff 相关工作笔记。
- [ ] Transcript 响应不包含 API key/token、完整 prompt 或 raw model output。
- [ ] 现有同步面板接口保持兼容。
- [ ] 面板 UI 在运行中可观察事件进度、等待点、模型状态和 agent 工作笔记。
- [ ] 相关 backend/frontend spec 和任务看板已更新。

## Definition of Done

- `pnpm build`
- `pnpm test`
- `pnpm panel:smoke`
- `git diff --check`
- 新任务 validate

## Out of Scope

- SSE/WebSocket。
- 持久化运行历史、数据库或跨进程恢复。
- Aboveground/Fruits/Governance 入口。
- 真实 OpenAI-compatible 网络测试。
- `.agentarbor` 运行时资产或 repo-root `.agentarbor` 写入。
- 新前端框架、构建系统、组件库或依赖。

## Technical Notes

- 当前任务目录：`.trellis/tasks/05-03-underground-run-trace-transcript/`。
- 任务实现需遵守 backend/frontend spec，尤其是 observation read model、intelligence channel、质量规则和前端组件指南。
- OpenAI-compatible 配置必须继续脱敏；测试只能通过 fake/stub 覆盖模型调用状态。
