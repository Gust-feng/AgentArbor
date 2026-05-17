# 普通 Agent 自主运行契约

## 定位

普通 Agent 是当前默认桌面会话的执行内核。它负责在一次用户消息中装配安全上下文、调用模型、执行授权工具、把工具结果回传模型，并在模型不再请求工具时形成可见回答。

本契约只约束普通 Desktop Agent。Underground、Work Session、结构化计划生成等未来或专用路径可以有自己的停止语义，但不能反向污染普通 Agent。

## 根原则

1. **完成权属于模型的行动选择。** 模型响应中没有工具调用，表示模型停止继续行动；Runtime 将该响应作为最终回答。
2. **工具调用表示继续工作。** 模型响应中有工具调用时，Runtime 执行外部授权工具，把安全工具结果追加回模型上下文，然后继续调用模型。
3. **Runtime 不替模型判断答案质量。** Runtime 不能根据关键词、证据数量、文本长度或工程规则判断“还没答完”或“应该总结”；它只观察模型是否继续调用工具。
4. **预算耗尽不是完成。** 如果模型仍在请求工具，但模型轮次或工具轮次到达上限，Runtime 返回 `paused/out_of_fuel`，不能合成最终回答。
5. **笼子负责边界，不负责思考。** 权限、审批、预算、脱敏、审计、取消和上下文装配属于工程边界；目标理解、是否继续探索、是否调用工具和最终表述属于模型行动选择。

## 运行入口

普通 Desktop Agent 通过 `AgentTurnRuntime.executeAutonomous` / `resumeAutonomous` 进入自主工具循环。旧的 `execute` / `resume` 保持通用 provider-stop 工具循环语义，供其他结构化路径继续使用。

`executeAutonomous` 的模型可见工具只包含本轮外部授权工具：

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
  call model with safe messages and external tools

  if provider failed:
    return failed/model_failed

  if response has no tool calls:
    return completed(final assistant output)

  if tool/model fuel is exhausted before executing or continuing:
    return paused/out_of_fuel

  execute requested external tools through ToolCenter

  if approval is required:
    return approval_required with pending confirmation

  append assistant tool calls and safe tool results
  continue
```

如果一次模型响应同时包含文本和工具调用，工具调用优先表示“继续工作”。文本可以作为该轮 assistant tool-call message 的内容保留，但不能被 Runtime 提升为最终回答。

## 工具边界

外部工具必须始终经过：

- `ToolCenter.execute`。
- `allowedTools` 与 capability policy 裁剪。
- security policy / confirmation 规则。
- 安全投影与 raw output 脱敏。
- tool event 审计。

工具结果回到模型时，只能使用安全摘要、证据引用、截断标记、诊断引用和必要状态。不得把 raw prompt、raw provider response、raw tool output、stdout/stderr、secret、token 或 hidden reasoning 放回普通历史或可见结果。

## 停止语义

`executeAutonomous` 的结果映射为：

- `completed/no_tool_calls`：首轮无工具调用，模型直接给出最终文本。
- `completed/completed`：至少执行过一轮工具，随后模型无工具调用并给出最终文本。
- `approval_required/approval_required`：工具需要用户确认，等待 matching confirmation id。
- `paused/out_of_fuel`：模型仍在请求工具，但工具轮次或模型轮次耗尽。
- `cancelled/cancelled`：用户或系统中止。
- `failed/model_failed`：provider 失败或响应不可用。

`maxModelRounds` 和 `maxToolRounds` 只是燃料边界，不是语义完成条件。达到边界时，普通 Agent 必须暂停并保留恢复所需上下文；不能执行 final synthesis，也不能把最后一条普通文本或工具摘要伪装为最终答案。

用户可见暂停文案必须使用产品语言，例如：

```text
这轮工具调用或模型轮次已到上限，任务没有完成。你可以继续发送消息让我接着处理。
```

可见文案不得泄漏 `loop`、`provider`、`raw prompt`、内部 request id、内部 fuel 名称或底层状态机细节。

## 上下文装配

上下文管理发生在进入 loop 前的 Context Pack 装配面，不进入工具循环内部。

装配规则：

- 当前用户消息必须保留在最后。
- 最近对话轮次优先保留原始 `user` / `assistant` role。
- 更早历史可以压缩为安全摘要。
- 超预算时优先丢弃旧历史或旧摘要，不能丢系统边界、当前用户消息和必要工具安全结果。
- 摘要不得保存 raw prompt、raw provider response、raw tool output、secret、token 或 hidden reasoning。

普通 Agent loop 内不做压缩、不做总结、不做任务完成判断。

## 持久化与恢复

会话持久化由 Panel / Conversation 层负责，`desktop-agent-session` 只消费传入的 `conversationHistory`，不直接读取 RuntimeDatabase。

恢复对话时必须裁剪悬空 turn：

- 保留最后一个完整用户-助手回合之前的安全历史。
- 丢弃悬空 tool call、未完成 assistant 消息和失败运行中的内部材料。
- 如果没有完整 turn，则以空历史恢复。

恢复审批时仍必须匹配原 confirmation id；不允许因为重新进入 loop 而绕过确认。

## 禁止事项

- 在普通 Agent 路径要求模型调用内部完成工具才能结束。
- 在无工具调用时追加工程提示强迫模型继续。
- Runtime 根据文本质量、关键词、证据数量或上下文长度判断任务是否完成。
- 燃料耗尽后合成最终答案或把工具摘要冒充最终回答。
- 把上下文压缩、长期记忆治理、deep 派生、Work Session 升级放进普通工具循环内部。
- 让外部工具绕过 ToolCenter、权限裁剪、确认、安全投影或审计。

## 验收边界

- 普通问答无工具调用时直接 `completed`，可见结果来自模型文本。
- 模型可见工具列表不包含内部完成工具。
- 工具调用后，安全工具结果必须回到下一轮模型请求。
- 工具后下一轮无工具调用时 `completed`，答案来自模型最终文本。
- 连续工具调用耗尽燃料时返回 `paused/out_of_fuel`，不生成最终总结。
- 审批暂停和恢复仍要求 matching confirmation id。
- 可见输出不泄漏 raw prompt、raw provider response、raw tool output、内部 loop/fuel/provider 细节。

普通 Agent 的能力来自模型在清晰、安全、可审计的世界里自然行动：需要工具就调用工具，不需要工具就回答并停止。工程实现必须把复杂度放在世界装配和边界守护上，而不是替模型发明额外的完成仪式。
