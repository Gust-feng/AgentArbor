---
name: agentarbor-boundary-review
description: "审查 AgentArbor 代码或文档变更是否偏离默认普通 agent 主线、Agent 命名口径、模块边界和 Skills/MCP 能力底座边界。用于检查 CURRENT_RUNTIME_MODE.md、docs 开发指南、AGENTS.md、MCP/Skills 能力文档或相关实现改动。"
metadata:
  agentarbor_sample: "true"
  capability: "architecture-boundary-review"
allowed-tools:
  - shell_command
---

# AgentArbor Boundary Review

## Workflow

1. 先读当前事实源：`CURRENT_RUNTIME_MODE.md`、`docs/开发指南/README.md`、`docs/开发指南/00-总览.md`、`docs/开发指南/01-基础/05-Agent口径与命名.md`。
2. 判断变更归属：产品事实、开发指南、adapter 兼容层、普通 agent 主干实现、样例 skill，或历史/研究资料。
3. 检查默认普通 agent 是否仍是线性会话、模型工具循环、命令确认和结果投影；不要把普通文件编辑、helper 或一次工具循环包装成 deep、Plan、Handoff 或 Governance。
4. 检查平台适配层是否保持平台适配身份：`.agents/skills` 是官方 Agent Skills 兼容层，不是 AgentArbor 产品语义事实源。
5. 对文档变更给出可执行验收：应说明读哪些事实源、改哪些文件、不做哪些能力、如何验证索引与样例。

## Review Rules

- 先指出会破坏当前默认运行方式的风险，再讨论措辞或结构优化。
- 遇到“为了鲁棒性隐藏模型正文、工具结果或错误信息”的设计，要求说明必要性；当前阶段不得用安全投影吞掉普通 agent 可继续使用的内容。
- 遇到 `atomic`、`Plan`、`Handoff`、`Underground`、`Governance` 等词，核对是否有真实职责、输入输出、失败方式和验证边界。
- Skills 只能提供可复用能力指导、脚本、参考资料或资产；不能承接任务编排、RAG、deep 自动触发或治理回流承诺。

## Optional Reference

当变更同时触及多个文档或能力边界时，再读取 `references/boundary-checklist.md`，按清单整理审查结论。
