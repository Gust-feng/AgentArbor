# P1：面板流式 Agent 工作流重构

## Goal

把面板主体验从“模板化工作台 / 运行仪表盘”改成“实时 Agent 工作流”。用户提交目标后，主画面只关注模型正在做什么、工具正在做什么、最终产出了什么。现有 Electron 桌面壳继续作为承载入口，但本任务不再继续修壳，而是重构 panel 的核心交互和读模型。

## Requirements

- 新建独立主线，不继续塞进 `panel-desktop-shell`。
- 面板首屏去模板化：移除默认能力卡片、固定状态块、模板化右侧 inspector 主导结构。
- 主画面改为实时 transcript：用户目标、Agent 工作笔记、模型输出增量、工具调用事件、最终结果。
- 设置、模型配置、工具配置、EventLog、Observation、rootlet / CandidatePool / Convergence 等内部细节全部降级到折叠调试区。
- `POST /api/underground/runs` 继续创建 run。
- 新增 `GET /api/underground/runs/:runId/stream?cursor=<lastSequence>`，返回 `text/event-stream`。
- 保留现有 polling GET 作为 fallback / 测试入口。
- 新增安全流式事件读模型：
  - `run.started`
  - `agent.note.delta`
  - `agent.note.completed`
  - `model.output.delta`
  - `model.output.completed`
  - `tool.requested`
  - `tool.completed`
  - `tool.failed`
  - `final.result`
  - `run.failed`
- `PanelRunTranscript` 改为以 stream events 派生；summary / tracking 只做折叠详情，不再主导首屏。
- OpenAI-compatible adapter 支持 stream response chunks，转成 `model.output.delta`。
- Fake provider 增加 deterministic streaming fixture，方便测试。
- 不支持 streaming 的 provider 走兼容路径：仍推送 agent/tool/run 事件，模型输出在 completed 时一次性进入 transcript。
- CandidatePool、Convergence、Direction Handoff validation 仍是正式事实边界；流式文本不能绕过候选池、收束和 handoff validation 成为正式输出。

## Public Interfaces

新增 `PanelRunStreamEvent`，字段至少包含：

- `eventId`
- `runId`
- `sequence`
- `type`
- `createdAt`
- `agentLabel?`
- `summary?`
- `delta?`
- `status?`
- `toolName?`
- `sourceRefs`
- `modelCallRefs`
- `toolCallRefs`

新增 `PanelRunStreamCursor`：

- `runId`
- `lastSequence`

新增 SSE route：

- `GET /api/underground/runs/:runId/stream?cursor=<lastSequence>`
- 返回 `text/event-stream`
- 支持断线后按 sequence 续传。

## Acceptance Criteria

- 默认首屏不再出现能力卡片模板文案：`网页研究`、`代码理解`、`证据整理`、`方向交接` 不作为主画面固定卡片。
- 默认首屏包含目标输入和空的 Agent transcript 区。
- 运行中 transcript 能追加模型输出、工具事件和最终结果。
- run 创建后 stream endpoint 返回 `text/event-stream`。
- fake streaming provider 产生多个 `model.output.delta`。
- cursor 续传不会重复旧事件。
- stream 断开不影响后台 run 完成。
- stream / transcript 不包含 API key、token、完整 prompt、hidden reasoning、raw provider response、raw tool output。
- tool completed 只展示安全摘要和 refs。
- polling route 继续可用。
- no-AI / fake AI / openai-compatible 缺配置路径不回归。
- Electron 桌面壳继续可启动面板。

## Definition of Done

- `pnpm build`
- `pnpm test`
- `pnpm panel:smoke`
- `pnpm panel:desktop:smoke`
- `python .\.trellis\scripts\task.py validate .trellis\tasks\05-05-panel-streaming-agent-workflow`
- `git diff --check`

## Out of Scope

- 不展示 provider hidden reasoning、完整 prompt、raw provider response、raw tool output、API key 或 token。
- 不引入 React/Vite/Next/Tailwind。
- 不改变地下组织正式收束、handoff validation 或工具权限边界。
- 不继续做 Electron 打包、安装器或桌面壳产品化。

## Assumptions

- 用户要看的“模型思考”定义为模型显式输出的可见工作笔记、推理摘要、依据、取舍和下一步动作，不展示供应商 hidden reasoning。
- 第一版仍用当前静态 HTML/CSS/JS 面板。
- 真正 streaming 优先覆盖 OpenAI-compatible 和 Fake provider；其他 provider 后续按 adapter 能力逐个扩展。
