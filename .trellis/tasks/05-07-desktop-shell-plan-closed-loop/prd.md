# Desktop Shell 任务入口与 Plan 闭环可视化

## Goal

将已提交的 fake-AI 最小闭环接入桌面工作台入口，让产品主线在面板中以 Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits 呈现，并保持旧 `/api/underground/*` 兼容路径不回归。

## Requirements

* 同步当前任务状态与开发口径：`docs/任务看板/看板.md` 中 05-07 任务应反映已提交/完成事实；相关 Trellis spec/看板不得继续把 ADR-0018、Direction Handoff Package、Underground Center 当作当前事实源。ADR-0018 只能作为历史上下文。
* 在现有 panel server 增加首选 Desktop Shell API：
  * `POST /api/desktop/runs`
  * `GET /api/desktop/runs/:runId`
  * `GET /api/desktop/runs/:runId/stream`
* 新 Desktop Shell API 复用现有 job store、SSE、transcript 机制；旧 `/api/underground/*` 路径继续兼容。
* Desktop run 默认 fake AI，调用现有 `runMinimalLoop()` 完成 Task Soil -> Underground -> Plan Package -> Aboveground -> Fruit -> RunMemory/ExperienceCandidate/PathBias。
* Desktop run 默认不得触发网络调用；`openai-compatible` 必须显式选择且配置完整；`aiMode=none` 必须返回失败或边界状态，不得产生 approved Plan。
* `PanelRunJob` 增加 `runKind: "desktop" | "underground"`；旧 underground 路径写入 `underground`，新 desktop 路径写入 `desktop`。
* 新增 Main Canvas 派生读模型，统一命名为 `canvas`。它只能从 `MinimalLoopResult`、Observation Snapshot、tracking、transcript 派生。
* `canvas` 必须包含：
  * Task Soil 摘要：目标、context refs、permission boundary refs。
  * Plan 摘要：Plan Package ref、status、推荐方向/一句话理由、关键 evidence refs、不确定性。
  * Aboveground 摘要：执行 consumer、task/artifact/verification。
  * Fruits 摘要：fruit、run memory、experience candidate、path bias 候选。
* `canvas` 不得包含 runtime/store 引用、raw prompt、raw provider response、hidden reasoning、raw tool output、API key/token/secret。
* Panel UI 默认呈现 Desktop Shell 工作台：中央主画布展示输入后的 Plan/Fruit 结果和一层解释；右侧 Observation Panel 保持 Agent Run Tree、delegation、parent synthesis、model/tool refs、budget/trace。
* 主画布解释结果为何合理；Observation Panel 解释 agent 集群如何形成结果。
* 保留旧地下-only 兼容功能；EventLog JSON 不作为主画布主内容。

## Acceptance Criteria

* [ ] Desktop API async fake run 返回 `canvas.taskSoil`、approved Plan、Aboveground artifact、Fruit。
* [ ] `aiMode=none` 不产生 approved Plan。
* [ ] `openai-compatible` 缺配置时不调用 provider fetch。
* [ ] `canvas`、tracking、transcript、SSE 不泄漏 raw prompt、raw provider response、hidden reasoning、raw tool output、secret。
* [ ] 旧 `/api/underground/*` 兼容路径不回归。
* [ ] UI/read model 测试确认中文 Desktop Shell 工作台、Plan/Fruit 主画布、Agent Run Tree inspector。
* [ ] 最终至少运行 `pnpm build`、`pnpm test`、`pnpm demo`、`pnpm panel:smoke`、`pnpm panel:desktop:smoke`、`git diff --check`。

## Definition of Done

* 实现范围限制被遵守：不改 `package.json`、`tsconfig`、Electron 启动方式；不引入 React/Vite/新前端链路；不写 repo-root `.agentarbor` 运行资产。
* 新增代码和 UI 文案使用 Desktop Shell、Task Soil、Plan、Plan Package、Aboveground Execution Runtime、Fruits；`direction_handoff.*` 仅作为 legacy event key/兼容类型存在。
* 测试覆盖 API、读模型、SSE/泄漏边界、旧路径兼容和 UI 主画布/右侧观察面板。
* 文档、任务看板和 Trellis spec 中的当前事实源统一到 ADR-0022。

## Technical Approach

复用现有 panel server job store、SSE、transcript 与 `runMinimalLoop()`，在 API 层新增 Desktop Shell 首选入口并用 `runKind` 明确区分语义。新增 `canvas` 作为面板主画布读模型，由最小闭环结果与安全观察投影派生，避免将事件日志或 provider 原始材料直接暴露给用户。UI 保持现有无新框架路线，在当前 panel assets 中调整 Desktop Shell 默认工作台布局。

## Out of Scope

* 不扩展 Underground 内部智能。
* 不实现完整 Governance、多层递归 Agent Fabric 或真实模型质量优化。
* 不改变 Electron 启动方式、构建链路或前端框架。
* 不创建 `.agentarbor` repo-root 运行资产。

## Technical Notes

* 当前产品架构事实源：`docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md`。
* 必须遵守工作台界面、Agent 集群运行结构、Plan Package 与执行计划相关开发指南。
* 必须遵守 backend observation/read-model 与 frontend component/quality 指南。
