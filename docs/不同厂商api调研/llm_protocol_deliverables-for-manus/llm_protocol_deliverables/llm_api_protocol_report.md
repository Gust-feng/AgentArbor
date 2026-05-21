# 六家大模型 API 协议差异调研报告

作者：**Manus AI**
日期：2026-05-20 GMT+8
范围：OpenAI、Anthropic、DeepSeek、Z.AI/GLM、Kimi/Moonshot、MiniMax

## 摘要

本报告的目标是为 Codex 或其他工程实现者提供一份可落地的协议差异说明，用于构建多厂商 LLM API 统一适配层。调研结论显示，六家厂商并不存在一个真正统一的“OpenAI 协议”。OpenAI 自身已经将新项目推荐路径转向 **Responses API**，而 DeepSeek、Z.AI、Kimi/Moonshot 与 MiniMax 主流兼容的是 **OpenAI Chat Completions** 风格；Anthropic 则以 **Messages API** 为原生协议，并通过兼容层提供有限的 OpenAI SDK 适配。[1] [2] [3] [4]

> **核心建议**：适配层应抽象为三个协议族，而不是一个“OpenAI-compatible”分支。三个协议族分别是 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages。每个厂商适配器只负责将统一请求映射到目标协议族及其扩展字段。

## 一、协议族总览

| 厂商 | 推荐接入协议 | 主要 base URL | 典型端点 | SDK 兼容 | 关键判断 |
| --- | --- | --- | --- | --- | --- |
| OpenAI | OpenAI Responses | `https://api.openai.com/v1` | `/v1/responses` | OpenAI SDK | 新项目优先 Responses；Chat Completions 仍支持但不应作为新适配层主协议。[1] [2] |
| Anthropic | Anthropic Messages | `https://api.anthropic.com` | `/v1/messages` | Anthropic SDK；有限 OpenAI SDK compatibility | 原生 Messages 支持 content blocks、tool_use/tool_result 与 extended thinking；OpenAI 兼容层忽略多项字段。[3] [5] |
| DeepSeek | OpenAI Chat-compatible | `https://api.deepseek.com`；Anthropic 兼容为 `/anthropic` | `/chat/completions` | OpenAI SDK；Anthropic-compatible | 支持 `thinking`、`reasoning_effort`、`reasoning_content` 与 Chat 工具调用。[6] [7] |
| Z.AI / GLM | OpenAI Chat-like HTTP | `https://api.z.ai/api/paas/v4/` | `/chat/completions` | HTTP；OpenAI-like schema | 支持 multimodal content、thinking 示例与 Chat 风格工具调用。[8] [9] |
| Kimi / Moonshot | OpenAI Chat-compatible | `https://api.moonshot.ai/v1` | `/v1/chat/completions` | OpenAI SDK；另有 Anthropic-compatible API 说明 | OpenAI Chat request/response 兼容；`thinking` 通过 `extra_body`，`partial` 在 assistant message 上。[10] [11] |
| MiniMax | Anthropic SDK 推荐；OpenAI Chat-compatible 可用 | `https://api.minimax.io/v1`；Anthropic 兼容为 `https://api.minimax.io/anthropic` | `/v1/chat/completions` 或 Anthropic-compatible | OpenAI SDK、Anthropic SDK | M 系列模型 204,800 context；OpenAI-compatible 中 `reasoning_split` 输出 `reasoning_details`。[12] [13] |

## 二、OpenAI：Responses 与 Chat Completions 的分界

OpenAI 官方迁移文档将 Responses API 描述为 Chat Completions 的演进，并推荐新项目使用 Responses API。其输入不再以 `messages` 作为唯一中心，而是使用 `input`、`instructions`、`tools`、`text.format`、`previous_response_id` 等字段组织任务。Responses 输出使用 `output[]` item，常见类型包括 `message`、`function_call`、`function_call_output` 与 `reasoning`，这与 Chat Completions 的 `choices[].message` 结构不同。[1] [2]

| 维度 | OpenAI Responses | OpenAI Chat Completions |
| --- | --- | --- |
| 输入主字段 | `input`、`instructions` | `messages` |
| 输出主字段 | `output[]` items | `choices[].message` |
| 结构化输出 | `text.format` | `response_format` |
| 工具调用 | `function_call` item；工具结果为 `function_call_output` | assistant `tool_calls[]`；工具结果为 `role: tool` |
| 状态管理 | `previous_response_id`、Conversations、`store` | 客户端维护 messages |
| 流式模型 | Responses events，事件类型需容错 | chat completion chunks |

OpenAI 官方 API overview 还提醒流式事件与 JSON 响应对象未来可能新增字段或事件类型，因此适配层应显式保留 raw event，并对未知 event type 采取 forward-compatible 策略。[1]

## 三、Anthropic：Messages、content blocks 与工具回合

Anthropic 原生 Messages API 采用 `POST /v1/messages`，请求中 `model`、`messages` 与 `max_tokens` 是核心字段，系统提示位于顶层 `system`。工具调用不是 OpenAI Chat 的 `role: tool` 模型，而是 assistant content 中的 `tool_use` block；应用执行工具后，需要在后续 user message 的 content 中加入 `tool_result` block。[3] [4]

| 项目 | Anthropic 原生协议 | OpenAI Chat 风格 |
| --- | --- | --- |
| 系统提示 | 顶层 `system` | `messages[]` 中的 system/developer |
| 工具调用 | `tool_use` content block | assistant `tool_calls[]` |
| 工具结果 | user message 内 `tool_result` block | `role: tool` message |
| 流式事件 | `message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop` | data-only SSE chunk |
| Thinking | `thinking` config 与 `thinking` block | 各厂商扩展字段或无原生等价 |

Anthropic extended thinking 通过 `thinking` 配置启用。文档显示，传统手动模式为 `thinking: { type: "enabled", budget_tokens: N }`，但 Claude Opus 4.7 不再支持手动 extended thinking，需要使用 adaptive thinking；Claude Opus 4.6 与 Sonnet 4.6 推荐 adaptive thinking，手动模式仍可用但已被标记为 deprecated。响应会包含 `thinking` content block 与 `signature`，随后才是 `text` block。[5]

Anthropic 的 OpenAI SDK compatibility 是实用兼容层，但并非完整语义等价。并行调研与官方兼容文档显示，`response_format`、`reasoning_effort`、`metadata`、`presence_penalty`、`frequency_penalty` 等字段会被忽略，函数调用中的 `strict` 也会被忽略。因此需要完整工具 schema 约束、prompt caching 或 extended thinking 时，应使用原生 Messages API。[14]

## 四、DeepSeek：Chat-compatible 加 thinking/reasoning 扩展

DeepSeek 官方文档明确声明其 API 格式兼容 OpenAI/Anthropic。OpenAI-compatible base URL 是 `https://api.deepseek.com`，Anthropic-compatible base URL 是 `https://api.deepseek.com/anthropic`。官方示例使用 OpenAI SDK 调用 `/chat/completions`，而不是 OpenAI Responses。[6]

DeepSeek Chat Completion 请求支持 `thinking` 与 `reasoning_effort`。`thinking.type` 可为 `enabled` 或 `disabled`，默认 `enabled`；`reasoning_effort` 支持 `high` 与 `max`，低档值会映射到 `high`。响应中，thinking 模式会在 `choices[].message.reasoning_content` 返回最终答案前的 reasoning 内容；最终答案仍在 `choices[].message.content`。[7]

| 能力 | DeepSeek 表现 | 适配建议 |
| --- | --- | --- |
| Thinking 开关 | `thinking: { type: "enabled" | "disabled" }` | 映射自统一 `reasoning.enabled` |
| Reasoning effort | `high`、`max`；低档映射到 `high` | 将 `low/medium/high/max` 归一后降级 |
| JSON mode | `response_format.type=json_object` | 必须同时在 prompt 要求 JSON，否则可能长时间输出空白 |
| Tools | OpenAI Chat 风格，最多 128 functions | 校验 `function.arguments` JSON |
| Streaming | data-only SSE，以 `data: [DONE]` 结束 | 解析 include_usage 额外 chunk |

## 五、Z.AI / GLM：OpenAI Chat-like 与多模态输入

Z.AI 通用 API endpoint 为 `https://api.z.ai/api/paas/v4/`，Chat Completion 完整路径为 `https://api.z.ai/api/paas/v4/chat/completions`。其 schema 明确要求 `model` 与 `messages`，并支持 system、user、assistant 与 tool message。文档示例显示 `thinking: { type: enabled }`，以及 function call 中的 `tools` 与 `tool_choice: auto`。[8] [9]

Z.AI 的优势在于文档中较明确地列出 multimodal content part，支持 text、image、audio、video 与 file。视觉/文件输入示例使用 `image_url`、`video_url`、`file_url` 与 `text` part。工具调用仍是 Chat 风格：assistant message 可以包含 `tool_calls`，工具结果用 `role: tool` 回传。[8]

## 六、Kimi / Moonshot：OpenAI Chat 兼容与平台扩展

Kimi Open Platform 服务地址为 `https://api.moonshot.ai`，使用 SDK 时 base URL 为 `https://api.moonshot.ai/v1`。官方 API Overview 明确说明其 API 与 OpenAI Chat Completions API 的 request/response format 兼容，因此可直接使用 OpenAI SDK；这不等于支持 OpenAI Responses。[10]

Kimi 特有扩展包括 `thinking` 与 `partial`。官方说明，使用 SDK 时 `thinking` 需要通过 `extra_body` 传递；`partial` 是 messages 数组内 assistant message 的字段，即 `"partial": true`，不是顶层请求字段。Kimi K2.6 概览显示其支持 text、image 与 video input，并支持 256K context length。[10] [11]

Kimi-K2 GitHub 仓库还说明平台提供 OpenAI/Anthropic-compatible API；Anthropic-compatible API 会将 temperature 映射为 `real_temperature = request_temperature * 0.6`，这意味着跨协议迁移时采样参数并不完全等价。[15]

## 七、MiniMax：推荐 Anthropic SDK，同时提供 OpenAI Chat 兼容

MiniMax API Overview 表示文本生成 API 可以通过 HTTP requests、Anthropic SDK（推荐）或 OpenAI SDK 访问。OpenAI-compatible 文档要求 `OPENAI_BASE_URL=https://api.minimax.io/v1`，并使用 `client.chat.completions.create()` 调用。Anthropic-compatible endpoint 对国际用户为 `https://api.minimax.io/anthropic`，中国用户为 `https://api.minimaxi.com/anthropic`。[12] [13] [16]

MiniMax 对 reasoning 的处理值得单独建模。OpenAI-compatible 示例中，`extra_body={"reasoning_split": True}` 会将 thinking content 拆分到 `choices[0].message.reasoning_details[0]['text']`；streaming 时，reasoning 增量位于 `chunk.choices[0].delta.reasoning_details`。若未启用兼容拆分，M 系列模型可能把 `<think>` tag 内容直接放在 `content` 字段中。MiniMax 还明确要求在多轮 function call 中必须将完整 assistant message 追加到 history，包括 `tool_calls`、`<think>` 或 `reasoning_details`，以维持 reasoning chain 连续性。[13]

| 限制 | MiniMax OpenAI-compatible 文档说明 | 工程影响 |
| --- | --- | --- |
| temperature | 范围 `(0.0, 1.0]`，推荐 1.0，超出报错 | 不能直接复用 OpenAI 的 0–2 范围 |
| 不支持字段 | `presence_penalty`、`frequency_penalty`、`logit_bias` 等会被忽略 | adapter 应过滤或标记 no-op |
| 输入模态 | 当前不支持 image/audio type inputs | 多模态任务不要走 OpenAI-compatible 文本接口 |
| `n` | 只支持 1 | 批量采样需应用层多请求 |
| deprecated `function_call` | 不支持，必须用 `tools` | 不兼容旧 OpenAI function_call 调用 |

## 八、统一适配层设计

统一适配层应公开一个中立请求模型，再按 provider capability 映射。建议核心类型包括 `UnifiedMessage`、`UnifiedTool`、`UnifiedReasoningConfig`、`UnifiedStructuredOutput`、`UnifiedStateConfig` 与 `UnifiedStreamEvent`。其中 provider adapter 必须声明自己支持哪些字段、哪些字段会被忽略、哪些字段需要降级。

| 统一能力 | OpenAI Responses | Anthropic Messages | Chat-compatible 厂商 |
| --- | --- | --- | --- |
| 文本生成 | 原生 | 原生 | 原生兼容 |
| 工具调用 | 原生 output item | 原生 content block | Chat `tool_calls` |
| 工具结果 | `function_call_output` | `tool_result` block | `role: tool` |
| Reasoning | `reasoning` item/配置 | `thinking` config/block | 厂商扩展字段 |
| 结构化输出 | `text.format` | 原生策略或工具约束；OpenAI 兼容层常忽略 | `response_format` 或 prompt-only |
| 服务端状态 | `previous_response_id` / Conversations | 无通用 server state | 无通用 server state |
| Streaming | Responses events | Anthropic SSE named events | Chat SSE chunks |

推荐的内部 streaming 事件模型如下：`message_start`、`text_delta`、`reasoning_delta`、`tool_call_start`、`tool_call_delta`、`tool_call_done`、`usage_delta`、`message_stop` 与 `error`。每个内部事件应保留 `provider`、`raw_event` 与 `raw_chunk`，以保证未知字段与未来协议扩展不会破坏解析。

## 九、工程实现优先级

第一阶段应实现三个协议族基类：`OpenAIResponsesAdapter`、`OpenAIChatAdapter` 与 `AnthropicMessagesAdapter`。第二阶段以 `OpenAIChatAdapter` 为基类派生 DeepSeek、Z.AI、Kimi、MiniMax 四个子适配器，并覆盖 base URL、模型名、reasoning 映射、字段过滤、stream parser 与 tool round-trip。第三阶段增加 conformance fixtures，覆盖普通文本、工具两轮、reasoning、streaming、结构化输出、状态管理与错误处理。

> 如果只能先实现一条主线，建议优先完成 **OpenAI Chat-compatible 子系统**，因为 DeepSeek、Z.AI、Kimi 与 MiniMax 都能归入该族；随后实现 Anthropic Messages；最后实现 OpenAI Responses 的高级状态化与 output item 语义。

## 十、References

[1]: https://developers.openai.com/api/reference/overview/ "OpenAI API Reference: API Overview"
[2]: https://developers.openai.com/api/docs/guides/migrate-to-responses "OpenAI Docs: Migrate to the Responses API"
[3]: https://platform.claude.com/docs/en/api/messages "Anthropic API Reference: Messages"
[4]: https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/overview "Anthropic Docs: Tool use with Claude"
[5]: https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking "Anthropic Docs: Building with extended thinking"
[6]: https://api-docs.deepseek.com/ "DeepSeek API Docs: Your First API Call"
[7]: https://api-docs.deepseek.com/api/create-chat-completion "DeepSeek API Reference: Create Chat Completion"
[8]: https://docs.z.ai/api-reference/llm/chat-completion "Z.AI API Reference: Chat Completion"
[9]: https://docs.z.ai/guides/develop/http/introduction "Z.AI Guides: HTTP API Calls"
[10]: https://platform.kimi.ai/docs/api/overview "Kimi API Docs: API Overview"
[11]: https://platform.kimi.ai/docs/overview "Kimi API Docs: Welcome to Kimi API Docs"
[12]: https://platform.minimax.io/docs/api-reference/api-overview "MiniMax API Docs: API Overview"
[13]: https://platform.minimax.io/docs/api-reference/text-openai-api "MiniMax API Docs: Compatible OpenAI API"
[14]: https://platform.claude.com/docs/en/api/openai-sdk "Anthropic Docs: OpenAI SDK compatibility"
[15]: https://github.com/MoonshotAI/Kimi-K2 "MoonshotAI GitHub: Kimi-K2"
[16]: https://platform.minimax.io/docs/token-plan/claude-code "MiniMax Token Plan: Claude Code"
