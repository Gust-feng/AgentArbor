# 地下运行用户面板

## Goal

在开始真实 OpenAI-compatible API 验收前，先建立一个基础的本地用户面板，让用户可以输入目标、选择 AI 模式、启动 Underground Center，并以可读方式观察 EventLog、rootlet 集群、AI 调用、候选池、收束结果和方向交接包摘要。

这个面板不是一次性 smoke 工具，而是未来 AgentArbor 工作台的最小原型。它必须复用现有地下运行 API、Observation Snapshot 和 demo summary，不创建第二套运行事实源。

面板默认语言为简体中文。UI 文本、表单标签、按钮、标题、错误信息和状态标签必须用中文表达；技术事件类型、AI mode、stage id 等稳定 id 可以保留，但必须被中文标签或摘要包裹。面板还必须展示比纯 EventLog 更完整的运行追踪状态：当前 phase / stage / status、按 rootlet kind 的集群状态、按 kind 的模型 requested / completed / failed 计数、按 kind 的候选计数、AI 候选 / fallback 计数、收束结果、方向包校验和配置 / provider 状态。

本任务同时出生最小配置中心：模型 provider 配置、默认 AI 模式和未来运行设置不能散落在 CLI 参数、环境变量或前端状态中。配置中心必须区分普通设置与密钥，前端只能看到脱敏后的配置状态。

## What I Already Know

- 当前仓库没有真实 UI / frontend 代码，`.trellis/spec/frontend/*` 仍是延后声明；本任务将让最小 UI 代码正式出生，因此需要同步补齐最小前端规范。
- 当前工具链是 `pnpm + TypeScript + tsc + node:test`，没有 React/Vite/Next 等前端框架依赖。
- 地下组织已支持：
  - deterministic no-AI 运行。
  - `--ai fake`。
  - `--ai openai-compatible`。
  - 7 步地下-only EventLog。
  - Observation Snapshot 和 demo summary。
- 用户下一步想跑一次真实 API，但在这之前需要一个面向用户的基础面板。
- 用户希望面板作为未来面板原型，并希望 API / provider 等设置进入专门配置中心，后续更多设置也从这里扩展。

## Recommended Direction

采用 **本地 Web 面板 + Node 内置 HTTP server + 最小配置中心**，不引入前端框架和外部依赖。

理由：

- 当前只是 API 验收前的基础面板，不宜提前引入完整前端栈。
- Node 内置 `http` 可以满足本地页面、JSON API 和一次性运行需求。
- 可以复用现有 TypeScript 构建、node:test 和 app 层运行入口。
- 后续如果要做正式工作台，再把这个面板沉淀出的读模型、交互边界和配置中心接口演进为正式前端。
- 配置中心先做本地单用户形态，不做数据库；普通设置和密钥分开存储，HTTP 响应只返回脱敏状态。

## Requirements

- 新增脚本，例如 `pnpm panel`，启动本地面板服务。
- 面板首屏就是运行界面，不做营销页或介绍页。
- 面板作为未来工作台的最小实现，视觉和信息架构应服务真实运行观察，而不是临时 console 包装。
- 面板必须包含：
  - 目标输入框。
  - AI 模式选择：`none`、`fake`、`openai-compatible`。
  - OpenAI-compatible 配置状态提示：base URL、model、API key 是否已配置；不得显示 API key 原文。
  - 配置区：允许查看/更新模型 base URL、model、默认 AI 模式；API key 只允许写入，不允许读回。
  - 启动运行按钮。
  - 运行状态区：中文状态标签，并保留 `pending / running / completed / failed` 技术 id。
  - EventLog 列表：展示中文事件摘要，并保留事件类型 id。
  - rootlet kind / 集群状态 / invocation 状态 / AI model event / candidate count / fallback count 摘要。
  - 按 rootlet kind 的模型 requested / completed / failed 计数。
  - 按 rootlet kind 的候选池计数：total / candidate / accepted / merged / rejected / unknown。
  - convergence outcome、package id/version/status/validation。
  - 当前 Observation phase / stage / event cursor 和 Aboveground `not_started` 状态。
  - 错误摘要，尤其是 provider config failure。
- 面板服务必须只调用现有地下运行 API：
  - no-AI 使用 `runUndergroundDirectionSession`。
  - AI 使用 `runUndergroundDirectionSessionWithIntelligence` 和现有 app composition root。
  - 不绕过 `IntelligenceChannel`、CandidatePool、Convergence Judge 或 Direction Handoff Package validation。
- 默认不触发真实网络。
- 只有用户显式选择 `openai-compatible` 且配置中心中 provider 配置完整时，才允许真实 provider 调用。
- API key 不得进入 EventLog、Observation Snapshot、demo summary、运行响应 JSON、会话、日志或测试快照；模型配置入口是明确例外，可以读回并展示真实模型 API key，便于用户检查本地配置。
- 面板允许展示 **model visible output**：即经过 `outputContract` validation 且符合 `visibleOutput.fieldTypes` 展示策略的 `ModelResponse.structuredOutput` / `textOutput` 安全投影，或由这些输出生成的 rootlet outputs / candidates。这里的可见输出必须按 rootlet kind 展示结构化字段摘要，例如 option 的 summary / tradeoffs / applicability，risk 的 impactScope / severity / mitigation，asset_fit / evidence / constraint / counterfactual 的对应契约字段；字段过长必须截断并标注 truncated。
- 面板仍禁止展示 provider raw response、完整 prompt、hidden reasoning、API key、token、raw sensitive error、runtime/store 引用、未经过 outputContract validation 的模型输出，或 rootlet app parser 会丢弃的候选字段。validation failed、provider failed、parser rejected 或 fallback 时只能展示失败原因、validation 状态、fallback 状态和安全引用，不得当作 approved model output 展示。
- 面板不得写 repo-root `.agentarbor/` 运行资产；如后续需要导出，必须另开显式输出目录任务。

### 配置中心

- 新增配置中心契约和本地实现：
  - 保存模型 provider profile：provider kind、protocol kind、base URL、model、default AI mode、secret ref。
  - 保存密钥时只通过 secret store 写入；普通 settings store 不保存 raw secret。
  - 读取配置时返回 sanitized view。
- 本地存储默认不在仓库内：
  - 优先使用 `AGENTARBOR_CONFIG_DIR`。
  - 未指定时使用用户本地目录，例如 Windows `%LOCALAPPDATA%\\AgentArbor\\config`，其他系统使用等价用户配置目录。
  - 测试必须使用临时目录。
- 第一版 secret store 是 local-dev 形态，不声明为生产级密钥库；后续可替换为 OS credential manager、加密文件或企业 secret backend。
- 配置中心不得成为 Soil、RunMemory、Experience Candidate 或 Capability Asset；它是运行设置来源。

## Acceptance Criteria

- [ ] `pnpm build` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm panel` 启动本地服务并打印 URL。
- [ ] 默认打开面板可以输入目标并跑 no-AI 地下-only session。
- [ ] `fake` 模式能显示 `model.requested -> model.completed` 和 rootlet AI 摘要。
- [ ] 面板默认简体中文；按钮、标题、标签、错误和状态文字不能退回英文主文案。
- [ ] 面板运行结果展示 phase / stage / status、rootlet kind 状态、按 kind 的模型计数、按 kind 的候选计数、AI candidate / fallback、收束结果、方向包校验和 provider 配置状态。
- [ ] 面板可以写入 OpenAI-compatible base URL、model、默认 AI 模式和 API key；刷新后普通配置仍可读取，API key 只能显示 configured 状态。
- [ ] `openai-compatible` 缺少 API key 时在服务端返回配置错误，不访问网络，不泄漏密钥。
- [ ] HTTP JSON 响应不包含 API key / token / 完整 prompt。
- [ ] fake AI 输出能在 HTTP JSON 和 UI 中看到按 rootlet kind 投影的结构化 model visible output 字段。
- [ ] OpenAI-compatible stubbed / fake 响应不泄漏 API key / token / 完整 prompt / provider raw response / hidden reasoning / raw sensitive error。
- [ ] 过长 model visible output 字段会截断并标注 truncated。
- [ ] validation failed 或 app parser 会拒绝的模型输出不会被当作 approved model visible output 展示，只展示失败 / fallback 状态。
- [ ] 配置中心测试证明 raw secret 不进入 settings store、EventLog、Snapshot、summary 或 HTTP 响应。
- [ ] 本地 raw secret 默认只写入用户本地配置目录；测试只能写入临时目录。
- [ ] 面板不进入 Aboveground，不写 repo-root `.agentarbor/`。
- [ ] 基础 UI 在桌面宽度下可读，按钮和文本不重叠。

## Definition of Done

- 新增本地 panel server、静态页面和最小 API handler。
- 新增最小配置中心和 local-dev config / secret store。
- 新增单元/集成测试覆盖 no-AI、fake AI、openai-compatible missing-key / missing-model、安全响应、中文 UI、追踪投影和不写 `.agentarbor`。
- 更新 `.trellis/spec/frontend/` 中必要的目录/质量规范，明确这是未来工作台原型的最小实现。
- 更新 `.trellis/spec/backend/quality-guidelines.md`、必要的 intelligence / observation spec 和 `docs/任务看板/看板.md`。

## Out of Scope

- 不做完整正式前端工作台；本任务只做未来工作台原型的最小运行面。
- 不引入 React、Vite、Next、Tailwind、组件库或状态管理框架。
- 不实现登录、用户系统、历史运行持久化、SSE/WebSocket 实时流。
- 不实现 Aboveground / Fruits / Governance 面板。
- 不保存 API key 到仓库或普通 settings store；允许保存到 local-dev secret store，且必须可被未来 secret backend 替换。
- 不写 repo-root `.agentarbor/`。

## Technical Approach

- 新增 focused config modules，例如：
  - `src/domain/config/contracts.ts`
  - `src/kernel/config/in-memory-config-store.ts`
  - `src/adapters/config/file-system-config-store.ts`
  - `src/app/config-center.ts`
- 新增 app 层本地服务，例如 `src/app/panel-server.ts` 和 `src/app/panel.ts`。
- 使用 Node 内置 `http`、`url` 或标准库；保持无新增依赖。
- 静态 HTML/CSS/JS 可以由 TypeScript 字符串模板或 `src/app/panel-assets.ts` 提供，避免引入构建链。
- HTTP API 建议：
  - `GET /` 返回 HTML。
  - `GET /health` 返回配置状态，不含密钥。
  - `GET /api/config` 返回 sanitized config。
  - `POST /api/config/model-provider` 更新 provider 配置；`apiKey` 只写入 secret store，不读回。
  - `POST /api/underground/run` 接收 `{ goal, aiMode }`。
  - 响应返回现有 `createUndergroundDemoSummary(...)` 的 JSON-safe 结果和 event types。
- 后续真实 API smoke 可以在面板任务完成后，以手动环境变量方式运行。

## Open Questions

- 第一版配置中心的 raw API key 是否允许保存到 local-dev secret file？当前建议允许，但必须存到用户本地配置目录，永不进入仓库、settings store 或 HTTP 响应。

## Decision (ADR-lite)

**Context**：地下组织和智能通道已能运行，但真实 API 验收只靠 CLI 不够直观，用户需要面向人的观察入口；同时未来设置会增多，不能继续散落在环境变量和 CLI 参数里。

**Decision**：第一版做本地 Web 面板原型，用 Node 内置 HTTP server + 静态页面，不引入前端框架；同时出生最小配置中心，普通设置和密钥分离，面板只读取脱敏配置状态。

**Consequences**：可以快速进入真实 API 验收，同时避免过早绑定正式前端技术栈。未来正式工作台可复用 Observation Snapshot、本轮 API 边界和配置中心契约；local-dev secret store 后续可替换为更安全的密钥后端。
