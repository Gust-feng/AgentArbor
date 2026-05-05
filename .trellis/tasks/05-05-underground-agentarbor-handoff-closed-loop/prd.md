# P0: 地下集群 .agentarbor 方向交接闭环修复

## Goal

把当前地下集群从“按事件流水线产出若干候选摘要”修复为“围绕用户任务协同形成可交接 `.agentarbor` 方向包”的真实闭环。用户输入任意自然语言任务后，地下中枢必须先理解任务、拆出地下探索工作流、组织 rootlet / autonomy / convergence / handoff 协作，并最终产出一份与用户任务强相关、内容详细、可由地上集群接管的 Direction Handoff Package。

本任务不是面板美化，也不是继续增加 rootlet 数量。核心是修复地下集群工作流和 `.agentarbor` 交接质量：不能再出现“用户随便输入一个提示词，最后得到毫不相干结果”的情况。

## What I already know

- 用户明确当前开发核心是地下集群，不是面板。
- 地下集群接收用户任务后应实现一个工作流，最后产出详细 `.agentarbor`，作为核心文档转交给地上集群。
- 当前实现让用户失望的关键不是事件不够多，而是任务协同不成闭环、产物和用户输入不相关。
- `docs/` 愿景要求地下中枢完成需求成形、约束提取、证据探索、方向综合和方向交接。
- `docs/开发指南/04-模型与契约/05-方向交接包与GrowthPlan.md` 规定 Direction Handoff 只表达方向、证据、约束和升级条件，GrowthPlan 才是地上执行入口。
- `docs/开发指南/04-模型与契约/06-养料请求与补充契约.md` 规定单个探索 agent / rootlet 输出只能作为候选材料，必须经收束审查后才能进入正式交接材料。
- 当前代码中 `runUndergroundDirectionSessionWithIntelligence()` 只到地下方向交接或 awaiting user，不继续进入地上闭环。
- 当前 rootlet 选择主要依赖关键词，普通中文目标容易只触发 `option` rootlet，导致输出浅、偏、与任务无关。
- 当前 `runMinimalLoop()` 虽然有从地下到治理的 18 事件 demo，但它是 deterministic minimal loop，不是当前地下 AI 集群真实闭环。

## Assumptions

- 第一版 P0 只修复 Underground Center 到 `.agentarbor` Direction Handoff Package 的真实交接质量，不直接实现地上执行闭环。
- `.agentarbor` 在本任务中指 Direction Handoff Package 的文件契约与内容质量；默认仍不写 repo-root `.agentarbor/`，除非调用方显式传入输出目录。
- 地上集群接管所需的 Growth Entry、约束、证据、风险、候选方向和 open questions 必须在包内清晰表达。
- AI 可以参与目标理解、rootlet 工作、自治决策和收束建议，但不能绕过 CandidatePool、Convergence Judge、Handoff Steward 和 package validation。

## Requirements

- 新增或修复地下任务理解阶段：
  - Intent Core 不能只靠关键词粗略分类。
  - AI 模式下必须形成结构化 Task Intent / Goal Profile，至少包含 clarified goal、non-goals、acceptance criteria、constraints、risks、unknowns、domain concepts 和 expected `.agentarbor` sections。
  - 如果模型输出无法和用户原始目标建立足够关联，必须失败、降级或请求澄清，不能继续产出无关方向包。
- 新增或修复地下工作流规划阶段：
  - Growth Governor / Autonomy Core 必须根据 Task Intent 生成地下探索工作流，而不是固定一轮 rootlet。
  - 工作流应明确每个 rootlet / agent 的职责、输入、预期输出、退出条件和 source refs。
  - 简单任务可以少量 rootlet，但复杂或模糊任务必须自动触发风险、证据、约束、反驳和资产适配等必要探索。
- 新增或修复 rootlet 协同质量：
  - 每个 rootlet 输出必须带与用户任务相关的 claim / evidence / risk / option / constraint 内容。
  - rootlet 输出不能只生成模板句或 fake placeholder。
  - tool/search/read 可用时，证据类 rootlet 应优先获取信息；工具不可用时必须明确 no-provider / fallback，而不是编造事实。
- 新增或修复收束质量：
  - CandidatePool 必须保留候选来源、候选类型、任务相关性和证据引用。
  - Convergence Judge 必须显式判断候选是否和用户目标相关，不相关候选必须 rejected。
  - Handoff Steward 只能从 accepted / merged 且相关性通过的候选生成方向包。
- 产出详细 `.agentarbor` Direction Handoff Package：
  - `direction.md` 必须包含清晰任务理解、推荐方向、采用理由和地上接管说明。
  - `options.json` 必须包含多个方向或明确说明为什么只有一个方向。
  - `decision-record.md` 必须解释保留、合并、淘汰、请求用户确认的依据。
  - `constraints.json` 必须区分已确认 ConstraintRef、候选约束和待确认约束。
  - `soil-refs.json` 只能引用 Soil，不复制 Soil 正文。
  - `evidence-index.md` 必须列出证据、模型调用、工具调用、rootlet 输出和收束引用。
  - `risk-register.md` 必须说明风险来源、影响、阻断等级、缓解方式和是否需要用户确认。
  - `open-questions.md` 必须列出未决问题、阻塞等级和地上是否允许继续。
  - `escalation-rules.md` 必须说明哪些情况需要用户确认、治理复核或 Nutrient Request。
  - `growth-entry.json` 必须给地上集群提供可接管入口、建议运行形态、验证门和 Nutrient Request 触发点。
  - `handoff.meta.json` 必须记录状态、版本、source goal、source candidates、convergence review 和 validation。
- 新增相关性验收门：
  - 任意用户目标生成的包必须保留原始目标、澄清目标和至少一个与目标关键概念匹配的方向。
  - 明显无关输出必须让 validation failed，不能以 approved 包交给地上集群。
- 保持架构边界：
  - 地下集群不生成 GrowthPlan。
  - `.agentarbor` 不保存最终资产，不替代 Soil。
  - ToolCenter / ResearchRuntime 仍保持独立集成中心，地下 agent 只消费能力。

## Acceptance Criteria

- [ ] 输入“帮我做一个会议纪要整理 agent，需要读取会议文本、提取行动项、生成待办并保留证据”时，输出 `.agentarbor` package 的 direction / options / risks / constraints / evidence 都围绕会议纪要任务，不出现无关方向。
- [ ] 输入一个很短的提示词，例如“做个客服质检 agent”，地下集群会先形成合理澄清目标和 open questions；如果关键信息不足，包应为 awaiting_user 或含明确 non-blocking assumptions，不能编造详细业务事实。
- [ ] 普通中文复杂目标不再只触发 `option` rootlet；必要时自动触发 risk / evidence / constraint / counterfactual / asset_fit 探索。
- [ ] AI rootlet 输出为模板、空泛、和目标不相关时，Convergence Judge 必须 reject 或 request clarification。
- [ ] approved Direction Handoff Package 必须通过新增“目标相关性 + 文件内容完整性”validation。
- [ ] 显式 output directory 运行时可写出完整 Direction Handoff Package 文件集；默认运行仍不写 repo-root `.agentarbor/`。
- [ ] Panel / CLI / summary 至少能展示 `.agentarbor` 包是否可交接、哪些文件生成、validation 是否通过、失败原因是什么。
- [ ] 现有安全边界不回归：不泄漏 API key、raw prompt、raw provider response、raw tool output、隐藏推理或 Soil 正文。

## Definition of Done

- `pnpm build`
- `pnpm test`
- `pnpm panel:smoke`
- `pnpm panel:desktop:smoke`
- `python .\.trellis\scripts\task.py validate .trellis\tasks\05-05-underground-agentarbor-handoff-closed-loop`
- `git diff --check`
- 任务看板同步当前 P0 主线，避免继续把面板任务当成产品主线。

## Out of Scope

- 不实现地上集群完整执行闭环。
- 不实现正式 AgentApp 工程生成。
- 不把动态 rootlet 或本次运行经验直接沉淀为 Capability Asset。
- 不默认写 repo-root `.agentarbor/` 运行资产。
- 不引入新包管理器、前端框架、LLM SDK 或测试框架。

## Technical Notes

- 可能影响：
  - `src/app/underground-direction-session.ts`
  - `src/app/underground/cluster/*`
  - `src/app/underground-intelligence.ts`
  - `src/app/underground/intelligence-*`
  - `src/app/underground-convergence.ts`
  - `src/app/minimal-direction.ts`
  - `src/domain/agentarbor/direction-handoff-package/*`
  - `src/domain/underground/*`
  - `src/app/panel-run-read-model.ts`
  - `src/app/panel-server.ts`
- 必须对齐：
  - `docs/开发指南/02-核心闭环/01-目标驱动元循环.md`
  - `docs/开发指南/02-核心闭环/02-智能体应用孕育闭环.md`
  - `docs/开发指南/03-系统架构/04-Agent集群运行结构.md`
  - `docs/开发指南/04-模型与契约/05-方向交接包与GrowthPlan.md`
  - `docs/开发指南/04-模型与契约/06-养料请求与补充契约.md`
  - `.trellis/spec/backend/intelligence-channel.md`
  - `.trellis/spec/backend/tool-runtime.md`
  - `.trellis/spec/backend/observation-read-model.md`
  - `.trellis/spec/backend/quality-guidelines.md`
