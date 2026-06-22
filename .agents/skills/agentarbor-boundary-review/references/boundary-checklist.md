# AgentArbor Boundary Checklist

## Required Facts

- `CURRENT_RUNTIME_MODE.md` 仍说明默认入口是普通 `agent`。
- `/api/conversations` 和 `/api/desktop/runs` 的默认语义没有被文档改成 deep。
- 普通 agent 完成语义仍是模型不再请求工具后形成最终回答。
- 工具、MCP 和 Skills 仍由后端能力快照、可见性和执行边界裁剪。
- `.agents/skills` 仍是官方 Agent Skills 兼容层，不是产品语义事实源。

## Red Flags

- 用关键词、文件数量或任务复杂度自动升级到 deep。
- 把普通 answer、context pack、skill body 或临时摘要命名为 Plan。
- 把 skill 写成任务工作流、长期记忆、RAG 索引或 Governance 回流。
- 把 raw prompt、完整 skill body、raw tool output、stdout/stderr 或 secret 写入 RuntimeDatabase。
- 用“安全摘要”覆盖模型正式回答、工具结果或错误信息。

## Review Output

输出时优先列风险和文件位置。每条风险说明：

- 违反了哪个当前事实源。
- 会影响默认普通 agent、平台适配层、文档索引还是样例包。
- 建议的最小修正。
