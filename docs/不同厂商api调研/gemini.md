# 主流大语言模型厂商 API 协议差异及统一适配层技术调研报告

## 兼容性结论与行业演进趋势

在构建生产级智能体（Agent）系统的工程实践中，适配层设计必须精确处理不同模型厂商在状态管理、推理流程以及调用逻辑上的核心差异 。当前的行业技术演进正呈现出两条清晰的发展路径：一是以 OpenAI 为代表的、面向复杂自主代理设计的状态化、工具驱动型 Responses API 协议 ；二是以 Anthropic Messages API 为代表的、强推理、注重流式 block 输出与提示词缓存控制的协议 。

各大国内主流模型厂商以及新一代推理模型厂商，虽然在外部营销与基础文档中广泛宣称其接口具备 “OpenAI 兼容性”，但这种兼容性在绝大多数情况下仅限于传统的、无状态的 OpenAI Chat Completions API 。针对 OpenAI Responses API，目前下游厂商均不提供原生直接兼容 。在涉及深度思考（Thinking/Reasoning）和多步工具调用（Multi-turn Tool Use）等复杂场景时，由于各厂商在专有参数、输入输出结构以及多轮历史拼接规则上存在大量破坏性差异（Breaking Changes），若直接透传 OpenAI SDK，会导致严重的运行时故障或协议校验报错（如 HTTP 400） 。

因此，本报告对 OpenAI、Anthropic Claude、DeepSeek、GLM（智谱）、Kimi（月之暗面）以及 MiniMax 进行了系统性、可落地的协议差异剖析，并设计了一套可由代码生成工具（如 Codex）直接实现的统一抽象适配层，以屏蔽底层异构细节，支撑高可靠 Agent 框架的工程落地。

## 厂商基础协议信息

适配层在建立网络通道前，必须针对各个模型厂商的端点、协议特性、SDK 兼容边界及已知限制进行基准配置。下表系统整理了各厂商的底层协议 Profile，可直接用于初始化适配器的连接策略：

| **厂商名称**        | **官方 API Base URL**                  | **推荐使用的 API Endpoint** | **支持 OpenAI SDK**    | **支持 OpenAI Chat Completions 格式** | **支持 OpenAI Responses API 格式** | **支持 Anthropic Messages 格式** | **拥有原生专有 API 协议**                 | **推荐生产接入方式**                                      | **兼容性限制与官方警示**                                     |
| ------------------- | -------------------------------------- | --------------------------- | ---------------------- | ------------------------------------- | ---------------------------------- | -------------------------------- | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| **OpenAI**          | `https://api.openai.com/v1`            | `/v1/responses`             | 是                     | 是                                    | 是                                 | 否                               | 是                                        | 官方 Python/TS SDK 直接调用 `/v1/responses`（面向智能体） | 无限制，定义了协议标准 。                                    |
| **Anthropic**       | `https://api.anthropic.com/v1`         | `/v1/messages`              | 否（仅提供兼容层过渡） | 否                                    | 否                                 | 是                               | 是                                        | 官方 `@anthropic-ai/sdk` 接入 `/v1/messages`              | 官方声明 OpenAI 兼容层仅用于测试，不可用于生产；兼容层下 `strict` 工具调用、提示词缓存、音频输入均受限或失效 。 |
| **DeepSeek**        | `https://api.deepseek.com`             | `/v1/chat/completions`      | 是                     | 是                                    | 否                                 | 是（限 `/anthropic` 路由端点）   | 是（含 `reasoning_content` 的扩展协议）   | OpenAI SDK 指向官方 Base URL 并注入专有参数               | 多轮工具调用时，必须原样回传上一轮的 `reasoning_content`，否则报 400 错误；思考模式下部分采样参数失效 。 |
| **GLM / 智谱**      | `https://open.bigmodel.cn/api/paas/v4` | `/chat/completions`         | 是                     | 是                                    | 否                                 | 否                               | 是（含 `thinking` 配置的原生协议）        | 官方 `zhipuai` SDK 或标准 OpenAI SDK 接入                 | 深度思考模式下响应时间变长，需配置合理的超时时间；思考模式会消耗额外 Token 。 |
| **Kimi / 月之暗面** | `https://api.moonshot.cn/v1`           | `/v1/chat/completions`      | 是                     | 是                                    | 否                                 | 否                               | 是（内置 `$web_search` 与思考扩展协议）   | 标准 OpenAI SDK 注入专有 `extra_body`                     | 思考模式与内置联网搜索 `$web_search` 冲突；多轮工具调用下必须完整回传 `reasoning_content`，否则报错 。 |
| **MiniMax**         | `https://api.minimaxi.com/v1`          | `/v1/chat/completions`      | 是                     | 是                                    | 否                                 | 否                               | 是（含 `reasoning_split` 等原生控制参数） | 标准 OpenAI SDK 配合 `extra_body` 参数                    | 默认将思考内容嵌入 `<think>` 标签输出；若开启 `reasoning_split` 则必须在历史上下文中完整保留结构化消息 。 |



## 请求结构差异与参数冲突

在适配层中，向不同模型厂商传递请求参数时，必须进行细致的参数清洗和结构重组。特别是针对 Anthropic 的原生 Messages API  以及部分开启了深度思考（Thinking/Reasoning）的模型，其对经典超参数（Temperature、Top_p、Top_k）的校验规则极其严苛 。

### 独有与扩展字段归属

1. **OpenAI Responses API 独有字段**：`instructions`（替代系统提示词）、`input`（替代 `messages` 数组）、`store`（控制服务端会话存储）、`previous_response_id`（服务端多轮会话链指针） 。这些字段在所有其他厂商中传递均会导致直接的运行时错误 。
2. **Chat Completions 风格字段**：`messages`（包含 `role` 和 `content` 的历史消息数组）、`tools`、`tool_choice`、`response_format` 。
3. **Anthropic 风格字段**：`system`（作为顶层请求字段传递，而不是消息数组中的角色） 、`thinking` 细化配置对象（包含 `budget_tokens` 等控制项） 、`output_config`（用于配置 `effort` 思考强度等） 。
4. **厂商专有扩展字段**：
   - **DeepSeek**：`reasoning_effort` 、`extra_body.thinking`（用于显式激活 V4 等模型的思考功能） 。
   - **GLM/智谱**：顶层 `thinking` 控制对象（包含 `type` 字段控制动态或强制思考） 。
   - **Kimi/月之暗面**：`extra_body.thinking`（可用于显式禁用 K2.6 等模型的思考能力以兼容联网搜索） 。
   - **MiniMax**：`extra_body.reasoning_split`（布尔值，用于从 `content` 中分离思考流） 。

### 参数忽略、报错与失效矩阵

为了避免适配器发送不合规参数引发 HTTP 400 校验异常，适配层在编译请求载荷时必须严格执行以下清洗逻辑：

- **Claude Opus 4.7 强制拒绝超参数**：当且仅当配置了 `thinking`（或 `output_config.effort`）激活深度思考时，Anthropic 引擎强制要求 **不得传递任何非默认值的 `temperature`、`top_p` 或 `top_k`**，否则直接返回 400 错误 。适配层必须在此模式下将这些参数从 payload 中剥离 。
- **DeepSeek 思考模式下的参数表现**：在开启 `thinking` 时，参数 `temperature`、`top_p`、`presence_penalty`、`frequency_penalty` 虽不生效，但为维持软件兼容性，API 接收这些参数时不会报错，而是采取**静默忽略**策略 。然而，当开启思考模式时，**传递 `tool_choice` 会导致直接报 400 错误** 。
- **未定义厂商参数**：向 Kimi、MiniMax、GLM 传递未知的 top-level 参数通常会由于严格的反序列化导致请求被拒，因此任何专有参数（如 `reasoning_split`）都必须封装到 `extra_body` 中，或者由适配层根据当前目标厂商的模型配置进行裁剪 。

## 消息与输入输出格式差异

由于大模型底层分词器与表征形式的演进，多轮对话历史及当前帧的输入输出格式在 Responses 格式、标准 Chat 格式以及 Anthropic Block 格式之间存在本质差异 。

### 消息格式语义对照表

下表梳理了在统一适配层设计中，同一种逻辑语义在不同底层协议中的映射路径：

| **语义概念**     | **OpenAI Responses API**                              | **OpenAI Chat Completions API**                             | **Anthropic Messages API**                                   | **DeepSeek Chat API**                                       | **GLM / 智谱 API**                                          | **Kimi / 月之暗面 API**                                     | **MiniMax API**                                             |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **用户消息**     | `input` string 或 item list 结构                      | `{"role": "user", "content": "..."}`                        | `{"role": "user", "content": [{"type": "text", "text": "..."}]}` | `{"role": "user", "content": "..."}`                        | `{"role": "user", "content": "..."}`                        | `{"role": "user", "content": "..."}`                        | `{"role": "user", "content": "..."}`                        |
| **助理文本**     | 属于 `type: "message"` 输出项中的 `content.text` 字段 | `{"role": "assistant", "content": "..."}`                   | `{"role": "assistant", "content": [{"type": "text", "text": "..."}]}` | `{"role": "assistant", "content": "..."}`                   | `{"role": "assistant", "content": "..."}`                   | `{"role": "assistant", "content": "..."}`                   | `{"role": "assistant", "content": "..."}`                   |
| **工具调用**     | 独立的 `type: "function_call"` 输出项                 | `tool_calls` 数组（在消息对象内）                           | `content` 数组中的 `{"type": "tool_use", "id": "...", "name": "...", "input": {...}}` 块 | 标准 `tool_calls` 数组                                      | 标准 `tool_calls` 数组                                      | 标准 `tool_calls` 数组                                      | 标准 `tool_calls` 数组                                      |
| **工具结果**     | 独立的 `type: "function_call_output"` 输入项          | `{"role": "tool", "tool_call_id": "...", "content": "..."}` | `{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "...", "content": "..."}]}` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` | `{"role": "tool", "tool_call_id": "...", "content": "..."}` |
| **深度思考内容** | 独立的 `type: "reasoning"` 输出项                     | 无原生通用标准字段（各家扩展）                              | `content` 数组中的 `{"type": "thinking", "thinking": "...", "signature": "..."}` 块 | 与 `content` 平级的扩展字段 `reasoning_content`             | 与 `content` 平级的扩展字段 `reasoning_content`             | 与 `content` 平级的扩展字段 `reasoning_content`             | 开启 `reasoning_split` 时，返回 `reasoning_details` 数组    |
| **多轮上下文**   | 在服务端通过 `previous_response_id` 自动级联托管      | 客户端维护包含所有历史 message 对象的完整数组               | 客户端维护消息数组，system 必须剥离到顶层参数                | 客户端维护消息数组，包含历史 `reasoning_content`            | 客户端维护消息数组，包含历史 `reasoning_content`            | 客户端维护消息数组，包含历史 `reasoning_content`            | 客户端维护消息数组，包含标签或结构化思考数据                |



## 工具调用协议差异

工具调用（Tool Calling）是 Agent 应用的基石 。各模型厂商在此维度的差异极大，甚至会直接影响到多步代理循环（Agent Loop）的执行效率与稳定性 。

### 工具定义协议

1. **参数字段差异**：OpenAI 及其兼容厂商（DeepSeek、GLM、Kimi、MiniMax）均采用在 `tools.function` 下定义 `parameters` 接收标准 JSON Schema 的做法 。而 Anthropic 原生协议则要求将 JSON Schema 定义在 `tools.input_schema` 中，且不支持最外层的 `type: "function"` 嵌套 。
2. **Strict Mode 与类型安全**：OpenAI Responses API 的工具默认为强制严格模式（Strict Mode） ；而在 OpenAI Chat Completions 兼容厂商中，GLM、DeepSeek、Kimi、MiniMax 均不原生支持 `strict` 约束，传递该参数会被忽略或报错，从而无法完全杜绝 JSON 参数的幻觉畸变 。
3. **MCP 与内置工具支持**：OpenAI Responses API 提供了原生对 Model Context Protocol (MCP)、代码解释器、文件搜索及网页搜索等内置组件的服务端级支持 ；国内厂商中，Kimi 支持通过专用工具定义 `builtin_function` 声明调用其官方联网搜索模块 `$web_search` 。

### 工具返回结构

1. **OpenAI 体系**：返回的消息中包含 `tool_calls` 数组，每个子项携带 `id`、`type: "function"` 以及 `function`（内含 `name` 和序列化字符串形式的 `arguments`） 。
2. **Anthropic 体系**：在 assistant 响应的 content block 数组中，直接混入 `type: "tool_use"` 的 block，其参数已解析为结构化的 `input` 对象，无需客户端手动反序列化 JSON 字符串 。
3. **MiniMax 双模特性**：MiniMax 兼容 OpenAI 格式输出，同时在其原生 Interleaved 模式下，返回结构也会将思考与工具 block 进行显式解耦 。

### 工具结果回传与严格约束

1. **角色映射冲突**：OpenAI 体系下，回传工具结果必须新起一个 `role: "tool"` 的消息，并提供 `tool_call_id` 。而 Anthropic 体系下，**工具结果属于 `role: "user"` 消息内的一个 content block**，其类型为 `tool_result`，并通过 `tool_use_id` 关联 。
2. **Call ID 强一致性**：所有厂商均强制要求工具结果回传时的关联 ID 必须与模型吐出的 ID 完全匹配，任何不匹配将引发严重的状态回溯异常。
3. **历史上下文保留约束（核心避坑点）**：
   - **DeepSeek 强约束**：如果上一轮 Assistant 触发了工具调用，后续请求不仅要回传 `tool` 结果，**上一轮 Assistant 消息中的 `reasoning_content` 也必须完整保留并传递回去** 。若在多轮上下文中剔除了该思考内容，DeepSeek API 会直接抛出 HTTP 400 报错 。
   - **Kimi / Moonshot 强约束**：与 DeepSeek 相同，在多步工具调用（最多支持 300 步）中，**必须在历史上下文中完整回传每一轮 Assistant 生成的 `reasoning_content`**，否则会引发校验报错 。

## 深度思考控制与协议规范

针对大语言模型深度推理（Reasoning/Thinking）能力的爆发式普及，各个厂商推出了完全不兼容的控制开关和输出结构。适配层必须对这些专有通道进行无缝抽象。

### 推理引擎控制参数对照表

下表汇集了六家厂商在显式推理模式下的完整控制逻辑：

| **厂商名称**   | **控制参数**                            | **参数可选值**                                  | **默认行为**                   | **输出字段名称**                                             | **历史回传要求**                                             | **强度控制支持**                                             |
| -------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **OpenAI**     | `reasoning_effort`                      | `"low"`, `"medium"`, `"high"`                   | `"medium"`                     | 属于 Response 内部对象，在 Chat 下表现为 `reasoning_tokens`  | 自动，客户端在标准 Chat 模式下无需手动回传。                 | 支持（通过配置 effort 档位）                                 |
| **Anthropic**  | `thinking`                              | `{"type": "adaptive"}` , `{"type": "disabled"}` | `"disabled"` (Opus 4.7)        | `content` 数组中 `type: "thinking"` 的 block                 | 必须在最后一轮 assistant 消息中原样回传，包含其解密签名 。   | 显式支持 （在 `output_config` 中配置 `effort`，支持 `max`, `xhigh`, `high`, `medium`, `low` ） |
| **DeepSeek**   | `thinking` (封装于 `extra_body`)        | `{"type": "enabled"}` , `{"type": "disabled"}`  | `"disabled"`                   | 独立的 `reasoning_content` 字段（与 `content` 平级）         | 仅在触发工具调用时必须回传，无工具调用时可忽略并静默处理 。  | 支持通过 `reasoning_effort`（值包含 `"high"`、`"max"` 等）进行控制 。 |
| **GLM / 智谱** | `thinking`                              | `{"type": "enabled"}` , `{"type": "disabled"}`  | `"enabled"` (根据模型自动决策) | 独立的 `reasoning_content` 字段                              | 无需手动回传，服务端内部拼接。                               | 否（模型基于任务复杂度自动动态判断 ）                        |
| **Kimi**       | `thinking` (封装于 `extra_body`)        | `{"type": "enabled"}`, `{"type": "disabled"}`   | `"enabled"`                    | 独立的 `reasoning_content` 字段                              | 必须完整回传以太网及多步工具历史，否则报异常 。              | 否                                                           |
| **MiniMax**    | `reasoning_split` (封装于 `extra_body`) | `true`, `false`                                 | `false`                        | 开启 split 时返回结构化 `reasoning_details`，否则以内置标签输出 。 | 必须完整保留思考 block 或 `<think>` 标签，以维持推理链连续 。 | 否                                                           |



## 流式传输（Streaming）协议规范

在流式输出模式下，如何处理增量文本与增量思考内容的混合输出，是适配层解析模块的核心技术难点。各厂商虽然基于 SSE 协议进行流式传输，但事件类型与增量数据包装结构大相径庭 。

### 厂商流式 Payload 深度解析

1. **OpenAI Chat Completions 基础流**：SSE 推送的数据块中，增量文本存放在 `choices.delta.content` 内 。流结束时，最后一个 chunk 的 `finish_reason` 不为空，且在配置了 `stream_options: {"include_usage": true}` 时，在流尾返回最终的 `usage` 统计。
2. **OpenAI Responses 流**：SSE 事件名包含丰富的主动通知，例如 `response.created`、`response.output_item.added`、`response.delta`，并最终以 `response.done` 作为流结束标识 。
3. **Anthropic 强类型流**：通过多组细分事件进行事件驱动式传输，其生命周期为：`message_start` -> `content_block_start`（告知当前 block 的 type，如 `thinking`） -> `content_block_delta`（增量输出思考或文本内容） -> `content_block_stop` -> `message_delta` -> `message_stop` 。思考和正文通过不同的 block 序号（`index`）以及 block 类型完全隔离，无需客户端执行任何复杂的正则表达式拆分 。
4. **DeepSeek、GLM、Kimi 扩展流**：流式传输期间，在 `delta` 对象下同时向客户端输出 `delta.reasoning_content`（增量思考内容）和 `delta.content`（增量正文内容） 。由于这两个字段是并发或交替输出的，适配层必须通过检查字段是否存在，将流数据正确分流至不同的统一事件中 。
5. **MiniMax Interleaved 流**：若开启 `reasoning_split`，其增量思考内容将通过 `delta.reasoning_details` 数组进行流式分发 ；若未开启，则会在 `delta.content` 中流式混入 `<think>` 和 `</think>` 标签 ，适配层必须通过轻量级状态机检测该标签，以隔离思考输出 。

## 结构化输出协议规范

当 Agent 需要向外部工具传递严格受控的数据格式（例如 JSON 格式的输出）时，结构化输出（Structured Outputs）协议的适配决定了数据路由的安全边界 。

| **厂商**      | **原生 JSON Object 支持** | **原生 JSON Schema 支持**            | **严格模式（Strict Schema）**  | **激活配置字段名称**                       | **校验失败降级方案**                                         |
| ------------- | ------------------------- | ------------------------------------ | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| **OpenAI**    | 是                        | 是                                   | 是                             | `response_format` 或 `text.format`         | 无需降级，引擎通过受约束的解码算法强制保证 100% 格式合规 。  |
| **Anthropic** | 是                        | 是（仅能通过 Tool 强制绑定间接支持） | 是（原生 Claude 具备高置信度） | `output_config.format` 或注册专有提取 Tool | 将 JSON Schema 解析为明文的 TypeScript 定义，注入到 `system` 提示词中，并添加示例进行提示词调优 。 |
| **DeepSeek**  | 是                        | 否                                   | 否                             | `response_format`                          | 通过 User/System 提示词强化 XML 闭合标签约束，在适配层对非标 JSON 执行正则清洗。 |
| **GLM/智谱**  | 是                        | 否                                   | 否                             | `response_format`                          | 定义一个单工具代理路由，迫使模型只能通过执行该工具来隐式输出结构化载荷。 |
| **Kimi**      | 是                        | 否                                   | 否                             | `response_format`                          | 启用系统级格式化模版，在客户端拦截输出并使用自定义 JSON 修复器。 |
| **MiniMax**   | 是                        | 否                                   | 否                             | `response_format`                          | 利用内置的推理链分裂功能，强制指定后续回答必须符合特定的 JSON 键值对规范。 |



## 多轮状态管理与上下文压缩差异

Agent 应用通常需要维持超长的对话链路，状态托管与缓存（Prompt Cache）机制决定了系统的生产成本与响应时延 。

```
             +-----------------------------------------+
             |             统一 Agent Runtime          |
             +-----------------------------------------+
                                  |
         +------------------------+------------------------+
         |                                                 |
         v                                                 v
+------------------+                             +------------------+
|  服务端状态托管    |                             |   客户端状态维护   |
| (OpenAI Responses|                             | (Anthropic,      |
| / Conversations) |                             | DeepSeek, GLM,   |
|                  |                             | Kimi, MiniMax)   |
+------------------+                             +------------------+
         |                                                 |
         | previous_response_id                            | 必须发送完整历史，且
         | 级联状态                                         | 必须保留 reasoning_content
         v                                                 v
+------------------+                             +------------------+
| 极低客户端开销，   |                             | 结合 Prompt Cache|
| 支持服务端 compaction |                         | (如 Anthropic)    |
|    |                             | 降低输入带宽成本  |
+------------------+                             +------------------+
```

### 服务端托管 vs 客户端自维护

- **OpenAI Responses Stateful Pattern**：允许通过创建 Conversation 或在请求中携带 `previous_response_id`，将完整的对话轨迹全部存储于 OpenAI 服务端 。客户端在后续交互时，仅需传递当前帧的增量用户输入，大幅节省网络传输带宽，且服务端会自动在后台执行上下文压缩（Compaction）以防止窗口溢出 。
- **Stateless Multi-turn Pattern**：除 OpenAI 外，所有其他厂商均不提供服务端多轮状态托管，必须由客户端维护并回传完整的 `messages` 历史数据 。

### 上下文缓存（Prompt Caching）集成建议

由于客户端需要上传全部历史，适配层必须充分利用各大厂商提供的提示词缓存（Context Caching）机制来降低成本：

1. **Anthropic**：支持在 `messages` 数组的特定位置显式注入 `"cache_control": {"type": "ephemeral"}` 标记，从而对长篇幅的工具定义或系统 Prompt 进行强缓存 。
2. **DeepSeek**：提供完全自动化的上下文缓存，API 会在后台检测输入的前缀匹配度，并在 `usage` 中自动输出 `cached_tokens` 以享用折扣价格。
3. **Kimi**：对长文本及历史上下文提供自动缓存技术，对频繁多轮对话的智能体应用友好。

## 错误处理、Token 计费与 Usage 差异

适配层必须对各种非标错误编码和计费字段进行归一化，以便上层 Agent Runtime 能够做出正确的重试决策并精准统计运行成本 。

### 计费 Token 字段非标差异

- **推理 Token 细分**：
  - **OpenAI**：在 `usage` 下提供 `completion_tokens_details.reasoning_tokens`。
  - **DeepSeek**：在 `usage` 下直接提供与 `completion_tokens` 同级的专有字段 `completion_tokens_details.reasoning_tokens`。
  - **GLM/智谱**：在 `usage` 下提供 `completion_tokens`，其中已在服务端默默包含思考 Token 消耗，不作细分字段区分 。
  - **Anthropic**：生成的 `thinking` token 直接归入输出 token 计费中 ，但在进行 `count_tokens` 输入评估时，先前历史里的 thinking tokens 会被自动剔除不重复计算 。
- **缓存命中 Token 细分**：
  - **OpenAI**：`prompt_tokens_details.cached_tokens`。
  - **DeepSeek**：`prompt_tokens_details.cached_tokens` 。
  - **Anthropic**：使用专有的 `cache_read_input_tokens` 和 `cache_creation_input_tokens` 计费指标。

### 统一异常重试判定逻辑

适配器应当将底层的非标错误对象（如 OpenAI 的嵌套 `error.message` 与 Anthropic 的顶层 `type`）归一化为 `UnifiedError` 结构，并基于以下规则判断 `retryable`（可重试性）：

1. **HTTP 429 (Rate Limit)**：判定为 `retryable = true`，推荐使用指数退避算法（Exponential Backoff）并在适配层自愈。
2. **HTTP 400 (Parameter Conflict / Invalid Request)**：判定为 `retryable = false`，通常是因为在特定模型下传递了不支持的超参数（如在 Claude Opus 4.7 思考模式下带了非默认温度值，或 DeepSeek 思考模式下带了 `tool_choice`） 。必须在适配层阻断并记录排查日志。
3. **HTTP 400 (Historical CoT Missing)**：在 DeepSeek 或 Kimi 模式下由于历史中剔除了 `reasoning_content` 引发的校验失败 ，适配器判定为 `retryable = false`，应提示 Agent Runtime 修正历史上下文组装逻辑。

## 工程抽象与适配层实现建议

基于以上对异构协议的系统性剖析，本部分为 Codex 及开发团队提供可以直接工程落地的 TypeScript 接口设计、JSON 能力矩阵以及完整的两轮工具调用序列。

### 推荐实现优先级

为了以最小的开发成本获取最大的生态兼容度，适配层开发应当严格遵循以下优先级路径进行阶梯式迭代：

```
+-----------------------------------------------------------------+
| 优先级 1: 统一 OpenAI Chat Completions 协议                      |
| (快速跑通 DeepSeek, GLM, Kimi, MiniMax 的无状态基础对话与工具调用)|
+-----------------------------------------------------------------+
                                |
                                v
+-----------------------------------------------------------------+
| 优先级 2: 接入 Anthropic Messages 原生 API 适配                  |
| (跳过 OpenAI Proxy 过渡层，实现高质量的 Adaptive 思考及缓存控制)   |
+-----------------------------------------------------------------+
                                |
                                v
+-----------------------------------------------------------------+
| 优先级 3: 研发 厂商推理扩展逻辑 (DeepSeek, Kimi, MiniMax 等的      |
| 历史 CoT 回传约束与思考文本自动分流拦截)                          |
+-----------------------------------------------------------------+
                                |
                                v
+-----------------------------------------------------------------+
| 优先级 4: 适配 OpenAI Responses API 协议                         |
| (实现服务端状态托管、previous_response_id 级联及 Server-side Tool) |
+-----------------------------------------------------------------+
```

## llm-provider-capability-matrix.json

JSON

```
{
  "matrix": {
    "openai-gpt-5": {
      "provider": "openai",
      "model": "gpt-5",
      "protocol": "openai_responses",
      "supportsText": true,
      "supportsVision": true,
      "supportsAudio": true,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": true,
      "supportsReasoning": true,
      "reasoningControl": "openai_reasoning_effort",
      "reasoningOutput": "openai_reasoning_item",
      "reasoningPreservation": "optional",
      "supportsJsonMode": true,
      "supportsJsonSchema": true,
      "supportsStrictSchema": true,
      "supportsServerSideState": true,
      "supportsPreviousResponseId": true,
      "requiresClientSideHistory": false,
      "contextWindow": 200000,
      "maxOutputTokens": 16384,
      "unsupportedParams":,
      "ignoredParams":,
      "dangerousParams":,
      "officialSources":
    },
    "claude-opus-4.7": {
      "provider": "anthropic",
      "model": "claude-opus-4.7",
      "protocol": "anthropic_messages",
      "supportsText": true,
      "supportsVision": true,
      "supportsAudio": false,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": false,
      "supportsReasoning": true,
      "reasoningControl": "anthropic_adaptive_effort",
      "reasoningOutput": "anthropic_thinking_block",
      "reasoningPreservation": "required_for_tool_use",
      "supportsJsonMode": true,
      "supportsJsonSchema": true,
      "supportsStrictSchema": true,
      "supportsServerSideState": false,
      "supportsPreviousResponseId": false,
      "requiresClientSideHistory": true,
      "contextWindow": 1000000,
      "maxOutputTokens": 64000,
      "unsupportedParams": ["temperature", "top_p", "top_k"],
      "ignoredParams":,
      "dangerousParams": ["temperature"],
      "officialSources": [
        {
          "url": "https://platform.claude.com/docs/en/about-claude/models/migration-guide",
          "documentName": "Claude Opus 4.7 Migration Guide",
          "accessedAt": "2026-05-21"
        }
      ]
    },
    "deepseek-v4-pro": {
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "protocol": "vendor_openai_chat_with_extensions",
      "supportsText": true,
      "supportsVision": false,
      "supportsAudio": false,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": false,
      "supportsReasoning": true,
      "reasoningControl": "reasoning_effort_high_max",
      "reasoningOutput": "reasoning_content",
      "reasoningPreservation": "required_for_tool_use",
      "supportsJsonMode": true,
      "supportsJsonSchema": false,
      "supportsStrictSchema": false,
      "supportsServerSideState": false,
      "supportsPreviousResponseId": false,
      "requiresClientSideHistory": true,
      "contextWindow": 1000000,
      "maxOutputTokens": 128000,
      "unsupportedParams": ["tool_choice"],
      "ignoredParams": ["presence_penalty", "frequency_penalty"],
      "dangerousParams": ["tool_choice"],
      "officialSources":
    },
    "glm-5.1": {
      "provider": "zhipu",
      "model": "glm-5.1",
      "protocol": "vendor_openai_chat_with_extensions",
      "supportsText": true,
      "supportsVision": true,
      "supportsAudio": false,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": false,
      "supportsReasoning": true,
      "reasoningControl": "thinking_enabled_disabled",
      "reasoningOutput": "reasoning_content",
      "reasoningPreservation": "recommended",
      "supportsJsonMode": true,
      "supportsJsonSchema": false,
      "supportsStrictSchema": false,
      "supportsServerSideState": false,
      "supportsPreviousResponseId": false,
      "requiresClientSideHistory": true,
      "contextWindow": 128000,
      "maxOutputTokens": 4096,
      "unsupportedParams":,
      "ignoredParams":,
      "dangerousParams":,
      "officialSources":
    },
    "kimi-k2.6": {
      "provider": "moonshot",
      "model": "kimi-k2.6",
      "protocol": "vendor_openai_chat_with_extensions",
      "supportsText": true,
      "supportsVision": true,
      "supportsAudio": false,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": true,
      "supportsReasoning": true,
      "reasoningControl": "thinking_enabled_disabled",
      "reasoningOutput": "reasoning_content",
      "reasoningPreservation": "required_for_tool_use",
      "supportsJsonMode": true,
      "supportsJsonSchema": false,
      "supportsStrictSchema": false,
      "supportsServerSideState": false,
      "supportsPreviousResponseId": false,
      "requiresClientSideHistory": true,
      "contextWindow": 256000,
      "maxOutputTokens": 32768,
      "unsupportedParams":,
      "ignoredParams":,
      "dangerousParams":,
      "officialSources": [
        {
          "url": "https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart",
          "documentName": "Kimi K2.6 Quickstart",
          "accessedAt": "2026-05-21"
        }
      ]
    },
    "minimax-m2.7": {
      "provider": "minimax",
      "model": "MiniMax-M2.7",
      "protocol": "vendor_openai_chat_with_extensions",
      "supportsText": true,
      "supportsVision": false,
      "supportsAudio": false,
      "supportsFunctionCalling": true,
      "supportsParallelToolCalls": true,
      "supportsToolStreaming": true,
      "supportsBuiltInTools": false,
      "supportsReasoning": true,
      "reasoningControl": "reasoning_split",
      "reasoningOutput": "reasoning_details",
      "reasoningPreservation": "required_for_multi_turn",
      "supportsJsonMode": true,
      "supportsJsonSchema": false,
      "supportsStrictSchema": false,
      "supportsServerSideState": false,
      "supportsPreviousResponseId": false,
      "requiresClientSideHistory": true,
      "contextWindow": 256000,
      "maxOutputTokens": 8192,
      "unsupportedParams":,
      "ignoredParams":,
      "dangerousParams":,
      "officialSources":
    }
  }
}
```

## llm-unified-protocol.types.ts

TypeScript

```
/**
 * 厂商底层连线通信协议枚举
 */
export type ProviderWireProtocol =
  | "openai_responses"
  | "openai_chat_completions"
  | "anthropic_messages"
  | "vendor_native"
  | "vendor_openai_chat_with_extensions";

/**
 * 官方文档资源索引引用
 */
export interface SourceReference {
  url: string;
  documentName: string;
  accessedAt: string;
}

/**
 * 厂商基础通信及能力 Profile
 */
export interface ProviderProtocolProfile {
  provider: string;
  baseUrls: string;
  recommendedProtocol:
    | "openai_responses"
    | "openai_chat_completions"
    | "anthropic_messages"
    | "native"
    | "multiple";
  supportsOpenAIResponses: boolean;
  supportsOpenAIChatCompletions: boolean;
  supportsOpenAISDK: boolean;
  supportsAnthropicMessages: boolean;
  hasNativeProtocol: boolean;
  officialRecommendation?: string;
  compatibilityCaveats: string;
  sources: SourceReference;
}

/**
 * 模型细化能力与参数行为约束矩阵
 */
export interface ModelCapabilityProfile {
  provider: string;
  model: string;
  protocol: ProviderWireProtocol;

  // 多模态基本支持
  supportsText: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;

  // 工具链支持
  supportsFunctionCalling: boolean;
  supportsParallelToolCalls: boolean;
  supportsToolStreaming: boolean;
  supportsBuiltInTools: boolean;

  // 深度思考配置及机制
  supportsReasoning: boolean;
  reasoningControl:
    | "none"
    | "openai_reasoning_effort"
    | "anthropic_budget_tokens"
    | "anthropic_adaptive_effort"
    | "thinking_enabled_disabled"
    | "reasoning_effort_high_max"
    | "reasoning_split"
    | "vendor_specific";
  reasoningOutput:
    | "none"
    | "openai_reasoning_item"
    | "reasoning_content"
    | "reasoning_details"
    | "think_tag"
    | "anthropic_thinking_block"
    | "opaque";
  reasoningPreservation:
    | "drop"
    | "optional"
    | "recommended"
    | "required_for_tool_use"
    | "required_for_multi_turn";

  // 结构化输出支持
  supportsJsonMode: boolean;
  supportsJsonSchema: boolean;
  supportsStrictSchema: boolean;

  // 上下文与状态存储
  supportsServerSideState: boolean;
  supportsPreviousResponseId: boolean;
  requiresClientSideHistory: boolean;

  // 基础窗口限制
  contextWindow?: number;
  maxOutputTokens?: number;

  // 适配器清洗超参黑名单
  unsupportedParams: string;
  ignoredParams: string;
  dangerousParams: string; // 传入必然引发 400 校验挂起的敏感超参

  officialSources: SourceReference;
}

/**
 * 统一多模态输入 ContentPart
 */
export type UnifiedContentPart =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string }
  | { type: "document"; fileUrl: string; mimeType: string };

/**
 * 归一化的输入消息项
 */
export interface UnifiedInputItem {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | UnifiedContentPart;
  reasoningContent?: string;
  toolCallId?: string;
  toolCalls?: UnifiedToolCall;
}

/**
 * 归一化的工具定义 Schema
 */
export interface UnifiedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/**
 * 强类型工具强制选择
 */
export type UnifiedToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "tool"; name: string };

/**
 * 思考机制深度控制配置
 */
export interface UnifiedReasoningConfig {
  enabled: boolean;
  effort?: "low" | "medium" | "high" | "max" | "xhigh";
  budgetTokens?: number;
}

/**
 * 归一化结构化响应输出配置
 */
export interface UnifiedTextConfig {
  format: "text" | "json_object" | "json_schema";
  schema?: Record<string, unknown>;
}

/**
 * 适配器输入请求：逼近 OpenAI Responses 语义
 */
export interface UnifiedLLMRequest {
  model: string;
  input: UnifiedInputItem;
  tools?: UnifiedTool;
  toolChoice?: UnifiedToolChoice;
  reasoning?: UnifiedReasoningConfig;
  text?: UnifiedTextConfig;
  stream?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 归一化计费及 Usage 指标统计
 */
export interface UnifiedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  raw?: unknown;
}

/**
 * 归一化异常体系
 */
export interface UnifiedError {
  provider: string;
  status?: number;
  code?: string;
  type?: string;
  message: string;
  retryable?: boolean;
  raw?: unknown;
}

/**
 * 统一流输出增量通知事件类型
 */
export type UnifiedStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text?: string; raw?: unknown }
  | { type: "tool_call_start"; id: string; name?: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta?: string; raw?: unknown }
  | { type: "tool_call_done"; id: string; name: string; arguments: unknown }
  | { type: "message_done"; raw?: unknown }
  | { type: "usage"; usage: UnifiedUsage; raw?: unknown }
  | { type: "error"; error: UnifiedError; raw?: unknown };

/**
 * 工具调用底层载荷声明
 */
export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 工具结果数据体
 */
export interface UnifiedToolResult {
  toolCallId: string;
  content: string;
}

/**
 * 统一输出内容单元
 */
export type UnifiedOutputItem =
  | { type: "message"; role: "assistant"; content: UnifiedContentPart }
  | { type: "tool_call"; id: string; name: string; arguments: unknown; raw?: unknown }
  | { type: "reasoning"; text?: string; raw?: unknown }
  | { type: "error"; error: UnifiedError; raw?: unknown };

/**
 * 归一化最终 LLM 帧响应
 */
export interface UnifiedLLMResponse {
  id?: string;
  model: string;
  provider: string;
  output: UnifiedOutputItem;
  usage?: UnifiedUsage;
  stopReason?: string;
  raw: unknown;
}

/**
 * 适配器层编译、清洗及流解析转换器
 */
export interface LLMProviderAdapter {
  /**
   * 将高层 UnifiedRequest 翻译为具体厂商承载的 payload 对象
   */
  compileRequest(request: UnifiedLLMRequest, profile: ModelCapabilityProfile): Record<string, unknown>;

  /**
   * 将厂商端非流响应结构转换为高层 UnifiedLLMResponse
   */
  parseResponse(response: unknown, profile: ModelCapabilityProfile): UnifiedLLMResponse;

  /**
   * SSE 流式分包拦截解析映射器
   */
  parseStreamChunk(chunk: unknown, profile: ModelCapabilityProfile): UnifiedStreamEvent;

  /**
   * 专有工具回传拼接器
   */
  compileToolResult(result: UnifiedToolResult, profile: ModelCapabilityProfile): unknown;
}
```

## 示例 Fixtures

### fixtures/openai-responses-tool-call.json

JSON

```
{
  "request": {
    "model": "gpt-5",
    "instructions": "You are a stateful systems engineering agent.",
    "input": "Determine hardware status for node server-x9",
    "tools": [
      {
        "type": "function",
        "name": "check_hardware",
        "description": "Inspect physical node configurations",
        "parameters": {
          "type": "object",
          "properties": {
            "nodeId": { "type": "string" }
          },
          "required": ["nodeId"]
        },
        "strict": true
      }
    ]
  },
  "model_raw_response": {
    "id": "resp_state_68af",
    "object": "response",
    "created_at": 1756315696,
    "model": "gpt-5-2025-08-07",
    "output": [
      {
        "id": "fc_77921",
        "type": "function_call",
        "name": "check_hardware",
        "arguments": "{\"nodeId\":\"server-x9\"}"
      }
    ]
  },
  "tool_result_request": {
    "model": "gpt-5",
    "previous_response_id": "resp_state_68af",
    "input":
  },
  "final_response": {
    "id": "resp_state_99bb",
    "object": "response",
    "created_at": 1756315720,
    "model": "gpt-5-2025-08-07",
    "output":
      }
    ]
  },
  "normalized_unified_response": {
    "id": "resp_state_99bb",
    "model": "gpt-5-2025-08-07",
    "provider": "openai",
    "output":
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/openai-chat-tool-call.json

JSON

```
{
  "request": {
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Get location metrics for container-12" }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_container_metrics",
          "parameters": {
            "type": "object",
            "properties": { "id": { "type": "string" } }
          }
        }
      }
    ]
  },
  "model_raw_response": {
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "tool_calls": [
            {
              "id": "call_chat_99a",
              "type": "function",
              "function": {
                "name": "get_container_metrics",
                "arguments": "{\"id\":\"container-12\"}"
              }
            }
          ]
        },
        "finish_reason": "tool_calls"
      }
    ]
  },
  "tool_result_request": {
    "model": "gpt-4o",
    "messages": [
      { "role": "user", "content": "Get location metrics for container-12" },
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_chat_99a",
            "type": "function",
            "function": {
              "name": "get_container_metrics",
              "arguments": "{\"id\":\"container-12\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "call_chat_99a",
        "content": "{\"region\":\"us-east-1\",\"pod\":\"k8s-pod-b\"}"
      }
    ]
  },
  "final_response": {
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "Container-12 is currently running inside pod k8s-pod-b located within the us-east-1 region."
        },
        "finish_reason": "stop"
      }
    ]
  },
  "normalized_unified_response": {
    "model": "gpt-4o",
    "provider": "openai",
    "output": [
      {
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Container-12 is currently running inside pod k8s-pod-b located within the us-east-1 region."
          }
        ]
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/anthropic-tool-call.json

JSON

```
{
  "request": {
    "model": "claude-opus-4.7",
    "max_tokens": 16000,
    "system": "You are a cloud infrastructure agent.",
    "messages": [
      { "role": "user", "content": "Inspect latency metrics for routing-hub" }
    ],
    "tools": [
      {
        "name": "get_latency",
        "description": "Fetch real-time latency diagnostics",
        "input_schema": {
          "type": "object",
          "properties": { "endpoint": { "type": "string" } }
        }
      }
    ],
    "thinking": {
      "type": "adaptive"
    },
    "output_config": {
      "effort": "high"
    }
  },
  "model_raw_response": {
    "id": "msg_ant_7831",
    "type": "message",
    "role": "assistant",
    "content":,
    "stop_reason": "tool_use"
  },
  "tool_result_request": {
    "model": "claude-opus-4.7",
    "max_tokens": 16000,
    "system": "You are a cloud infrastructure agent.",
    "messages":
      },
      {
        "role": "user",
        "content": [
          {
            "type": "tool_result",
            "tool_use_id": "tool_use_ant_1",
            "content": "{\"ping_ms\": 4.2}"
          }
        ]
      }
    ],
    "thinking": {
      "type": "adaptive"
    },
    "output_config": {
      "effort": "high"
    }
  },
  "final_response": {
    "id": "msg_ant_7832",
    "type": "message",
    "role": "assistant",
    "content":,
    "stop_reason": "end_turn"
  },
  "normalized_unified_response": {
    "id": "msg_ant_7832",
    "model": "claude-opus-4.7",
    "provider": "anthropic",
    "output":
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/deepseek-thinking-tool-call.json

JSON

```
{
  "request": {
    "model": "deepseek-v4-pro",
    "messages": [
      { "role": "user", "content": "Evaluate database metrics for db-replica-1" }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_db_metrics",
          "parameters": {
            "type": "object",
            "properties": { "instance": { "type": "string" } }
          }
        }
      }
    ],
    "extra_body": {
      "thinking": { "type": "enabled" }
    }
  },
  "model_raw_response": {
    "choices":
        },
        "finish_reason": "tool_calls"
      }
    ]
  },
  "tool_result_request": {
    "model": "deepseek-v4-pro",
    "messages":
      },
      {
        "role": "tool",
        "tool_call_id": "call_ds_90112",
        "content": "{\"cpu\": 92, \"replication_lag_sec\": 120}"
      }
    ],
    "extra_body": {
      "thinking": { "type": "enabled" }
    }
  },
  "final_response": {
    "choices":
  },
  "normalized_unified_response": {
    "model": "deepseek-v4-pro",
    "provider": "deepseek",
    "output":
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/glm-thinking-tool-call.json

JSON

```
{
  "request": {
    "model": "glm-5.1",
    "messages":,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "validate_subnet",
          "parameters": {
            "type": "object",
            "properties": { "subnet_id": { "type": "string" } }
          }
        }
      }
    ],
    "thinking": {
      "type": "enabled"
    }
  },
  "model_raw_response": {
    "choices":
        },
        "finish_reason": "tool_calls"
      }
    ]
  },
  "tool_result_request": {
    "model": "glm-5.1",
    "messages":
      },
      {
        "role": "tool",
        "tool_call_id": "call_glm_556",
        "content": "{\"status\":\"overlap_detected\",\"route_table_conflict\":true}"
      }
    ],
    "thinking": {
      "type": "enabled"
    }
  },
  "final_response": {
    "choices":
  },
  "normalized_unified_response": {
    "model": "glm-5.1",
    "provider": "zhipu",
    "output":
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/kimi-thinking-tool-call.json

JSON

```
{
  "request": {
    "model": "kimi-k2.6",
    "messages": [
      { "role": "user", "content": "Check service-gateway thread states" }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_threads",
          "parameters": {
            "type": "object",
            "properties": { "service": { "type": "string" } }
          }
        }
      }
    ]
  },
  "model_raw_response": {
    "choices":
        },
        "finish_reason": "tool_calls"
      }
    ]
  },
  "tool_result_request": {
    "model": "kimi-k2.6",
    "messages":
      },
      {
        "role": "tool",
        "tool_call_id": "call_kimi_8891",
        "content": "{\"active\":256,\"deadlocked\":3}"
      }
    ]
  },
  "final_response": {
    "choices":
  },
  "normalized_unified_response": {
    "model": "kimi-k2.6",
    "provider": "moonshot",
    "output":
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```

### fixtures/minimax-thinking-tool-call.json

JSON

```
{
  "request": {
    "model": "MiniMax-M2.7",
    "messages": [
      { "role": "user", "content": "Extract load profiles for cluster-gamma" }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_cluster_load",
          "parameters": {
            "type": "object",
            "properties": { "cluster_name": { "type": "string" } }
          }
        }
      }
    ],
    "extra_body": {
      "reasoning_split": true
    }
  },
  "model_raw_response": {
    "choices":,
          "tool_calls": [
            {
              "id": "call_mm_0911",
              "type": "function",
              "function": {
                "name": "get_cluster_load",
                "arguments": "{\"cluster_name\":\"cluster-gamma\"}"
              }
            }
          ]
        },
        "finish_reason": "tool_calls"
      }
    ]
  },
  "tool_result_request": {
    "model": "MiniMax-M2.7",
    "messages":,
        "tool_calls": [
          {
            "id": "call_mm_0911",
            "type": "function",
            "function": {
              "name": "get_cluster_load",
              "arguments": "{\"cluster_name\":\"cluster-gamma\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "call_mm_0911",
        "content": "{\"load_average_15m\": 14.8, \"node_count\": 16}"
      }
    ],
    "extra_body": {
      "reasoning_split": true
    }
  },
  "final_response": {
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "Cluster-gamma shows high utilization. Average load over 15 minutes is 14.8 across 16 active computation nodes."
        },
        "finish_reason": "stop"
      }
    ]
  },
  "normalized_unified_response": {
    "model": "MiniMax-M2.7",
    "provider": "minimax",
    "output": [
      {
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Cluster-gamma shows high utilization. Average load over 15 minutes is 14.8 across 16 active computation nodes."
          }
        ]
      }
    ],
    "usage": {},
    "stopReason": "stop",
    "raw": {}
  }
}
```