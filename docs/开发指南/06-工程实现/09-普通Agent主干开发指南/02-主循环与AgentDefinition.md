# 主循环与 AgentDefinition

## 一个默认主循环

当前默认普通 Agent 必须始终围绕一个主循环实现：

```text
assemble safe context
call model
if tool calls:
  gate and execute tools
  project safe tool results back to model
  continue
else:
  finish with the model's final answer
```

要求：

- 默认普通 Agent 只有一个主执行引擎。
- CLI、Panel、桌面壳、后续 SDK 或其他入口，只能复用这套主循环，不能各自长出一套 Agent 语义。
- 默认异步入口应先通过 `runExecutor.start` 创建带有冻结事实的 run，再由 executor 调度执行；会话入口、桌面 run 入口和未来普通入口不能直接绕到 `runForPanel`、`runOrdinaryDesktopForPanel` 或 `runDesktopAgentSession`。
- “模型不再调用工具”才表示普通 Agent 正常完成。
- `approval_required`、用户补充指导、工具失败后继续判断，仍属于普通循环的一部分。
- `provider` 失败、网络失败、上下文维护失败、进程失败、恢复失败不是正常完成。
- `out_of_fuel` 和 `context_overflow` 是运行边界失败，应投影为 blocked / paused，不允许作为 completed 交付给前端。

禁止事项：

- 在普通路径中引入第二套完成机制。
- 在默认异步入口绕过 run executor，直接调用面板执行 helper、desktop session helper 或历史同步执行路径。
- 要求模型调用内部完成工具才能结束。
- 用固定阶段、关键词或模板流程推动普通 Agent 继续或停止。

## AgentDefinition 必须是一等资产

默认普通 Agent 不能只是一段散落在运行时代码里的 prompt 和若干 if/else 规则。每个长期存在的 Agent 都必须有明确的定义资产。

普通 Agent 的最小 `AgentDefinition` 至少应包含：

- `agentId`
- `displayName`
- `systemPrompt`
- `turnPolicy`
- `outputContract`
- `toolVisibilityProfile`

要求：

- `agent` 身份和行为边界必须从上下文装配代码中抽离。
- 系统提示词应作为独立 prompt 资产文件存在，再由 `AgentDefinition` 引用。
- `turnPolicy`、`outputContract` 和 `toolVisibilityProfile` 也应作为独立定义资产文件存在；`AgentDefinition` 文件只负责组装身份、名称和这些资产引用，不再长期内联策略正文。
- 普通主循环只能消费 `toolVisibilityProfile.runMode=agent` 且 `turnPolicy.purpose=desktop_agent` 的定义；`work_session_*` purpose 只能服务历史兼容或显式 deep / work-session 路径，不能混入普通主循环。
- `turnPolicy` 可以显式声明普通主循环的模型/工具轮次上限；默认普通 Agent 当前不设置固定轮次上限，只有特定 Agent 确实需要运行边界时才应写入定义资产。
- prompt 文案、输出契约和工具可见性不能分别散落在 session、context pack、UI copy 和测试 fixture 中。
- 新增 Agent 时先定义它是什么，再接入运行时。
- 已经写入运行记录的 `AgentDefinition` 引用必须可解析。修改当前 prompt 时，只能推进新的 prompt version；旧版 prompt 常量必须冻结保留，用于恢复和审计历史运行记录。
- `AgentDefinition` 的安全 run ref 必须携带语义 hash；hash 覆盖 prompt、turn policy、output contract 和 tool visibility profile。只要这些语义资产漂移，恢复执行就必须拒绝，而不是回退到当前默认定义继续运行。
- 上下文装配可以把 `AgentDefinition.prompt.systemPrompt` 作为模型输入，但用户可见 read-model、运行恢复响应、持久化 run facts 和前端状态只能暴露安全引用或摘要，不能泄漏完整 prompt 正文。

禁止事项：

- 把系统提示词继续内联在上下文组装文件中，长期不抽离。
- 把输出契约、工具可见性或 turn policy 重新塞回运行时代码、session helper 或 panel 分支中。
- 用“先加一个 prompt helper，后面再整理”的方式累积长期 Agent 资产。
- 把 demo manifest、测试 fixture 或 panel 文案当成正式 Agent 定义。
