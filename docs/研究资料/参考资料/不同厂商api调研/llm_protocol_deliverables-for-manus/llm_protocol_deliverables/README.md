# LLM API 协议调研交付物

作者：**Manus AI**
日期：2026-05-20 GMT+8

本目录包含针对 OpenAI、Anthropic、DeepSeek、Z.AI/GLM、Kimi/Moonshot 与 MiniMax 的 API 协议差异调研交付物。建议先阅读主报告，再查看 JSON 能力矩阵和 TypeScript 类型草案，最后用 fixtures 辅助 Codex 或工程实现者编写适配器测试。

| 文件 | 用途 |
| --- | --- |
| `llm_api_protocol_report.md` | 主调研报告，包含协议族划分、关键差异、厂商细节、统一适配建议与参考链接。 |
| `provider_capability_matrix.json` | 机器可读能力矩阵，记录每个厂商的推荐协议族、base URL、能力、限制与 caveats。 |
| `unified_llm_protocol_types.ts` | TypeScript 类型草案，用于实现统一请求/响应、stream event、adapter interface。 |
| `fixtures/tool_call_fixtures.json` | 工具调用、reasoning、streaming 与结构化输出降级的测试 fixtures。 |
| `protocol_synthesis.md` | 交叉验证阶段的统一抽象设计笔记，可作为实现依据补充阅读。 |

## 推荐实现路线

建议将工程实现拆分为三个协议族基类：`OpenAIResponsesAdapter`、`OpenAIChatAdapter` 与 `AnthropicMessagesAdapter`。DeepSeek、Z.AI、Kimi 与 MiniMax 的 OpenAI-compatible 接入应继承 `OpenAIChatAdapter`，再按能力矩阵覆盖 reasoning、streaming、结构化输出和字段过滤策略。
