# 成熟 Agent 协作形态调研：Claude Code / Codex / OpenAI Agents

日期：2026-05-06

## 调研目标

本调研不评估“输出质量怎么变好”，而是观察成熟 agent 工具如何把 agent 做成真正具备智能协作能力的运行体。关注点是：上下文隔离、委托、工具权限、记忆、运行轨迹、守卫、接管关系和多 agent 协作形态。

## 资料来源

- Claude Code subagents：<https://code.claude.com/docs/en/sub-agents>
- Claude Code agent teams：<https://code.claude.com/docs/en/agent-teams>
- Claude Code hooks：<https://docs.anthropic.com/en/docs/claude-code/hooks>
- Claude Code MCP：<https://code.claude.com/docs/en/mcp>
- Codex web / cloud：<https://developers.openai.com/codex/cloud>
- Codex subagents：<https://developers.openai.com/codex/concepts/subagents>
- Codex AGENTS.md：<https://developers.openai.com/codex/guides/agents-md>
- Codex internet access：<https://developers.openai.com/codex/cloud/internet-access>
- OpenAI practical guide to building agents：<https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/>
- OpenAI Agents SDK orchestration：<https://openai.github.io/openai-agents-js/guides/multi-agent/>
- OpenAI Agents SDK handoffs：<https://openai.github.io/openai-agents-js/guides/handoffs/>
- OpenAI Agents SDK tracing：<https://openai.github.io/openai-agents-python/tracing/>
- OpenAI Agents SDK guardrails：<https://openai.github.io/openai-agents-js/guides/guardrails/>

## Claude Code：subagent 是上下文隔离的专职智能单元

Claude Code 的 subagent 不是普通函数，也不是固定 handler。它的关键能力是：

- 独立上下文窗口：下层 agent 可以独立读取大量搜索结果、日志、文件内容，只把摘要返回主会话。
- 独立系统提示词：每个 subagent 用自己的角色、能力、约束和方法论工作。
- 独立工具权限：可通过 allowlist / denylist 限制工具，避免所有 agent 都继承全部能力。
- 可选模型选择：不同 agent 可以使用不同模型或继承主会话模型。
- 可选长期记忆：subagent 可拥有 user / project / local 级记忆目录，积累跨会话经验。
- 生命周期 hooks：subagent 可以在工具前后、停止时触发 deterministic hook，用于权限、格式化、清理或审计。
- 前台 / 后台运行：后台 subagent 可并发工作，但权限必须提前批准；缺少权限时不会无限阻塞主线程。

对 AgentArbor 的启发：

- Rootlet / subagent 必须有独立上下文和工具面，不能只是共享状态里的一个阶段函数。
- 记忆不是全局 SharedContext 字段，而应是 agent 可主动维护、可治理的认知资产。
- hooks / guard 只围绕工具、权限和生命周期，不替 agent 做语义判断。
- 下层 agent 输出应是局部材料；父层 agent 接收摘要和引用，而不是被下层上下文污染。

## Claude Code：agent team 是 lead + 独立会话 + 共享任务/通信

Claude Code 的 agent team 比 subagent 更接近真正的“协作集群”：

- 一个 team lead 负责创建团队、分配任务、协调进度和综合结果。
- teammate 是独立 Claude Code 会话，有自己的 context window，不继承 lead 的完整对话历史。
- 团队有共享 task list，任务可以 pending / in progress / completed，并能表达依赖关系。
- 团队有 mailbox，teammate 可以互相发消息，不必所有信息都经由 lead。
- teammate 可直接被用户/lead 追问、打断和重定向。
- hooks 可以在 teammate idle、任务创建、任务完成时作为质量门或治理门介入。
- 官方明确提醒：team 有协调成本、token 成本和文件冲突风险，适合并行探索、交叉审查、竞争假设和跨层改造，不适合强串行或同文件密集修改。

对 AgentArbor 的启发：

- 地下中枢应该是 lead / manager，不是普通流程节点；它要能分派、等待、追问、打断、合并和重新分派。
- 根须 agent 既要能向上汇报，也要能在受控 mailbox 内横向协作、质疑和补充证据。
- 共享任务表不能替 agent 思考；它只表达占用、依赖、完成状态和交付对象。
- 竞争假设是地下智能的重要机制：多个 rootlet 可以围绕不同理解/路径/风险进行并行探索，再由中枢综合。

## Codex：任务隔离、并行 worker、指令层级和安全边界

Codex 的成熟点主要体现在工程任务执行环境：

- 云任务在独立环境中后台运行，支持并行任务。
- 本地 CLI / IDE / App 都围绕同一类 coding agent 能力：读代码、改文件、跑命令、测试、审查。
- subagent workflow 是显式触发的并行 agent 工作流，主 agent 等待各子 agent 返回后再综合。
- 不同 subagent 可以使用不同模型和 reasoning effort；轻量扫描与复杂推理不应绑定同一运行配置。
- `AGENTS.md` 是层级指令链：全局、项目、子目录逐层合并，靠近工作目录的规则覆盖更早规则。
- Codex Cloud 默认 agent 阶段禁网；setup scripts 可联网，agent internet access 需要按环境开启。
- 网络访问可以配置 allowlist 和 HTTP method 限制，官方明确列出 prompt injection、代码/secret 外泄、恶意依赖和许可证风险。
- Codex App 支持多个 agent 并行、worktree、skills、automation 和 git 工作流。

对 AgentArbor 的启发：

- agent 智能不等于无限权限；越智能越需要运行环境隔离、网络边界、工具权限、审计日志。
- 指令 / 土壤 / 约束需要层级继承和局部覆盖机制，不能靠单个全局 prompt。
- 并行 agent 不应共享可变工作区；每个 agent 或任务应有 workspace / worktree / mailbox 隔离。
- 对外部网络和工具结果的风险处理必须是运行时边界，而不是让 agent “自觉不要被骗”。

## OpenAI Agents：manager、handoff、trace、guardrail 的运行时原语

OpenAI 的 agents 文档把成熟 agent 拆成三类基础：模型、工具、指令；工具分 data / action / orchestration，其中 orchestration 允许 agent 作为另一个 agent 的工具。

多 agent 编排有两个主要模式：

- Manager pattern：一个中心 agent 控制整体工作流，把专职 agent 当工具调用。适合需要一个 agent 汇总结果、保留最终控制权、统一 guardrail 的场景。
- Decentralized handoff：agent 之间转交控制权，接收方接管下一段会话。适合流程路由本身是任务的一部分、不需要单个中心持续控制的场景。

Agents SDK 的关键机制：

- Handoff 作为模型可见的 tool-like 能力，但走 SDK 的 handoff path，而不是普通 function tool。
- Handoff 可带少量模型生成的路由元数据，例如 reason、priority、summary；完整应用状态应放在 RunContext。
- Handoff 默认携带会话历史，也可用 input filter 改变接收方看到的上下文。
- Tracing 默认记录 run、agent、LLM generation、function tool call、handoff、guardrail 等 span。
- Guardrails 分 input、output、tool guardrail；复杂 workflow 中，工具调用级检查需要 tool guardrails，而不是只靠 agent-level 输入/输出检查。

对 AgentArbor 的启发：

- Underground Center 更接近 Manager pattern：父层中枢 agent 应保留综合权和最终语义控制权，rootlet / subagent 更像工具化的智能工作单元。
- Nutrient Request、用户澄清或跨阶段转交才更接近 handoff：此时控制权真的从一个 agent / center 转到另一个 agent / center。
- RunContext / Workspace 负责应用状态；handoff metadata 只放路由理由、优先级和摘要，不能把完整工作空间塞进模型输出。
- trace 必须是 agent 智能的运行骨架，不只是 UI transcript；每次 agent run、工具调用、handoff、guard 都应可追踪。

## 共同模式

成熟系统共同强调的不是“更好的结果模板”，而是智能体运行能力：

1. 独立认知上下文：agent 有自己的上下文窗口、提示词、工具、记忆和运行历史。
2. 权限最小化：每个 agent 的工具权限独立定义，工具调用受批准、allowlist、hook、guardrail 约束。
3. 父层综合：下层 agent / tool 输出作为材料；中心 agent 或 manager agent 保留综合和决策权。
4. 明确接管：handoff 是控制权转移，不是普通函数调用；接收 agent 看到什么上下文必须被控制。
5. 运行轨迹：真正的 agent runtime 要追踪 agent run、工具调用、handoff、guardrail、失败和自定义事件。
6. 环境隔离：并行 agent 应使用独立 workspace / sandbox / worktree，避免共享可变状态污染。
7. 记忆治理：agent 可以拥有长期记忆，但需要 scope、位置、写入规则和治理边界。
8. 守卫不思考：guard / hook / sandbox / schema 负责边界，不负责目标理解、探索取舍或语义综合。

## 对 AgentArbor 下一步的建议

下一步不应继续从 `.agentarbor` 输出质量倒推实现，也不应简单把旧 agent handler 套进 `AgentLoop`。更合理的主线是：

```text
Underground Cognitive Runtime
  -> AgentContext isolation
  -> Agent memory scope
  -> Tool permission surface
  -> Agent trace spans
  -> Parent manager synthesis
  -> Controlled handoff only when control changes
```

建议下一阶段优先实现：

1. `AgentRunContext` 升级：除 Workspace / Mailbox 外，显式加入 tool surface、memory view、trace writer、budget view、constraint view。
2. `AgentCognitiveLoop`：在 `observe -> reason -> act -> guard` 外增加可选 `reflect` 和 `continue/stop` 决策，使 agent 能多轮行动，而不是单次 handler。
3. `ParentAgent` / manager 模式：先让 Underground Center 具备管理 rootlet / subagent 的能力，而不是先迁移所有旧步骤。
4. `AgentTrace`：把 agent run、model turn、tool call、mailbox route、handoff、guard result 作为一等事件，不只给 panel 展示。
5. `AgentMemory` scope：先定义 `none / run / project / soil_candidate` 等作用域和写入权限，不急着把记忆沉淀为 Soil。

关键原则：

- 智能来自 agent 的持续认知循环、上下文隔离、工具使用、反思和父层综合。
- 结果质量是智能运行后的外显，不是当前开发的直接优化目标。
- 确定性工程边界必须保护运行，不得替 agent 完成语义判断。
