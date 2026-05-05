# 地下运行面板 IDE 化工作台重构

## Goal

以本轮用户提供的最新 AgentArbor 概念图为视觉与信息架构基准，把本地地下运行面板从“调试型运行页面”重构为低心智负担的 IDE 式工作台。用户看到的主线应是：输入目标、地下组织推进、必要时处理待办、审查方向交接；Rootlet、EventLog、Observation、model/tool refs 等内部概念保留为开发者详情，不再压在首屏。

最新概念图以用户在当前会话中提供的图片为准。旧生成图只保留为思路来源，不再作为实现验收基准。

## What I Already Know

- 用户明确要求撤销当前工作区改动，并以生成图为基础开发。
- 工作区已清理为 git clean 状态后重新创建本任务。
- 用户后续提供了更新概念图，覆盖旧生成图：左侧包含 `土壤 / 地下组织 / 地上组织 / 自动化`，右侧展示待办、上下文和运行状态。概念图只作为布局、层级、视觉气质和产品心智参考，不允许把图中的虚拟任务、固定百分比、虚构待办、固定版本号或示例仓库信息一比一写死为产品数据。
- 当前面板仍位于 `src/app/panel-assets.ts`，由 `src/app/panel-server.ts` 提供静态 HTML/CSS/JS 和本地 API；本任务不引入前端框架。
- AgentArbor 的差异化不是照搬 Trae Solo：Trae 是任务助手，AgentArbor 是“把想法长成方向”的地下组织工作台。
- UI 必须简洁有力，避免把内部运行术语作为用户主界面。

## Requirements

- 首屏使用参考图的简洁 IDE 工作台骨架：
  - 左侧浅灰 sidebar：品牌、主导航、任务列表、用户身份区。
  - 中央白色主画布：空态 headline、能力入口卡片、大输入框。
  - 右侧 inspector：待办、上下文、运行状态。
  - 运行态中央显示地下组织活动流，底部仍有输入框。
- 主 headline 使用 AgentArbor 差异化表达：`把想法长成方向`。
- 副标题表达地下组织职责：`地下组织先理解、探索、收束，再交给地上生长`。
- 空态入口卡片使用四类能力：
  - 网页研究
  - 代码理解
  - 证据整理
  - 方向交接
- 输入框 placeholder：`描述你的目标，地下组织会先把问题想清楚。`
- 左侧主导航必须包含 `土壤`、`地下组织`、`地上组织`、`自动化`，默认高亮 `地下组织`。
- 右侧默认待办区展示真实空态，例如 `暂无待办` / `需要你确认的事项会显示在这里`；只有真实运行产生用户澄清、配置缺失、权限确认或结果审查时，才显示具体待办项。
- 右侧上下文区只能展示真实或保守的上下文状态，例如 `AGENTS.md`、`任务看板`、`开发指南` 这类确实存在的项目入口；不得写死 `36%`、文件数量、仓库授权或竞品调研待办。
- 右侧默认运行状态使用 `准备扎根`，表达输入目标后地下组织将开始工作。
- 底部状态栏展示真实或保守状态，例如 `工具就绪 / 未配置`、`安全模式`、当前运行状态；不得写死不存在的产品版本号。
- 主流程不再把配置中心、EventLog、Observation、模型/工具调试作为首屏大块展示。
- 配置中心必须降级为侧栏或折叠设置入口，仍保留模型与工具配置能力，密钥只显示脱敏状态。
- 运行态必须保留当前后端能力：
  - async run / polling
  - no-AI / fake / openai-compatible
  - provider/tool readiness
  - tracking / transcript / Observation 派生展示
  - 用户澄清 / stopped / failed 状态
  - 方向包结果
- 默认用户视图只展示安全摘要；开发者详情通过右侧 inspector 或底部 details 展示。
- 不展示 API key、token、完整 prompt、provider raw response、hidden reasoning、raw tool output 或未校验模型输出。
- 不新增 React、Vite、Next、Tailwind、组件库、图标库或新测试框架。

## Acceptance Criteria

- [ ] 面板 HTML 首屏包含 `把想法长成方向`、四个能力入口卡片和 IDE 式侧栏 / 主画布 / 右侧 inspector。
- [ ] 用户首屏不再以 `Rootlet 工作区`、`工作流阶段时间线`、`模型调用追踪`、`Observation Snapshot` 作为主区域标题。
- [ ] 概念图里的虚拟任务、固定 `36%`、固定 `需要你确认的 3 项`、虚构 GitHub/竞品/方向模板待办、固定 `v0.8.0-beta` 不得作为静态产品数据写死；没有真实运行时必须使用诚实空态。
- [ ] 运行中骨架显示地下组织活动流、当前阶段、用户待办和右侧运行状态，不空白等待 provider。
- [ ] 完成后中央区域展示方向判断 / 方向交接摘要，调试详情仍可展开查看。
- [ ] 配置中心仍可用，但不占据首屏主内容。
- [ ] 面板默认中文标签测试覆盖新信息架构。
- [ ] `pnpm build`、`pnpm test`、`pnpm panel:smoke`、`git diff --check` 通过。
- [ ] 用浏览器或截图检查桌面宽度无明显重叠，窄屏布局可读。

## Definition of Done

- `src/app/panel-assets.ts` 按参考图重构为简洁 workbench shell。
- `src/app/panel-server.test.ts` 更新默认中文 UI 断言。
- `.trellis/spec/frontend/component-guidelines.md` 和 `.trellis/spec/frontend/quality-guidelines.md` 同步新的面板主界面规则。
- `docs/任务看板/看板.md` 同步当前任务状态。
- 不改变地下运行、AgentTurnRuntime、ToolCenter、CandidatePool、Convergence 或 Handoff 的事实边界。

## Out of Scope

- 不引入正式前端框架。
- 不实现 Aboveground / Fruits / Governance 工作台。
- 不实现历史运行持久化、SSE、WebSocket、登录、多用户或工具市场 UI。
- 不改变面板后端 API 语义，除非为了现有字段安全投影做小型兼容扩展。
- 不写 repo-root `.agentarbor/` 运行资产。

## Technical Approach

- 保持单文件静态资产，但按工作台区域整理 DOM 和 render helpers：
  - app shell / sidebar / main canvas / inspector / bottom details / status bar。
- 使用 CSS 形成 Trae Solo 式的安静布局：浅灰 app 背景、白色主画布、简洁卡片、少量绿色植物学 accent。
- 运行前显示中心空态；运行中切换为 activity feed；运行后切换为 result review。
- 保留现有 async run/polling/summary/tracking/transcript 渲染数据来源，不另造事实源。
- 将内部术语放到 details：
  - `EventLog`
  - `Observation`
  - `model.*`
  - `tool.*`
  - stable ids

## Decision (ADR-lite)

**Context**：用户认可生成图的简洁有力，也明确希望 AgentArbor 在此基础上形成差异化。

**Decision**：第一版不做技术栈迁移，先在当前本地 panel 中落地 AgentArbor 工作台心智：把“地下组织把想法长成方向”作为首屏主线，内部 runtime 详情降级到 inspector / details。

**Consequences**：用户心智负担会明显降低；短期 `panel-assets.ts` 仍承担较多 UI 逻辑，因此本任务必须控制 helper 边界，避免只做 CSS 换皮。
