# 地下动态派生 Agent 与监督面板

## 项目背景

当前 Underground 已经完成 7 个固定 agent 的 AI reasoning 主线，但 `UndergroundAgentOrchestrator` 仍按固定顺序推进。下一步目标不是继续增加固定 agent class，而是让地下中枢具备动态派生同能力子 agent 的运行时能力：父层 agent 通过 AI 决定派生谁、给什么上下文、允许什么工具、分配多少预算、何时等待/打断/继续/停止，并负责回收、质疑、综合和裁决。

面板同步升级为监督式 agent workflow：重点展示主 agent、派生 agent、运行树、模型/工具事件、父层综合和最终交接，不复制 Codex 的 Git worktree、diff 或终端功能。

## 开发目标

1. 建立 Underground 专属 Agent Fabric 契约：
   - `AgentSpec`
   - `DelegationDecision`
   - `ChildAgentRun`
   - `AgentRunTree`
   - `ParentSynthesisResult`
   - 同一套 `AgentLoop + AgentTurnRuntime + ToolCenter + WorkspaceView + Mailbox + Guard + Trace` 可以由不同 spec / prompt 派生。

2. 地下中枢动态派生：
   - 保留现有固定核心 agent 作为内置 spec。
   - `GrowthGovernor` 可通过 AI 输出 rootlet / child agent 派生计划。
   - `AutonomyReviewer` 可决定继续派生、等待、停止、请求用户或请求收束。
   - `ConvergenceJudge` 只能消费父层 synthesis 后的材料，不能让单个 child/rootlet 输出直接进入 handoff。

3. 子 agent 信任边界：
   - child/rootlet 只产出局部材料、证据 refs、失败条件、不确定性和 confidence。
   - `.agentarbor` 只能消费 `ParentSynthesisResult` / `ConvergenceReport` / `HandoffSteward` 的父层收束结果。
   - Guard 只守 schema、权限、预算、hard constraint、脱敏、包结构和文件边界。

4. 面板监督台：
   - 左侧保留 run/thread 列表。
   - 中间主 transcript 展示用户目标、agent 工作笔记、派生/等待/综合事件、模型输出增量、工具摘要和最终结果。
   - 右侧 inspector 展示 agent run tree、选中 agent 的 spec、输入切片、权限、预算、reasoningTrace、安全 refs 和输出材料。
   - 不展示 raw prompt、raw provider response、hidden reasoning、API key、token 或 raw tool output。

5. 事实源同步：
   - 更新 ADR-0021 和地下中枢开发指南，明确动态派生 Agent Fabric 是地下 AI 主线下一阶段。
   - 更新 `.trellis/spec/` 的可执行契约和 `docs/任务看板/看板.md`。

## 验收标准

- `pnpm build` 通过。
- `pnpm test` 通过。
- `pnpm panel:smoke` 通过。
- `pnpm panel:desktop:smoke` 通过。
- `git diff --check` 通过。
- fake `AgentTurnRuntime` 能驱动动态派生路径，至少覆盖多个 child/rootlet run。
- 无 `AgentTurnRuntime` 时不得产出 `approved_package_created`。
- 单个 child/rootlet 输出不能绕过父层 synthesis / convergence 进入 handoff。
- Panel read model / SSE / transcript 能展示 agent run tree 和 delegation / synthesis 事件，并保持脱敏边界。
- 不新增外部 SDK、不新增包管理器、不引入正式前端框架。

## 实施边界

- 第一阶段只实现 AgentArbor 自己的动态派生运行时，不调用 Codex / Claude 的外部子代理能力。
- 第一阶段不做 Git worktree、diff、终端和 PR 工作流。
- 不创建 `.agentarbor/` repo-root 真实运行资产。
- 不把动态 child agent 写成长期 Capability Asset；它们只是当前地下 run 的临时运行能力。
