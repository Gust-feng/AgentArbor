# 多厂商 LLM 协议调研首轮交付

## 执行摘要

截至本轮已打开并核验的官方资料，**只有 OpenAI 明确公开了原生的 Responses API，并且官方明确写明其是“新项目推荐接口”**；**Anthropic 公开的是 OpenAI SDK compatibility，但官方同时强调这主要用于测试与能力比较，不是多数场景下的长期生产方案**；**DeepSeek 目前官方明确支持 OpenAI Chat Completions 兼容与 Anthropic API 兼容**；**Z.AI 官方公开的是 OpenAI-compatible Chat Completions 路径，并额外提供面向编码工具的 Anthropic Messages 协议端点**；**Kimi 官方公开的是 OpenAI Chat Completions 兼容接口，并列出与 OpenAI 的差异项**；**MiniMax 官方同时公开 Anthropic-compatible 与 OpenAI-compatible 两套接口，且在多处文档中把 Anthropic-compatible 标成 Recommended**。基于这些文档，当前最稳妥的工程结论是：你的上层可以设计成 **OpenAI Responses-like 内部协议**，但下游 wire protocol 至少要区分为 **OpenAI Responses / OpenAI Chat Completions / Anthropic Messages / Vendor-compatible-with-extensions** 四层，而不能把“OpenAI-compatible”直接等同于“兼容 OpenAI Responses”。 citeturn7view1turn7view0turn11view1turn12view3turn14view0turn15view0turn25view2turn18view1turn18view4turn20view4turn24view4

本轮交付只覆盖你要求的**首轮产物**：一是按厂商分组的官方文档清单；二是可继续细化成 `ProviderProtocolProfile` 的初步表格草案。后续完整交付（字段级请求/响应差异、tool loop、reasoning、streaming、usage/error、JSON/TS/fixtures）将以这些官方页面为主索引继续展开。 citeturn7view1turn11view1turn14view0turn18view4turn20view4

## 研究方法与说明

本轮**只使用官方或准官方资料**：API reference、开发者文档、官方 SDK/兼容文档、官方 guide、官方 release note / migration guide；**未使用非官方资料**。文档“发布日期 / 最后更新时间”只在页面正文或搜索摘要中**明确可见**时填写；若页面未展示，则记为“页面未标注公开更新时间”。本轮所有文档的统一访问时间记为 **2026-05-21 00:07 JST**。 citeturn22time0

需要特别说明的是，“本轮未见官方公开支持 OpenAI Responses API”并不等于逻辑上不可能支持，而是指：**在本轮已抓取并核验的官方公开文档中，尚未找到该声明或示例**。因此，首轮表格中的“未见官方公开支持”是**证据状态**，不是超出证据范围的推断。 citeturn11view1turn12view3turn15view0turn18view4turn24view4

## 已收集到的官方文档清单

下表列的是**本轮已经打开并核验**、且后续最可能进入最终工程对照文档的核心资料。访问时间统一为 **2026-05-21 00:07 JST**。 citeturn22time0

**OpenAI**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://developers.openai.com/api/reference/responses/overview` | Responses Overview | 页面未标注公开更新时间 | 确认 Responses 是 OpenAI 当前最先进的生成接口，支持 stateful interactions、built-in tools、function calling | citeturn7view0 |
| `https://developers.openai.com/api/docs/guides/migrate-to-responses` | Migrate to the Responses API | 页面未标注公开更新时间 | 确认 Responses 是新项目推荐接口；确认 Chat 与 Responses 的核心语义差异是 Messages vs Items | citeturn7view1 |
| `https://developers.openai.com/api/docs/guides/reasoning` | Reasoning models | 页面未标注公开更新时间 | 确认 `reasoning.effort`、reasoning items、`max_output_tokens` 与 reasoning token 行为 | citeturn7view2 |
| `https://developers.openai.com/api/docs/guides/function-calling` | Function calling | 搜索摘要显示 2025-08-07；页面未标注公开更新时间 | 确认 OpenAI function/tool calling 的官方语义与 JSON Schema 工具定义路径 | citeturn3search1turn7view3 |
| `https://developers.openai.com/api/docs/guides/tools` | Using tools | 页面未标注公开更新时间 | 确认 built-in tools、remote MCP、tool search 等 Responses 生态特性 | citeturn7view4 |
| `https://developers.openai.com/api/docs/guides/conversation-state` | Conversation state | 页面未标注公开更新时间 | 确认 Conversations API 与 Responses 的服务端状态管理方式 | citeturn7view6 |

**Anthropic Claude**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://platform.claude.com/docs/en/home` | Start building with Claude | 页面未标注公开更新时间 | 确认 Anthropic 面向开发者的两条主路径是 Messages 与 Managed Agents；Messages 需要你自己维护对话与 tool loop | citeturn10view1 |
| `https://platform.claude.com/docs/en/api/openai-sdk` | OpenAI SDK compatibility | 页面未标注公开更新时间 | 确认 Anthropic 公开的是 OpenAI SDK compatibility；并明确说明该兼容层主要用于测试/比较，不是多数场景下的长期生产方案 | citeturn11view1 |
| `https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview` | Tool use with Claude | 页面未标注公开更新时间 | 确认 Claude 的 tool use 分 client tools 与 server tools，并采用 `tool_use` / `tool_result` 块式协议语义 | citeturn9view2 |
| `https://platform.claude.com/docs/en/build-with-claude/extended-thinking` | Building with extended thinking | 页面未标注公开更新时间 | 确认新版 Claude thinking/adaptive thinking 入口，以及 Opus 4.7 对 `budget_tokens` 的兼容变化 | citeturn9view3 |
| `https://platform.claude.com/docs/en/about-claude/models/migration-guide` | Migration guide | 页面未标注公开更新时间 | 确认 Opus 4.7 迁移注意事项：`thinking: {type:"enabled", budget_tokens}` 不再支持、需改用 `thinking: {type:"adaptive"}` + `output_config.effort`，部分采样参数改为报错 | citeturn9view5 |
| `https://platform.claude.com/docs/en/release-notes/overview` | Claude Platform release notes | 页面含分条更新时间；本轮使用的是当前总览页 | 确认 `effort` 已 GA、`output_config.format` / structured outputs 已迁移到正式路径 | citeturn9view6 |

**DeepSeek**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://api-docs.deepseek.com/quick_start/pricing` | Models & Pricing | 页面未标注公开更新时间 | 确认当前主力模型、OpenAI/Anthropic 两套 base URL、thinking 默认开启、上下文与最大输出量级 | citeturn12view0 |
| `https://api-docs.deepseek.com/api/create-chat-completion` | Create Chat Completion | 页面未标注公开更新时间 | 确认官方主生成接口是 Chat Completions；含 `thinking`、`reasoning_effort`、`response_format`、SSE 说明 | citeturn14view1 |
| `https://api-docs.deepseek.com/guides/thinking_mode` | Thinking Mode | 页面未标注公开更新时间 | 确认 thinking 默认启用、`reasoning_effort` 仅 `high/max`、thinking 下采样参数失效、tool call 场景必须回传 `reasoning_content` | citeturn12view1 |
| `https://api-docs.deepseek.com/guides/anthropic_api` | Anthropic API | 页面未标注公开更新时间 | 确认 DeepSeek 官方支持 Anthropic API format 与 `https://api.deepseek.com/anthropic` | citeturn14view0 |
| `https://api-docs.deepseek.com/guides/multi_round_chat` | Multi-round Conversation | 页面未标注公开更新时间 | 确认 `/chat/completions` 是 stateless API，需要客户端回传完整历史 | citeturn14view2 |
| `https://api-docs.deepseek.com/news/news260424` | DeepSeek V4 Preview Release | 2026-04-24 | 确认官方明确写出 “Supports OpenAI ChatCompletions & Anthropic APIs” | citeturn13search18turn12view3 |

**GLM / Z.AI / 智谱**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://docs.z.ai/guides/develop/openai/python` | OpenAI Python SDK | 页面未标注公开更新时间 | 确认 Z.AI 提供 OpenAI-compatible 接口，可直接替换 API key 与 base URL | citeturn15view0 |
| `https://docs.z.ai/api-reference/llm/chat-completion` | Chat Completion | 页面未标注公开更新时间 | 确认 Z.AI 官方 API reference 的主文本生成接口是 `/api/paas/v4/chat/completions`，返回中可含 `reasoning_content` 与 `tool_calls` | citeturn15view1turn25view1 |
| `https://docs.z.ai/guides/capabilities/thinking-mode` | Thinking Mode | 页面未标注公开更新时间 | 确认 GLM 的默认 thinking 行为、interleaved thinking、preserved thinking 与 `clear_thinking` 机制 | citeturn15view2turn16view1turn16view3 |
| `https://docs.z.ai/guides/capabilities/stream-tool` | Tool Streaming Output | 页面未标注公开更新时间 | 确认 `tool_stream=True`、流式输出 `reasoning_content` / `content` / `tool_calls` 的工程含义 | citeturn15view3 |
| `https://docs.z.ai/devpack/tool/others` | Tool Integration | 页面未标注公开更新时间 | 确认 Coding Plan 同时提供 OpenAI Chat Completions 与 Anthropic Messages 两个端点 | citeturn15view6turn25view2 |
| `https://docs.z.ai/guides/llm/glm-4.7` | GLM-4.7 Overview | 页面未标注公开更新时间 | 确认 GLM-4.7 的 retained reasoning / round-based reasoning / agentic 场景定位 | citeturn15view4 |

**Kimi / Moonshot**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://platform.kimi.ai/docs/api/overview` | API Overview | 页面未标注公开更新时间 | 确认 Kimi 提供 OpenAI-compatible HTTP API，SDK base URL 为 `https://api.moonshot.ai/v1`，兼容点明确定位为 Chat Completions | citeturn18view1 |
| `https://platform.kimi.ai/docs/api/chat` | Create Chat Completion | 页面未标注公开更新时间 | 确认主文本生成接口为 `/v1/chat/completions`，支持 standard chat、Partial Mode、Tool Use | citeturn18view2 |
| `https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model` | Using Thinking Models | 页面未标注公开更新时间 | 确认 `kimi-k2-thinking` 强制 thinking，`kimi-k2.6` 默认 thinking 开启，可关闭；并要求多步工具调用时保留 `reasoning_content` | citeturn18view3 |
| `https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi` | Migrating from OpenAI to Kimi API | 页面未标注公开更新时间 | 确认 Kimi 明确列出兼容接口清单与与 OpenAI 的差异项 | citeturn18view4 |
| `https://platform.kimi.ai/docs/guide/use-official-tools` | How to Use Official Tools in Kimi API | 页面未标注公开更新时间 | 确认 Kimi 官方工具与 Chat Completions 的联动方式，以及 `tool_calls` / `role:"tool"` 回传规范 | citeturn19view0 |
| `https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart` | Kimi K2.6 | 页面未标注公开更新时间 | 确认 K2.6 可通过 `thinking: {"type":"disabled"}` 关闭 thinking，且通过 `extra_body` 传递 | citeturn19view1 |

**MiniMax**

| URL | 文档标题 | 发布/更新时间 | 本轮用途 | 依据 |
|---|---|---|---|---|
| `https://platform.minimax.io/docs/guides/text-generation` | Text Generation | 页面未标注公开更新时间 | 确认 MiniMax 文本模型面向编程、Agent workflow、复杂任务场景；同时接受 Anthropic-style 与 OpenAI-style 请求 | citeturn20view0turn21search18 |
| `https://platform.minimax.io/docs/api-reference/text-anthropic-api` | Compatible Anthropic API | 页面未标注公开更新时间 | 确认 MiniMax 提供 Anthropic-compatible 接口；文档将其放在 Recommended 路径上 | citeturn24view4turn20view4 |
| `https://platform.minimax.io/docs/api-reference/text-openai-api` | Compatible OpenAI API | 页面未标注公开更新时间 | 确认 MiniMax 提供 OpenAI-compatible 接口；多轮 function call 必须保留完整 assistant message / reasoning chain | citeturn24view0turn20view1 |
| `https://platform.minimax.io/docs/guides/text-m2-function-call` | Tool Use & Interleaved Thinking | 页面未标注公开更新时间 | 确认 `reasoning_split=True`、`reasoning_details` 与完整 `response_message` 回传要求 | citeturn20view3 |
| `https://platform.minimax.io/docs/api-reference/text-ai-sdk` | AI SDK | 页面未标注公开更新时间 | 确认 MiniMax 的 AI SDK provider 默认走 Anthropic-compatible API；需要 OpenAI-compatible 时使用 `minimaxOpenAI` | citeturn21search21turn20view6 |
| `https://platform.minimax.io/docs/guides/models-intro` | Models | 页面未标注公开更新时间 | 作为后续模型能力矩阵的官方入口页 | citeturn20view5 |

## 初步 ProviderProtocolProfile 表格草案

下表是**首轮草案**。为避免在证据不足时过度二元化，本轮把若干布尔字段先写成“是 / 否 / 未见官方公开支持 / 仅部分”，下一轮再把它们收敛成 JSON 枚举和布尔值。所有判断都以“本轮已核验官方文档”为准。 citeturn7view1turn11view1turn12view3turn25view2turn18view4turn24view4

| 厂商 | 主要 base URL 与公开 endpoint | 官方推荐接入协议 | OpenAI SDK | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages | 自有原生协议面 | 当前草案结论 | 兼容性 caveats | 依据 |
|---|---|---|---|---|---|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1`；`POST /v1/responses`；`POST /v1/chat/completions` | `openai_responses` | 是 | 是 | **是** | 本轮未见官方公开支持 | **是** | OpenAI 是当前唯一明确公开原生 Responses 的厂商；新项目应优先按 Responses 设计 | Chat 仍受支持，但 OpenAI 明确把 Responses 作为未来方向；Responses 输入/输出语义是 Items，不是简单 messages | citeturn7view1turn7view0turn23search9turn23search18 |
| Anthropic Claude | `https://api.anthropic.com/v1`；原生 `POST /v1/messages`；兼容层通过 OpenAI SDK 指向 Claude API | `anthropic_messages` | 是 | **是（OpenAI SDK compatibility）** | **本轮未见官方公开支持** | **是** | **是** | 生产环境应优先用原生 Claude API / Messages；OpenAI 兼容层只适合作为测试与迁移辅助手段 | `strict` 忽略；`response_format` 忽略；`reasoning_effort` 忽略；system/developer 会被 hoist；多数不支持字段会静默忽略 | citeturn11view1turn11view2turn11view3turn11view4turn10view1 |
| DeepSeek | `https://api.deepseek.com`；OpenAI 格式 `/chat/completions`；Anthropic 格式 `https://api.deepseek.com/anthropic` | `multiple` | 是 | **是** | **本轮未见官方公开支持** | **是** | 以兼容协议为主，带 DeepSeek 扩展字段 | 工程上应视为“OpenAI Chat-compatible + Anthropic-compatible + DeepSeek thinking 扩展”，不是 Responses 兼容 | thinking 默认开启；thinking 下 `temperature/top_p/presence_penalty/frequency_penalty` 无效；tool call 场景必须回传 `reasoning_content`；整体是 stateless API | citeturn12view0turn14view1turn12view1turn14view0turn14view2turn12view3 |
| GLM / Z.AI / 智谱 | 通用 `https://api.z.ai/api/paas/v4/`；`POST /chat/completions`；Coding Plan OpenAI 端点 `https://api.z.ai/api/coding/paas/v4`；Anthropic 端点 `https://api.z.ai/api/anthropic` | `multiple` | 是 | **是** | **本轮未见官方公开支持** | **是（主要在 Coding Plan / coding tools 场景公开）** | **是（官方自有 PaaS v4 API）** | 通用业务可按 OpenAI-compatible Chat 接入；编码工具场景需要区分通用端点与 Coding/Anthropic 端点 | 与 OpenAI 仍有差异；GLM 默认 thinking 行为随模型系列不同；interleaved/preserved thinking 要保留 `reasoning_content`；tool streaming 需显式 `tool_stream=True` | citeturn15view0turn25view1turn16view1turn16view2turn15view3turn25view2 |
| Kimi / Moonshot | `https://api.moonshot.ai`；SDK base `https://api.moonshot.ai/v1`；`POST /v1/chat/completions` | `openai_chat_completions` | 是 | **是** | **本轮未见官方公开支持** | 本轮未见官方公开支持 | 当前公开的文本生成主协议是 OpenAI-compatible Chat；另有 Formula / Files 等平台接口 | 目前应把 Kimi 当作“OpenAI Chat-compatible + Kimi-specific extensions”处理，而不是 Responses 兼容 | `thinking` 通过 `extra_body` 传；`partial` 不是顶层参数；Kimi 明确列出与 OpenAI 的差异；`kimi-k2.6` thinking 默认开启，多步 tool call 应保留 `reasoning_content` | citeturn18view1turn18view2turn18view3turn18view4turn19view0turn19view1 |
| MiniMax | 国际 OpenAI `https://api.minimax.io/v1`；国际 Anthropic `https://api.minimax.io/anthropic`；公开 endpoint 包括 `/v1/chat/completions` 与 `/anthropic/v1/messages` | `anthropic_messages` | 是 | **是** | **本轮未见官方公开支持** | **是** | 以兼容协议为主；文本侧未见单独公开 Responses-like 协议 | 对 Agent/编码场景，MiniMax 官方更推荐 Anthropic-compatible 路线；OpenAI-compatible 路线可用但要额外处理 reasoning/assistant replay | OpenAI 兼容路径下，多轮 function call 必须保留完整 assistant message；原生 OpenAI 兼容输出可能把 thinking 放进 `<think>` 标签；使用 `reasoning_split=True` 可转为 `reasoning_details`；AI SDK 默认也偏向 Anthropic-compatible | citeturn24view4turn20view4turn24view0turn20view1turn20view3turn21search21 |

## 当前已确认的关键差异

当前已经可以确认的**最重要工程事实**是：如果你的统一抽象层要长成 **OpenAI Responses-like**，那么下游协议不应该只做“同构参数映射”，而要先按**协议族**分层。OpenAI 是原生 `Responses + output items + previous_response_id/Conversations`；Anthropic 是 `Messages + content blocks + tool_use/tool_result + thinking`；DeepSeek、Z.AI、Kimi 目前公开的是 `OpenAI Chat Completions-like`，但都带有各自的 thinking/reasoning 扩展；MiniMax 则同时支持 Anthropic-compatible 与 OpenAI-compatible，但官方更推荐前者。 citeturn7view1turn7view6turn10view1turn9view2turn12view1turn25view1turn18view1turn24view4

第二个已经确认的高风险点是：**“支持 OpenAI SDK”几乎都只能推出“可复用 OpenAI SDK 客户端与部分 Chat Completions 调用习惯”，不能推出“支持 OpenAI Responses API 语义”**。Anthropic 的官方文档就明确把兼容层定义为 OpenAI SDK compatibility，并明确说明其重点是测试/比较、不是多数场景的长期生产方案；Kimi 的官方兼容清单也只列出 `/v1/chat/completions`、文件相关接口等；DeepSeek 与 Z.AI 的主参考页也都围绕 Chat Completions 展开；MiniMax 的 OpenAI-compatible 页面同样是 `/v1/chat/completions`。 citeturn11view1turn18view4turn14view1turn25view1turn24view0

第三个已经确认的高风险点是：**reasoning/thinking 不是一个通用布尔开关，而是厂商级协议差异**。OpenAI 用 `reasoning.effort` 与 reasoning items；Anthropic 新模型转向 `thinking: {type:"adaptive"}` 与 `output_config.effort`；DeepSeek 用 `thinking` + `reasoning_effort`，且 tool 场景必须回传 `reasoning_content`；Z.AI 默认 thinking 行为与 preserved thinking 和 `clear_thinking` 绑定；Kimi 把 `reasoning_content` 明确作为多步工具调用的重要上下文；MiniMax 在 OpenAI-compatible 路径下又有 `reasoning_split` / `reasoning_details` 或 `<think>` 标签这套语义。也就是说，Codex 最终实现时一定要把 reasoning 抽成**独立能力层**，不能混在普通参数适配里。 citeturn7view2turn9view3turn9view5turn12view1turn16view1turn18view3turn20view3turn20view1

基于本轮证据，下一步的完整工程化文档已经可以确定一个安全前提：**你的统一层应采用 Responses-like internal model，但必须把底层 provider 分成至少四种 wire protocol：`openai_responses`、`openai_chat_completions`、`anthropic_messages`、`vendor_chat_with_extensions`。** 这不是架构偏好，而是由各厂商官方公开协议的实际差异决定的。 citeturn7view1turn11view1turn14view0turn25view2turn18view1turn24view4