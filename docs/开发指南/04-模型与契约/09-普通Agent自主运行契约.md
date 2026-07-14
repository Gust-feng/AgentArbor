# 普通 Agent 自主运行契约

## 定位

普通 Agent 是当前默认桌面会话的执行内核。它负责在一次用户消息中装配会话上下文、调用模型、执行授权工具、把工具结果回传模型，并在模型不再请求工具时形成可见回答。

普通 Agent 是线性会话驱动能力，而不是任务驱动 runtime。它按 conversation 时间线消费上一轮运行历史、本轮用户消息、上下文引用、工具结果和确认决定；它不创建、推进或裁决独立任务生命周期。后续 deep / Agent 集群才承担任务驱动的目标成形、多路探索、Plan 交接和执行组织。

普通 Agent 的核心形态是自然 provider-stop ReAct 循环：模型在每一轮基于当前运行上下文决定是否行动、调用哪些可见工具、如何解释工具结果，以及何时停止。Runtime / harness 只提供可调用世界、执行工具、记录事件和保护边界，不额外发明内部完成仪式，也不把固定阶段机伪装成 agent 思考。

本契约只约束普通 Desktop Agent。Underground、Work Session、结构化计划生成等未来或专用路径可以有自己的停止语义，但不能反向污染普通 Agent。

## 根原则

1. **完成权属于模型的行动选择。** 模型响应中没有工具调用，表示模型停止继续行动；Runtime 将该响应作为最终回答。
2. **工具调用表示继续工作。** 模型响应中有工具调用时，Runtime 执行授权工具，把工具结果追加回模型上下文，然后继续调用模型。
3. **工具选择权属于模型。** 在本轮可见工具集合内，模型自由决定调用什么工具、调用顺序和是否继续调用；Runtime 不能用关键词、模板阶段或固定流程替模型选择工具。
4. **Runtime 不替模型判断答案质量。** Runtime 不能根据关键词、证据数量、文本长度或工程规则判断“还没答完”或“应该总结”；它只观察模型是否继续调用工具。
5. **普通路径不设置行动轮次上限。** 不考虑用户中止、provider 失败、上下文硬溢出、进程失败等外部硬边界时，模型必须可以一直调用工具并继续工作，直到它自己不再调用工具。工具次数或模型轮次不能成为普通 Agent 的产品能力边界。
6. **工程边界不负责思考。** ToolCenter、权限、命令确认、上下文窗口管理、审计、取消和恢复属于工程边界；目标理解、是否继续探索、是否调用工具、工具取舍和最终表述属于模型行动选择。当前阶段能力优先，不用摘要、投影或固定规则限制普通回答和工具结果回传。

## 运行入口

普通 Desktop Agent 通过 `AgentTurnRuntime.execute` / `resume` 进入标准模型-工具-模型循环。调用 feature 显式传入自己的停止与结果映射语义；Runtime 不再提供 Ordinary 专用方法名，也不内置普通 Agent 的完成工具或业务状态。

`execute` 的模型可见工具只包含本轮授权后的外部能力工具：

```text
ToolCenter.list()
  -> allowedTools / capability policy / task soil permissions
  -> model request tools
```

普通 Agent 路径不得注入内部完成工具，也不得把内部控制工具放入 ToolCenter、工具市场、MCP 或外部审批链。

## 标准循环

```text
assemble context
while not cancelled:
  call model with conversation messages and external tools

  if provider failed:
    return failed/model_failed

  if response has no tool calls:
    return completed(final assistant output)

  execute requested external tools through ToolCenter

  if approval is required:
    return approval_required with pending confirmation

  if context window approaches the model hard limit:
    compact earlier context through the model and continue

  append assistant tool calls and tool results
  continue
```

如果一次模型响应同时包含文本和工具调用，工具调用优先表示“继续工作”。文本可以作为该轮 assistant tool-call message 的内容保留，但不能被 Runtime 提升为最终回答。

模型没有义务为每次工具调用生成解释文本。若模型自然输出了行动说明，前端将它作为普通 assistant message 展示；工具自身只返回执行事实，前端不得再构造“为什么调用工具”的伪解释。

## 工具边界

模型在可见工具集合内拥有选择自由，但工具选择自由不等于工具执行无边界。所有外部能力工具必须始终经过：

- `ToolCenter.execute`。
- `allowedTools` 与 capability policy 裁剪。
- confirmation 规则。
- 参数、路径、网络、命令和工作区边界检查。
- 普通开发工具结果回传。
- tool event 审计。

ToolCenter 是工具执行的统一入口，但不是 `allowedTools` 的唯一防线。AgentTurnRuntime / tool-use-loop 必须在进入具体执行 broker 前先按本轮 `allowedTools` 拦截未授权工具；ToolCenter 和 adapter 可以重复校验与命令确认，但只能返回执行事实，不能生产模型或 UI 投影。模型可以决定“要不要调用某个已暴露工具”，但不能绕过 ToolCenter 获得未授权工具、未裁剪参数、未确认的命令执行或未记录审计事件。工具失败、拒绝、取消和确认等待都应以标准结果回传模型，让模型基于真实工具世界继续判断。除用户显式中止或外部系统硬失败外，这些结果不应终止普通 loop。

工具结果回到模型时，应优先提供足以继续开发判断的真实内容。前端展示同一工具调用事实的紧凑视图即可，不要求工具生成解释性文本，也不得用 UI 标题、摘要或固定建议替代模型消息、正文、stdout/stderr、文件片段或错误信息。

## 停止语义

Ordinary 对 `execute` / `resume` 技术结果的映射为：

- `completed/no_tool_calls`：首轮无工具调用，模型直接给出最终文本。
- `completed/completed`：至少执行过一轮工具，随后模型无工具调用并给出最终文本。
- `approval_required/approval_required`：工具需要用户确认，等待 matching confirmation id。
- `interrupted/external_boundary`：用户中止、provider 失败、上下文硬溢出、进程失败或其他外部硬边界打断 loop。该状态不是完成，也不是普通产品能力边界。
- `cancelled/cancelled`：用户或系统中止。
- `failed/model_failed`：provider 失败或响应不可用。

普通 Agent 不应使用 `maxModelRounds` 或 `maxToolRounds` 作为正常运行边界。默认 Desktop Agent 的 `AgentDefinition.turnPolicy` 不得携带模型轮次或工具轮次上限；旧结构化路径、测试桩或专用 agent 可以有显式预算，但这些预算不能流入默认普通 Desktop Agent 的产品主线。若底层自主 loop 仍接收到显式保护阀，它只能作为异常防护并返回未完成的 paused / blocked 结果，不能合成 completed、不能成为普通验收路径、常规暂停 UX 或模型能力上限。

普通 Agent 的输出预算应来自模型能力解析结果或用户显式配置。模型能力解析必须先按用户选择的协议得到基线能力，再叠加内置模型目录和用户 override；没有命中内置模型目录时只能使用协议基线的保守窗口与输出上限，不能把自定义 OpenAI-compatible / Responses 模型降级为“不支持工具”的未知类型。长回答、报告、代码解释和多步结果应由模型能力、上下文窗口、用户要求和运行边界共同决定。

普通 Agent 也不应默认给每次模型请求套固定短延迟预算。用户取消、进程中止、provider 自身超时和外部网络失败是硬边界；普通任务的耗时上限应来自用户明确要求、运行环境策略或 provider 真实失败，而不是前端体验层预设的固定秒数。

用户可见暂停文案必须使用产品语言，例如：

```text
运行被外部边界中断，任务没有完成。你可以继续发送消息让我接着处理。
```

可见文案不得泄漏 `loop`、`provider`、`raw prompt`、内部 request id、内部 fuel 名称或底层状态机细节。

## 上下文装配

上下文管理属于 Context Pack 装配面和模型请求前置维护，不能成为普通 loop 的停止条件。模型上下文窗口是物理边界：达到压缩阈值时，应使用模型进行安全压缩，保留目标、最近对话、工具证据和未完成事项，然后继续 loop。

装配规则：

- 当前用户消息必须保留在最后。
- 最近对话轮次优先保留原始 `user` / `assistant` role。
- 更早历史可以压缩为上下文摘要。
- Token 统计必须来自模型能力目录或专用 tokenizer / provider 计量能力，且覆盖正文、工具调用参数、协议扩展和附件元数据；本地无法精确计量的二进制附件必须预留保守预算，provider 仍是最终计量边界，不能用字符数粗略估算作为最终裁剪依据。
- 达到模型上下文阈值时优先进行 AI 压缩；只有压缩失败且外部硬边界无法恢复时，才能中断运行。
- 超预算时优先压缩旧历史或旧摘要，不能丢系统边界、当前用户消息和必要工具结果。
- 摘要必须保留继续开发所需的关键事实，不能因为摘要或投影丢失普通回答、工具结果和错误信息。
- 同一次 assistant tool call 与其全部 tool result 是不可拆分的上下文组；压缩要么保留整组，要么把整组交给压缩，不能留下悬空调用或孤立结果。
- 紧邻上一轮 Ordinary run 的工具事件通过统一 reducer 恢复最多 24 组有界事实，包括 input、output、error、截断标记和事件引用；它们作为连续性上下文进入下一轮。被标记为截断、live-only 引用已失效或事实需要刷新时，模型应再次调用原工具，而不是依赖工程层猜测遗漏内容。

普通 Agent loop 内不做任务完成判断。上下文压缩服务于 loop 连续运行，而不是替模型总结任务或决定停止。

## 持久化与恢复

会话持久化由 Panel / Conversation 层负责，`desktop-agent-session` 只消费传入的 `conversationHistory`、`interruptedRunContexts` 和 `priorToolCallContexts`，不直接读取 RuntimeDatabase。

普通会话必须是长期可恢复时间线：今天、明天或一年后继续同一 conversation，都应从数据库恢复运行历史、当前分支和可见状态。用户可以回退到上一轮、前四轮或前五轮对话；回退生成新的当前分支或显式截断当前分支，但不能破坏原始审计记录。

恢复对话时必须区分可复用事实与不可伪造的运行时状态：

- 已完成的用户-助手回合按原 role 恢复。
- 紧邻上一轮 run 已持久化的工具 lifecycle payload 可以作为有界事实恢复；失败或取消 run 的可见进度、停止原因和工具错误也可以作为中断上下文恢复。
- 丢弃未持久化的 provider 私有状态、悬空协议 continuation 和无法证明结果的内部执行对象，不能为了“续跑”伪造 tool call/result 对。
- 恢复的工具事实不是长期记忆，也不替代重新读取文件、网页或外部状态；新鲜度重要时由模型再次调用工具。

恢复审批时仍必须匹配原 confirmation id；不允许因为重新进入 loop 而绕过确认。

## 禁止事项

- 在普通 Agent 路径要求模型调用内部完成工具才能结束。
- 在无工具调用时追加工程提示强迫模型继续。
- Runtime 根据文本质量、关键词、证据数量或上下文长度判断任务是否完成。
- Runtime 用固定阶段、模板流程或关键词路由替模型决定下一步工具。
- 把“模型自由选择工具”解释成工具执行可以绕过权限、审计、命令确认或预算边界。
- 用工具次数、模型轮次、固定阶段或工程预算限制普通 Agent 的正常行动能力。
- 外部边界中断后合成最终答案或把工具摘要冒充最终回答。
- 把上下文压缩、长期记忆治理、deep 派生、Work Session 升级放进普通工具循环内部。
- 让外部工具绕过 ToolCenter、权限裁剪、命令确认或审计。

## 验收边界

- 普通问答无工具调用时直接 `completed`，可见结果来自模型文本。
- 模型可见工具列表不包含内部完成工具。
- 模型可在可见工具集合内自由选择工具；Runtime 不用固定阶段或关键词路由替模型挑工具。
- 工具调用必须经过 ToolCenter、权限裁剪、命令确认和审计。
- 工具调用后，真实工具结果必须回到下一轮模型请求，不能被摘要或投影替代。
- 新一轮会话以及进程重启后，紧邻上一轮已持久化的工具事实、失败和取消进度仍可进入模型上下文，且任何截断都必须显式标记。
- 工具后下一轮无工具调用时 `completed`，答案来自模型最终文本。
- 普通 Agent 不因工具次数或模型轮次达到工程上限而停止。
- 上下文达到阈值时触发 AI 压缩并继续，而不是停止或丢失关键历史。
- 审批暂停和恢复仍要求 matching confirmation id。
- 可见输出优先呈现模型原始表达；工程层不得用关键词规则吞掉普通内容。

普通 Agent 的能力来自模型在清晰、可审计的工具世界里自然行动：需要工具就调用工具，不需要工具就回答并停止。工程实现必须把复杂度放在世界装配、命令确认和可恢复性上，而不是替模型发明额外的完成仪式或输出替代层。
