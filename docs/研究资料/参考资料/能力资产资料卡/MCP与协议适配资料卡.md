# MCP 与协议适配资料卡

## 1. 目标

MCP、Agent Skills、OpenAI function calling、structured output、CLI tool 等都不应直接污染 AgentArbor 核心模型。

AgentArbor 内部应统一使用：

```text
Capability
ToolCall
PermissionPolicy
AssetSnapshot
```

外部协议通过 `ProtocolAdapter` 转换成内部对象。

## 2. 第一版优先资产

### protocol.mcp.client

```text
类别：ProtocolAdapter
来源：Model Context Protocol
接口：MCP JSON-RPC / transport
优先级：P0
风险：High
来源链接：https://modelcontextprotocol.io/specification/2025-06-18/server/tools
当前动作：实现 MCP server manifest 审计
```

AgentArbor 抽象建议：

* MCP Server 暴露的工具不能直接交给 Agent 使用。
* 必须先转成 AgentArbor Capability。
* 必须记录来源、工具 schema、权限、网络、密钥和风险等级。
* 远程 MCP 默认不可信。

待核验：

* 当前 MCP lifecycle、tools、resources、prompts 的稳定版本。
* transport 支持范围。
* 错误模型和认证方式。
* tool schema 与 AgentArbor ToolSpec 的映射缺口。

### mcp.asset_normalizer

```text
类别：MCP
来源：AgentArbor
接口：internal adapter
优先级：P0
风险：Medium
来源链接：https://modelcontextprotocol.io/specification/2025-06-18/server/tools
当前动作：实现 CapabilityNormalizer
```

AgentArbor 抽象建议：

* 负责把 MCP server 的 tool/resource/prompt 清单转成内部资产草案。
* 生成的资产必须是 `draft`，不能自动变成 `trusted`。
* 高风险能力必须进入人工确认或拒绝链路。

### protocol.agent_skills

```text
类别：ProtocolAdapter
来源：Agent Skills
接口：SKILL.md
优先级：P0
风险：High
来源链接：https://agentskills.io/specification
当前动作：实现 SkillScanner + SkillPolicy
```

AgentArbor 抽象建议：

* Skill 是方法包，不是工具本身。
* Skill 可以引用工具、脚本、提示词和评测样例。
* 外部 Skill 默认不可信，需要扫描、权限声明和测试样例。

待核验：

* SKILL.md 的稳定字段。
* 脚本和外部资源的声明方式。
* 与 AgentArbor SkillSpec 的字段差异。

### protocol.cli_tool

```text
类别：ProtocolAdapter
来源：Shell/CLI
接口：command invocation
优先级：P0
风险：High
当前动作：实现 CommandPolicy
```

AgentArbor 抽象建议：

* CLI 是高风险协议。
* 所有 CLI 调用必须在沙箱内执行。
* 必须具备 timeout、stdout/stderr 限制、环境变量过滤、路径限制和审计日志。

## 3. 协议适配底线

* 外部协议不得绕过 PermissionPolicy。
* 外部工具不得直接读取宿主机路径。
* 外部 MCP/Skill 不得自动获得网络和密钥。
* 每次资产导入都必须生成 AssetSnapshot。
