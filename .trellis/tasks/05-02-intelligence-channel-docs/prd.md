# 补齐智能通道与模型接入边界文档

## Goal

在正式接入真实模型前，先把 AgentArbor 的 AI 能力入口写成稳定架构事实：所有模型调用必须通过“智能通道”，具体模型供应商只能通过 adapter 接入，AI 输出只能作为候选、草案、解释或证据建议进入后续确定性收束与校验流程。

## Requirements

- 新增产品架构 ADR，定义智能通道的定位、职责、边界和后果。
- 更新系统架构、模块划分、人工智能与确定性边界、术语表和总览，使开发入口能直接指导后续模型接入。
- 新增模型契约文档，明确 `ModelRequest`、`ModelResponse`、`ModelUsage`、`ModelProvider`、`IntelligenceChannel`、`ModelCallRef` 和模型调用事件。
- 新增后端可执行规范，约束未来 TypeScript 实现的目录边界、导入边界、事件观测、密钥处理和测试要求。
- 更新任务看板，使当前任务从地下最小闭环切换到智能通道文档与模型接入边界。

## Acceptance Criteria

- [x] `docs/架构设计/产品架构/README.md` 索引新增智能通道 ADR。
- [x] `docs/开发指南/03-系统架构/` 和 `docs/开发指南/06-工程实现/` 明确智能通道是横切能力，不是概念树节点。
- [x] `docs/开发指南/04-模型与契约/` 新增智能通道契约并更新索引。
- [x] `.trellis/spec/backend/` 新增智能通道规范并更新索引。
- [x] 文档不引入“直接调用 provider SDK”的实现路径。
- [x] 文档不把 AI 输出写成事实源、Soil、Direction Handoff 或 Growth Plan 的直接替代物。
- [x] `git diff --check` 通过。

## Out of Scope

- 不实现 TypeScript 运行时代码。
- 不接 OpenAI、Anthropic、Gemini、Qwen、Ollama 或其他真实 provider。
- 不引入 UI、HTTP、SSE、WebSocket、数据库、MCP、A2A 或 AG-UI adapter。
- 不创建 repo-root `.agentarbor/` 运行资产。
- 不提交 git commit。

## Technical Notes

- 智能通道是横切能力，服务 Underground Center、Aboveground Center、Verification、Governance 等环节，但不成为概念树节点。
- Provider adapter 只能承担格式转换、鉴权和供应商差异隔离；不能定义 AgentArbor 核心语义。
- EventLog 只能记录清洗后的模型调用事件、用量、引用和结果状态，不记录密钥、完整 prompt 隐私内容或未授权上下文。
