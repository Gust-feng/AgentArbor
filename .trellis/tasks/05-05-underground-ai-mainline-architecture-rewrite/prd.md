# 地下 AI 主线架构重构

## Goal

把地下运行主线从“确定性消息流水线 + AI 旁路增强”重构为“AI 驱动的分层 agent 协作主线”。本阶段要建立新的运行骨架：`AgentLoop`、`WorkspaceView`、`Mailbox`、`UndergroundAgentOrchestrator` 作为主线入口，`IntentCore` / `GrowthGovernor` / `CandidatePool` / `ConvergenceJudge` / `HandoffSteward` / `Rootlet` 作为受协议约束的 agent 运行单元，确定性内核只保留为权限、预算、谱系、validation 和 fallback 的 guard。

## What I already know

- 用户已经明确：下一步开发必须围绕 AI 驱动，不能再走局部最优的确定性补丁路线。
- `docs/架构设计/产品架构/ADR-0021-地下Agent集群AI优先架构重构.md` 已经把目标定为“分层 Agent 智能协作 + 确定性边界守卫”。
- 现有运行时里已经有 `AgentTurnRuntime`、`ToolCenter`、`IntelligenceChannel`、`DirectionHandoffPackage`、`radial growth` 和 panel/read-model 投影这些基础件。
- 当前地下实现仍以共享上下文、固定消息推进和兼容 helper 为主，AI 能力还没有成为运行主线。
- 用户明确要求：工程边界只能做 guard，不得替 agent 思考。

## Assumptions

- 第一阶段只建立地下 AI 主线的运行骨架，并把现有地下主流程迁到新骨架上。
- 旧的 deterministic helper 可以保留为迁移期兼容层，但不能继续作为语义主线。
- 默认运行仍不写 repo-root `.agentarbor/`；只有显式输出目录才允许产出方向交接包文件集。
- 不引入新的 LLM SDK、包管理器、测试框架或前端框架。

## Requirements

- 当前阶段的新增执行口径固定为“上层 Agent 语义判断主线 + 确定性边界守卫”：
  - 默认测试不触发真实网络，但必须通过 fake/stub `AgentTurnRuntime` 验证 AI 路径。
  - 无 `AgentTurnRuntime` 只能 stopped / awaiting configuration / 低置信材料，不能产出 approved package。
  - 每个 agent 的语义判断必须进入 `reason()`；`act()` 只负责落地动作、写出材料或保存交接包；`guard()` 只做 schema、预算、权限、hard constraint、脱敏和包结构边界。
  - Fallback 只能作为 AI 失败后的显式低置信材料，标记 `source: "deterministic_fallback"`，不能重新成为默认成功主线。
- 在 `src/app/underground/agents/` 建立 Underground 专属 reasoning helper：
  - 统一调用现有 `AgentTurnRuntime`，不放入 `kernel`，不新增 SDK。
  - 统一记录模型 refs、工具 refs、fallback refs、confidence 和可见 `reasoningTrace`。
  - `reasoningTrace` 只保存可展示的决策摘要、输入引用、模型/工具引用和不确定性；不得保存或要求原始 chain-of-thought。
- Agent 迁移顺序固定为：`IntentCore -> GrowthGovernor -> AutonomyReviewer -> ConvergenceJudge -> RootletExplorer -> HandoffSteward -> CandidateCollector/Panel`。
- `ConvergenceJudge` 必须从 `ai_advisory` 旁路升级为 AI 主裁决路径：
  - 模型决定保留、合并、淘汰、继续探索、询问用户或停止。
  - 确定性逻辑只阻断 hard constraint、非法状态和非法包结构。
  - `convergeMinimalCandidatePool` 只能作为 fallback / 落地辅助，不能继续包住 AI 主判断。
- `HandoffSteward` 的 `.agentarbor` 方向叙事必须由 AI reasoning 组织；确定性序列化和 package validation 保留为边界。
- Panel / read model 需要展示安全 `reasoningTrace` 和 fallback 标记，仍不得回显 raw prompt、raw provider response、hidden reasoning、API key 或 token。
- 引入新的地下运行协议：
  - `AgentLoop` 需要显式包含 observe / reason / act / guard。
  - `WorkspaceView` 必须是只读视图，不能让 agent 直接写共享状态。
  - `Mailbox` 负责 agent 间消息路由，不能被业务逻辑旁路。
  - `UndergroundAgentOrchestrator` 负责执行顺序、消息流转和受控循环。
- 复用现有 `AgentTurnRuntime` 作为 reason 阶段的统一模型/工具回合入口，不直接调用 provider SDK。
- `IntentCore` / `GrowthGovernor` / `CandidatePool` / `ConvergenceJudge` / `HandoffSteward` / `Rootlet` 必须有清晰的 AgentLoop 或兼容适配层，不再只是共享上下文上的函数步骤。
- 主地下入口必须通过新的 orchestrator，而不是继续把 shared context 或线性消息泵当主线。
- rootlet / subagent 输出继续作为未收束材料，必须经过上层 agent 汇总、反驳、裁决和交接。
- 确定性 fallback 只能作为 guard / 低置信度退路，不能伪装成语义完成。
- 相关面板 / 读模型 / 测试只能暴露安全投影，不能回显 raw prompt、raw provider response 或 hidden reasoning。

## Acceptance Criteria

- 代表性的地下用户目标可以经由 `UndergroundAgentOrchestrator`、`AgentLoop`、`WorkspaceView` 和 `Mailbox` 跑通，并产出受 guard 约束的地下结果或方向交接草案。
- fake AI cognitive manager 可以完成稳定运行；no-AI 只能进入 stopped / configuration boundary，不得 approved。
- 已迁移 agent 的 `reason()` 必须能通过 fake `AgentTurnRuntime` 触发模型路径并产出安全 `reasoningTrace`；`act()` 不再承担目标理解、候选排序、继续探索或方向综合。
- Rootlet 输出不能绕过 CandidatePool / ConvergenceJudge / HandoffSteward 父层收束直接进入 handoff。
- Guard 相关测试必须证明 guard 不包含目标理解、候选排序、继续探索或方向综合语义职责。
- 地下主线不再把 shared context 当作唯一协调源；如仍存在兼容层，必须是显式迁移层而不是新主线。
- 至少一个测试覆盖 mailbox 路由，至少一个测试覆盖 guard / fallback，至少一个测试覆盖 agent loop 的 observe / reason / act / guard round。
- 现有地下输出仍满足安全边界和相关性要求，不出现明显无关、模板化或只回显 goal 的主线输出。
- 代码、spec、任务看板和验证结果对齐新的 AI-first 主线。

## Definition of Done

- `pnpm build`
- `pnpm test`
- `pnpm panel:smoke`
- `pnpm panel:desktop:smoke`
- `git diff --check`
- 任务看板同步新主线，避免继续把确定性流水线当作产品主线。

## Out of Scope

- 不实现完整上层地上执行闭环。
- 不在这一阶段彻底删除所有旧 helper / 兼容入口。
- 不创建 repo-root `.agentarbor/` 运行资产。
- 不引入新 provider SDK 或新的前端工作台框架。

## Technical Notes

- 可能影响：
  - `src/kernel/intelligence/agent-turn-runtime.ts`
  - `src/app/underground-agent-cluster-runtime.ts`
  - `src/app/underground/cluster/*`
  - `src/app/underground-intelligence.ts`
  - `src/app/underground-rootlets.ts`
  - `src/domain/underground/*`
  - `src/app/panel-run-read-model.ts`
  - `src/app/panel-server.ts`
- 必须对齐：
  - `docs/架构设计/产品架构/ADR-0021-地下Agent集群AI优先架构重构.md`
  - `docs/开发指南/00-总览.md`
  - `docs/开发指南/03-系统架构/01-系统总览.md`
  - `docs/开发指南/03-系统架构/02-核心模块.md`
  - `docs/开发指南/06-工程实现/03-人工智能与确定性边界.md`
  - `.trellis/spec/backend/intelligence-channel.md`
  - `.trellis/spec/backend/tool-runtime.md`
  - `.trellis/spec/backend/direction-handoff-package.md`
  - `.trellis/spec/backend/underground-radial-growth.md`
  - `.trellis/spec/backend/quality-guidelines.md`
