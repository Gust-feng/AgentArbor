# 协议交叉验证与统一抽象设计

作者：Manus AI
日期：2026-05-20 GMT+8

## 核心判断

本次调研覆盖 OpenAI、Anthropic、DeepSeek、Z.AI/GLM、Kimi/Moonshot 与 MiniMax。六家厂商可以被归入三类协议族：第一类是 **OpenAI Responses 原生协议**，目前只有 OpenAI 应作为首选使用；第二类是 **Anthropic Messages 原生协议**，目前 Anthropic 原生 API 应作为首选使用，MiniMax 与 Kimi 另提供不同程度的 Anthropic-compatible endpoint；第三类是 **OpenAI Chat Completions 兼容协议**，DeepSeek、Z.AI、Kimi 与 MiniMax 的主流公开 LLM 接入都属于这一类，尽管各自通过扩展字段提供 thinking、reasoning 或 interleaved thinking。

> 统一适配层不应把“OpenAI-compatible”误等同于“OpenAI Responses-compatible”。大多数国内厂商兼容的是 Chat Completions 风格的 `messages`、`choices[]`、`tool_calls` 与 SSE chunk，而不是 Responses API 的 `input`、`output[]`、`previous_response_id` 与 event item 模型。

## 协议族划分

| 协议族 | 原生代表 | 典型端点 | 输入模型 | 输出模型 | 工具调用模型 | 状态管理 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI Responses | OpenAI | `/v1/responses` | `input`、`instructions`、`tools`、`text.format` | `output[]` items，包括 `message`、`function_call`、`reasoning` | `function_call` item 与 `function_call_output` item | `previous_response_id`、Conversations、`store` |
| OpenAI Chat Completions | DeepSeek、Z.AI、Kimi、MiniMax | `/v1/chat/completions` 或等价路径 | `messages[]`、`tools`、`tool_choice` | `choices[].message` 与 `choices[].delta` | assistant `tool_calls[]`，工具结果 `role: tool` | 客户端维护 messages |
| Anthropic Messages | Anthropic | `/v1/messages` | 顶层 `system`、`messages[]`、`tools`、`thinking`、必需 `max_tokens` | `content[]` blocks | `tool_use` block 与用户消息内 `tool_result` block | 客户端维护 messages；prompt cache 是原生能力 |

## 统一抽象建议

统一抽象层应以 **Provider Capability Matrix** 驱动，而不是以“OpenAI-like”做静态假设。推荐将请求抽象为 `UnifiedGenerateRequest`，其核心字段包括 `messages`、`system`、`developer`、`tools`、`tool_choice`、`reasoning`、`structured_output`、`stream`、`state` 与 `provider_options`。随后由 provider adapter 将统一请求映射到目标协议族。

| 抽象字段 | OpenAI Responses 映射 | OpenAI Chat 映射 | Anthropic Messages 映射 | 注意事项 |
| --- | --- | --- | --- | --- |
| `system` / `developer` | `instructions` 或 input message | `messages` 中 system/developer，部分厂商不支持 developer | 顶层 `system`，兼容层会合并系统/开发者消息 | Anthropic 原生只支持单个初始 system |
| `messages` | `input` message list | `messages` | `messages` content blocks | 内容块结构需要转换 |
| `tools` | Responses tools | Chat `tools` | Anthropic `tools` | schema strict 支持差异大 |
| `tool results` | `function_call_output` item | `role: tool` message | `tool_result` block | 这是最大结构差异之一 |
| `reasoning` | `reasoning` / reasoning output item | 各厂商扩展：`reasoning_effort`、`thinking`、`reasoning_details` | `thinking` config 与 `thinking` block | 不可假设字段名一致 |
| `structured_output` | `text.format` | `response_format` 或 JSON mode | 原生工具/结构化策略，OpenAI 兼容层常忽略 | 需降级策略 |
| `state` | `previous_response_id`、Conversations、`store` | 客户端 messages | 客户端 messages，prompt cache 可选 | 统一层需保留历史策略 |

## 关键风险与降级策略

最重要的兼容风险是 **工具调用回合不可丢失 reasoning 或 assistant 原始消息**。MiniMax 明确要求多轮 function call 中必须把完整 assistant message 追加到 history，且 thinking content 或 `reasoning_details` 也必须保留；Anthropic extended thinking 响应中的 thinking block 与 signature 在继续对话时也需要按官方要求处理；OpenAI Responses 则使用 output item 与 previous response state 管理。

结构化输出不能简单按 `response_format` 统一。OpenAI Responses 使用 `text.format`；DeepSeek 支持 `response_format.type=json_object` 并要求 prompt 中明确要求 JSON；Anthropic OpenAI SDK 兼容层会忽略 `response_format`；MiniMax OpenAI-compatible 文档未强调 JSON schema strict，而说明部分 OpenAI 参数会被忽略。统一层应提供三档降级：优先 strict JSON schema，其次 JSON mode，最后 prompt-only JSON 并在客户端校验。

streaming 解析必须采用“事件容错 + 字段容错”策略。OpenAI 官方说明 streaming event 类型未来可能增加；Anthropic SSE 有命名事件与 content block lifecycle；Chat-compatible 厂商大多是 data-only SSE chunk，以 `[DONE]` 结束。统一层应把流式输出标准化为 `text_delta`、`reasoning_delta`、`tool_call_delta`、`usage_delta`、`message_stop` 与 `error` 六类内部事件，同时保留原始 provider event。

## 推荐实现顺序

首先实现 OpenAI Responses、Anthropic Messages 与 OpenAI Chat 三个协议族基类；然后为 DeepSeek、Z.AI、Kimi、MiniMax 实现 Chat-family 子适配器，覆盖各自的 base URL、模型枚举、reasoning 扩展、限制与响应字段。最后加入 conformance fixtures，验证普通文本、reasoning、工具两轮、streaming、结构化输出和错误处理六类场景。
