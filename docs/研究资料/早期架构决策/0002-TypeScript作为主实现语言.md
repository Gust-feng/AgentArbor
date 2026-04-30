# ADR 0002：TypeScript 作为主实现语言

## 状态

Accepted

## 背景

AgentArbor 需要同时覆盖以下能力：

* 核心对象模型和规格校验。
* CLI 入口。
* AgentApp 模板渲染。
* 模型供应商适配。
* 沙箱和 Runner 适配。
* Workbench UI。
* 测试、评测、日志和导出。

这些能力横跨前端、后端、命令行和运行时适配。项目需要一个能统一类型、Schema、配置和 UI 交互的主语言。

## 决策

AgentArbor 主实现语言采用 TypeScript。

第一版建议技术组合：

```text
TypeScript
Node.js LTS
pnpm workspace
Vitest
Zod / JSON Schema
YAML / JSON
React + TypeScript
Linux Container Runner
```

建议工程形态：

```text
packages/
  core/
  cli/
  runner/
  infrastructure/
  templates/
  provider-adapters/
  sandbox-adapters/
  workbench/
```

## 关键边界

AgentArbor 使用 TypeScript 开发，不意味着生成的 AgentApp 必须是 Node.js 应用。

第一版 AgentApp 应优先保持声明式工程形态：

```text
arbor.json
manifest.yaml
workflow-ir.json
agents/
capabilities/
runtime.yaml
providers.example.yaml
samples/
tests/
evals/
logs/
validation-result.json
docs/
```

AgentApp 由 AgentArbor Runner 读取声明、执行样例任务、调用模型 Provider、检查权限和写入验证结果。

## 理由

TypeScript 的优势是：

* 可以让 Workbench、CLI、核心模型和 Runner 共享类型。
* 适合表达 `arbor.json`、Workflow IR、Agent Manifest、Provider Config、ValidationResult 等结构化契约。
* 生态中已有成熟的 JSON Schema、YAML、CLI、测试、打包和前端工具。
* 调用模型供应商主要是 HTTP 协议，不要求绑定 Python 或 .NET SDK。
* 适合通过 Adapter 连接 Docker、CubeSandbox、E2B、OpenAI-compatible Provider 等外部系统。

## 影响

后续规划、代码和模板应优先围绕 TypeScript 单仓组织。

可以引入其他语言作为生成物、工具插件或沙箱内执行载体，但不能反向改变 AgentArbor 主系统的实现语言。

若某个 AgentApp 未来需要生成 Python、Node、Go、.NET 或 Shell 代码，应通过 `runtime.yaml` 和 Runner Profile 显式声明，而不是让 AgentArbor 核心隐式依赖这些运行时。
