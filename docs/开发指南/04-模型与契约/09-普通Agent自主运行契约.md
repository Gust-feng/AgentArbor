# 普通 Agent 自主运行契约

## 定位

普通 Agent 是当前默认桌面会话的执行内核。它负责在一次用户消息中装配会话上下文、调用模型、执行授权工具、把工具结果回传模型，并在模型不再请求工具时形成可见回答。

普通 Agent 是线性会话驱动能力，而不是任务驱动 runtime。它按 conversation 时间线消费上一轮运行历史、本轮用户消息、上下文引用、工具结果和确认决定；它不创建、推进或裁决独立任务生命周期。后续 deep / Agent 集群才承担任务驱动的目标成形、多路探索、Plan 交接和执行组织。

普通 Agent 的核心形态是自然 provider-stop ReAct 循环：模型在每一轮基于当前运行上下文决定是否行动、调用哪些可见工具、如何解释工具结果，以及何时停止。Runtime / harness 只提供可调用世界、执行工具、记录事件和保护边界，不额外发明内部完成仪式，也不把固定阶段机伪装成 agent 思考。

本契约只约束普通 Desktop Agent。Underground、Work Session、结构化计划生成等未来或专用路径可以有自己的停止语义，但不能反向污染普通 Agent。

## 根原则

1. **完成权属于模型的行动选择。** 模型响应中没有工具调用且 provider 返回明确完成终态，表示模型停止继续行动；Runtime 将该响应作为最终回答。截断、过滤或 incomplete 响应不是完成。
2. **工具调用表示继续工作。** 模型响应中有工具调用时，Runtime 执行授权工具，把工具结果追加回模型上下文，然后继续调用模型。
3. **工具选择权属于模型。** 在本轮可见工具集合内，模型自由决定调用什么工具、调用顺序和是否继续调用；Runtime 不能用关键词、模板阶段或固定流程替模型选择工具。
4. **Runtime 不替模型判断答案质量。** Runtime 不能根据关键词、证据数量、文本长度或工程规则判断“还没答完”或“应该总结”；它只观察模型是否继续调用工具。
5. **普通路径不设置行动轮次上限。** 不考虑用户中止、provider 失败、上下文硬溢出、进程失败等外部硬边界时，模型必须可以一直调用工具并继续工作，直到它自己不再调用工具。工具次数或模型轮次不能成为普通 Agent 的产品能力边界。
6. **工程边界不负责思考。** ToolCenter、权限、命令确认、上下文窗口管理、审计、取消和恢复属于工程边界；目标理解、是否继续探索、是否调用工具、工具取舍和最终表述属于模型行动选择。当前阶段能力优先，不用摘要、投影或固定规则限制普通回答和工具结果回传。

## 运行入口

普通 Desktop Agent 通过 `OrdinaryAgentFeature` 进入标准模型-工具-模型循环。feature 调用中性的 `AgentLoop` 端口；当前生产 adapter 使用 Pi AgentHarness/Session 和 pi-ai provider binding。Pi 只负责机械循环、Session、压缩和 provider transport，不拥有 Ordinary 的业务状态、完成语义、仓储或 read-model。

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
  maintain the exact context for the request
  call model with conversation messages and external tools

  if provider failed:
    return failed/model_failed

  if provider response is incomplete or truncated:
    return failed without committing partial assistant text

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

ToolCenter 是工具执行的统一入口，但不是 `allowedTools` 的唯一防线。Pi AgentTool adapter 必须在进入具体执行 broker 前按本轮 `allowedTools` 裁剪工具；ToolCenter 和 adapter 可以重复校验与命令确认，但只能返回执行事实，不能生产模型或 UI 投影。每个工具结果必须先由 Ordinary feature 持久化为 AgentArbor 工具事实，才允许作为有界消息返回 Pi Session；provider `callId` 与应用 `factId` 分离，不能因父/子 Agent 或并行 child 的 call id 重复而复用权限、确认或结果。工具失败、拒绝、取消和确认等待都应以标准结果回传模型，让模型基于真实工具世界继续判断。

工具身份必须在进入 AgentArbor 可执行 catalog 时一次性冻结为只含 ASCII 字母、数字和下划线的 provider-portable canonical name。外部 adapter 可以另外保留 MCP 等协议的原始方法名用于远端调用，但 ToolCenter、模型调用、工具结果、Ordinary 持久化和 read-model 必须始终使用同一个 canonical name，不得在 provider 执行后反向猜测或回译名称。归一化后重名必须在 catalog/registry 装配期明确失败，不能由 `Map.set()` 静默覆盖。

MCP 配置中的 `enabledTools` 与 `autoApprovedTools` 只保存远端协议原始方法名；MCP catalog 同时显式携带 `protocolName` 与 canonical `name`。配置、Panel 和 executor 按 `protocolName` 工作，模型与 Ordinary 事实按 canonical `name` 工作，两者只在 MCP catalog 装配边界建立一次映射，任何下游模块都不得从 canonical name 反向推测协议原名或兼容多套别名。

工具结果回到模型时，应优先提供足以继续开发判断的真实内容。前端展示同一工具调用事实的紧凑视图即可，不要求工具生成解释性文本，也不得用 UI 标题、摘要或固定建议替代模型消息、正文、stdout/stderr、文件片段或错误信息。

## 停止语义

Ordinary 对 `AgentLoop.execute` / live confirmation continuation 技术结果的映射为：

- `completed/no_tool_calls`：首轮无工具调用，模型直接给出最终文本，且 provider 返回明确完成终态。
- `completed/completed`：至少执行过一轮工具，随后模型无工具调用并给出最终文本，且 provider 返回明确完成终态。
- `approval_required/approval_required`：工具需要用户确认，等待 matching confirmation id。
- `interrupted/external_boundary`：用户中止、provider 失败、上下文硬溢出、进程失败或其他外部硬边界打断 loop。该状态不是完成，也不是普通产品能力边界。
- `cancelled/cancelled`：用户或系统中止。
- `failed/model_failed`：provider 失败或响应不可用。

provider 失败、404、超时或流式连接断开若不能安全重试，会永久结束当前模型调用。模型传输重试和动态认证由 Pi provider binding 单点拥有；Ordinary 不复制 provider client 或重试器。工具结果已经持久化不妨碍重试其后的纯模型请求，因为重试只再次读取同一 Session branch，不重新执行工具；一旦本次模型请求已经收到任意 provider 事件、用户可见增量或新工具调用事实，则不得自动拼接多个 attempt。无法安全重试时，用户只能追加新消息形成新 run，或回退到历史 Session leaf 后创建新分支。

普通 Agent 不应使用 `maxModelRounds` 或 `maxToolRounds` 作为正常运行边界。默认 Desktop Agent 的 `AgentDefinition.turnPolicy` 不得携带模型轮次或工具轮次上限；旧结构化路径、测试桩或专用 agent 可以有显式预算，但这些预算不能流入默认普通 Desktop Agent 的产品主线。若底层自主 loop 仍接收到显式保护阀，它只能作为异常防护并返回未完成的 paused / blocked 结果，不能合成 completed、不能成为普通验收路径、常规暂停 UX 或模型能力上限。

普通 Agent 的输出预算应来自模型能力解析结果或用户显式配置。模型能力解析必须先按用户选择的协议得到基线能力，再叠加内置模型目录和用户 override；没有命中内置模型目录时只能使用协议基线的保守窗口与输出上限，不能把自定义 OpenAI-compatible / Responses 模型降级为“不支持工具”的未知类型。长回答、报告、代码解释和多步结果应由模型能力、上下文窗口、用户要求和运行边界共同决定。

普通 Agent 也不应默认给每次模型请求套固定短延迟预算。用户取消、进程中止、provider 自身超时和外部网络失败是硬边界；普通任务的耗时上限应来自用户明确要求、运行环境策略或 provider 真实失败，而不是前端体验层预设的固定秒数。

用户取消的是 Ordinary run，而不是等待 provider、Pi 或工具 Promise 自行结束。Ordinary feature 必须先持久化取消终态、停止新输出和新工具调度，再由资源 owner 在后台传播 `AbortSignal` 并释放 transport、continuation 与进程资源；取消命令不得等待可能忽略 abort 的纯模型调用。只有已经接受工具轮且执行结果尚未确定时，后续 run 才继续等待该工具事实收口。Panel 可以立即收起运行控件并停止观察连接，但不能展示 runtime、transport、清理阶段或 continuation 丢失等内部提示，也不能清空用户在运行中追加的消息；取消前已显示的正文可以继续显示为未完成内容，但不能进入 completed 正式回答或 Pi Session 历史。

已经向用户展示的流式正文必须作为独立的 durable view checkpoint 保存。该 checkpoint 不是模型完成事实、不能写入 Pi Session，也不能被下一轮当作正式 assistant 历史；它只用于主动取消或进程退出后恢复用户已经看见的会话表面。主动取消不生成“已取消”assistant 消息、错误卡或原因文案；没有已显示正文和真实工具过程时，该 assistant turn 在默认视图中保持无形。

进程退出后，live-only 模型或确认 continuation 仍按内部事实收口为不可续接状态，但默认 Panel 只恢复退出前持久化的可见正文、工具事实和 Session 位置，不显示进程重启、continuation 丢失或 runtime 错误。这里恢复的是视图，不是继续执行：用户只能追加新消息创建新 run，或回退到 Pi Session 的历史 leaf 创建新分支。Host 必须对 `runtimeHome` 实施单写者所有权；不同端口和开发 watch 实例不能同时恢复或改写同一运行目录。

用户可见暂停文案必须使用产品语言，例如：

```text
运行被外部边界中断，任务没有完成。你可以继续发送消息让我接着处理。
```

可见文案不得泄漏 `loop`、`provider`、`raw prompt`、内部 request id、内部 fuel 名称或底层状态机细节。

## 上下文装配

上下文管理只有两个明确边界：Ordinary 负责装配本轮模型输入，Pi AgentHarness/Session 负责在请求边界保护物理窗口并压缩较早消息。该检查必须发生在首次请求以及每次工具调用后的下一次请求前，并以即将发送的完整请求为准。未触发压缩时，Pi Session 消息不得被展示投影或字符预算改写；触发压缩时必须保留系统边界、当前请求、完整工具交互和未完成事项，失败则明确暂停，不能带着超限或残缺上下文继续调用模型。

装配规则：

- 当前用户消息必须保留在最后。
- 紧邻上一轮运行持久化的标准 `modelContext` 是跨轮模型历史的唯一事实；它保留真实 `user / assistant / tool` role、工具调用参数、工具结果和最终 assistant 输出。
- Panel 可见对话、工具 lifecycle event 和 read-model 只服务展示、审计或 Skill 路由，不能重新拼成另一份模型历史。
- Token 统计必须来自模型能力目录或专用 tokenizer / provider 计量能力，且覆盖正文、工具调用参数、协议扩展和附件元数据；本地无法精确计量的二进制附件必须预留保守预算，provider 仍是最终计量边界，不能用字符数粗略估算作为最终裁剪依据。
- 达到模型上下文阈值时优先进行 AI 压缩；只有压缩失败且外部硬边界无法恢复时，才能中断运行。
- 超预算时由 Pi compaction 压缩旧上下文，不能丢系统边界、当前用户消息和必要工具结果；除此之外不得在模型调用前静默省略或替换 Session 消息。
- 摘要必须保留继续开发所需的关键事实，不能因为摘要或投影丢失普通回答、工具结果和错误信息。
- 同一次 assistant tool call 与其全部 tool result 是不可拆分的上下文组；压缩要么保留整组，要么把整组交给压缩，不能留下悬空调用或孤立结果。
- Pi provider adapter 映射工具协议时，assistant tool call 后必须连续跟随该批次全部对应 tool result；正文不能插入工具协议组之间。
- 同一协议连续运行时，Pi provider/model binding 保留协议 continuation；用户切换 provider/protocol 时由 Pi 按公开能力建立新的上下文段，Ordinary 不复制或伪造 provider 私有 continuation。
- 流式输出、事件顺序、provider stop reason 和 continuation 由 Pi AgentHarness/provider adapter 归一化；AgentArbor 只映射为 Ordinary live activity 和终态事实，不关闭 streaming、过滤事件或伪造完成。
- 所有 OpenAI-compatible 请求的稳定系统指令、工具定义和既有消息必须位于动态用户输入之前；`prompt_cache_key` 只能由稳定协议事实生成，不能随 conversation id、run id、本轮动态正文或中转 Base URL 变化。缓存命中、写入和未缓存 token 以 provider usage 为准。

普通 Agent loop 内不做任务完成判断。上下文压缩服务于 loop 连续运行，而不是替模型总结任务或决定停止。

## 持久化与恢复

会话与运行持久化由 `OrdinaryAgentFeature` 自己负责。它只从 `ordinary-conversation/v2` 的 Session ref 和 Pi active leaf 读取上下文，并在 `ordinary-run/v5` snapshot 中保存 Session refs、工具事实、usage、状态和展示 checkpoint；Panel、旧 RuntimeDatabase 和 UI read-model 都不是恢复来源。

Pi Session entries 只属于 Pi 的恢复与持久化边界，不进入公开 conversation API 或 SSE；展示层消费单向 read-model，不能因模型恢复需要而把系统提示或 provider continuation 暴露成产品响应，也不能用展示摘要覆盖模型仍可使用的工具正文。

能够完整内联的工具事实直接保存在 `ordinary-run/v5`。超过内联边界的完整正文、结构化 JSON 或失败证据写入 Host-owned `runtime/tool-evidence/`，run snapshot 只保存预览、稳定 `tool-output://` 引用、字符数、byte length、SHA-256 与 continuation 输入。该引用跨进程可读；完整读取不会删除审计证据，删除所属 conversation 时才由 Ordinary 按 run owner 回收。

Ordinary SSE 只是实时观察通道，不拥有运行事实。相邻文本增量可以短窗口合并；Node 写缓冲区返回背压信号时必须等待 `drain`，积压超过本地连接上限时只关闭该观察连接，不取消 Agent。前端随后通过 cursor、run view 和持久化终态对账，不要求逐 token 重放。

普通会话必须是长期可恢复时间线：今天、明天或一年后继续同一 conversation，都应从数据库恢复运行历史、当前分支和可见状态。用户可以回退到上一轮、前四轮或前五轮对话；回退生成新的当前分支或显式截断当前分支，但不能破坏原始审计记录。

恢复对话时必须区分可复用事实与不可伪造的运行时状态：

- 从 conversation 的 Pi active leaf 恢复原始角色、工具调用/结果和 Pi continuation；根系统指令由该 run 冻结的 AgentDefinition 重新交给 Pi Harness。
- provider/protocol 切换由 Pi provider binding 按公开能力处理；历史 Session 保持原样，不能回写篡改审计事实。
- 失败、blocked 或取消 run 若已经形成 Pi Session 消息，下一轮沿用其中真实消息；若在模型调用前失败，则使用更早的 Session context。不得另造“中断上下文”，Panel 错误文案也不能冒充模型输出。
- `visibleAssistantText` 只恢复用户已经看见的正文，不参与下一轮模型上下文；进程退出后的静默视图恢复不得被解释为同一模型调用可以续跑。
- 附件字节、未知 provider 私有字段、悬空 continuation 和无法证明结果的内部执行对象一律不持久化，不能为了“续跑”伪造 tool call/result 对。
- 开发期旧 snapshot 直接视为不兼容数据；不得从可见回答、event payload 或当前全局配置迁移、双读或猜测回填。

恢复审批时仍必须匹配原 confirmation id；不允许因为重新进入 loop 而绕过确认。进程重启导致 live continuation 丢失时，Ordinary 必须为待审批调用记录“未执行并已取消”的真实 tool result，再进入 blocked，不能留下孤立 assistant tool call 或重放命令。

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
- 新一轮会话以及进程重启后，Pi active leaf 按原顺序进入模型上下文；失败、blocked 和取消 run 不产生第二套产品上下文表示，旧 `v3/v1` 格式数据不兼容恢复。
- 工具后下一轮无工具调用时 `completed`，答案来自模型最终文本。
- 普通 Agent 不因工具次数或模型轮次达到工程上限而停止。
- 上下文达到阈值时触发 AI 压缩并继续，而不是停止或丢失关键历史。
- 审批暂停和恢复仍要求 matching confirmation id。
- 可见输出优先呈现模型原始表达；工程层不得用关键词规则吞掉普通内容。

普通 Agent 的能力来自模型在清晰、可审计的工具世界里自然行动：需要工具就调用工具，不需要工具就回答并停止。工程实现必须把复杂度放在世界装配、命令确认和可恢复性上，而不是替模型发明额外的完成仪式或输出替代层。
