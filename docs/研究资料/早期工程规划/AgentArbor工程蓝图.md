# AgentArbor 工程蓝图

## 1. 工程定位

AgentArbor 的工程目标不是做一个普通 Agent，也不是做一个通用低代码平台，更不是为了比赛临时拼出的演示系统。

它要做的是：

```text
自然语言目标
  -> 目标核
  -> arbor.json
  -> 阶段计划
  -> Workflow IR / 动态任务图
  -> Agent 组织和能力声明
  -> AgentApp 工程
  -> 验证结果
  -> 日志、谱系和演化入口
```

因此，AgentArbor 不只是生成系统，而是 AgentApp 的孕育系统。它的质量不只取决于 AI 输出好不好，还取决于目标是否被守住、验证是否真实、历史是否可追溯、失败后是否知道修复或悬停。

## 2. 三层结构

### 2.1 AgentArbor 主系统

主系统负责“孕育过程”。

核心模块：

```text
GoalKernel
RequirementAnalyzer
PlanArchitect
AgentArchitect
CapabilityPlanner
WorkflowIrBuilder
ProjectGenerator
RuntimeValidator
LineageRecorder
ProjectExporter
```

这些模块组成从目标到 AgentApp 的生命闭环。

### 2.2 模板与契约层

模板与契约层负责“生成物最低限度应该长什么样”。

当前已有的 `templates/agent-project/` 只是一份初始参考模板。它可以提供单 Agent 资产拆分的启发，但不能作为 AgentArbor 的最终标准。

AgentArbor 自己必须逐步稳定应用级契约：

```text
arbor.json
docs/goal.md
docs/phase-plan.md
workflow-ir.json
agents/
capabilities/
samples/
validation-result.json
logs/
docs/lineage.md
README.md
```

### 2.3 生成的 AgentApp

生成的 AgentApp 负责“被用户拿走后能运行、能理解、能验证、能继续演化”。

建议第一版目标结构：

```text
generated/<agentapp-id>/
  arbor.json
  manifest.yaml
  workflow-ir.json
  docs/
    goal.md
    phase-plan.md
    acceptance.md
    lineage.md
  agents/
    planner/
    worker/
    verifier/
  capabilities/
    manifest.yaml
  samples/
    sample_task.yaml
  artifacts/
  outputs/
  logs/
  validation-result.json
  README.md
```

## 3. 主流程

```text
用户输入自然语言目标
  ↓
GoalKernel 生成目标核和约束
  ↓
生成 arbor.json
  ↓
PlanArchitect 生成阶段计划
  ↓
WorkflowIrBuilder 生成动态任务图
  ↓
AgentArchitect 生成 Agent 组织
  ↓
CapabilityPlanner 生成能力和权限声明
  ↓
ProjectGenerator 生成 AgentApp
  ↓
RuntimeValidator 运行 sample task / 测试
  ↓
LineageRecorder 写入日志和谱系
  ↓
ProjectExporter 导出 AgentApp
```

## 4. AI 与确定性边界

AgentArbor 不能让 LLM 自由生成整个项目。

正确边界：

| 类型 | 由 AI 负责 | 由系统负责 |
|---|---|---|
| 目标 | 提取目标、约束、验收标准 | 固化目标核、记录变更 |
| 计划 | 生成阶段计划候选 | 校验依赖、限制范围 |
| Agent 组织 | 规划角色和职责 | 限制数量、校验职责边界 |
| 能力 | 建议能力和工具 | 权限裁剪、危险能力阻断 |
| Workflow IR | 生成任务图 | 校验依赖、状态和失败策略 |
| Prompt | 生成角色提示词和输出要求 | 注入固定安全边界 |
| 工程 | 生成配置、说明和少量模板变量 | 渲染目录、写文件、运行验证 |
| 验证 | 生成验收建议 | 运行测试、检查输出、写入结果 |

第一版应坚持：

```text
AI 帮助形成目标、计划、Agent 组织和规格。
系统负责校验、渲染、验证、记录和导出。
```

不要走：

```text
AI 直接生成一整个代码仓。
```

## 5. 建议仓库结构

当前仍处于规划期，建议后续演进为：

```text
AgentArbor/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  AGENTS.md
  docs/
    README.md
    00-总览/
    01-工程规划/
    02-研究资料/
    04-参考沉淀/
    05-架构决策/
    90-外部资料/
  templates/
    agent-project/
    agent-app/
  packages/
    core/
    cli/
    runner/
    infrastructure/
    templates/
    provider-adapters/
    sandbox-adapters/
    workbench/
  tests/
  generated/
```

## 6. 技术栈边界

AgentArbor 明确使用 TypeScript 开发。

第一版建议采用：

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

其中：

* `packages/core/` 保存核心对象模型、规格校验、Workflow IR、生成决策和验证结果模型。
* `packages/cli/` 提供本地命令入口。
* `packages/runner/` 提供 AgentApp 的受控执行器。
* `packages/infrastructure/` 提供文件系统、日志、压缩、进程和配置读写。
* `packages/provider-adapters/` 提供模型供应商适配器。
* `packages/sandbox-adapters/` 提供 Docker、CubeSandbox、E2B 等沙箱适配器。
* `packages/templates/` 管理 AgentApp 模板渲染。
* `packages/workbench/` 是后续观察和操作界面，不进入第一版核心闭环。

AgentArbor 用 TypeScript 开发，不代表生成的 AgentApp 必须是 Node 应用。第一版 AgentApp 仍应优先保持声明式工程形态，由 Runner 读取 `arbor.json`、`workflow-ir.json`、Agent 声明、能力声明、样例任务和验证规则后执行。

## 7. 模块职责

### GoalKernel

负责维护目标、约束、验收标准、暂停点和当前状态。

它是 AgentArbor 的根，不直接写代码。

### PlanArchitect

负责把目标转成阶段计划。

计划是当前假设，不是真理；后续验证失败时可以被修正。

### WorkflowIrBuilder

负责把阶段计划转成可执行、可验证、可修改的任务图。

第一版可以顺序执行，但结构上要保留节点、依赖、状态和验收条件。

### AgentArchitect

负责生成 Agent 组织。

每个 Agent 必须有职责、输入、输出、能力边界和不可做事项。

### CapabilityPlanner

负责生成能力和权限声明。

原则是最小权限，不允许所有 Agent 默认拥有所有工具。

### ProjectGenerator

根据 AgentArbor 自己的规格生成 AgentApp 工程。

它可以参考低层模板，但不得被外部模板限制。

### RuntimeValidator

运行 sample task、测试或结构检查，输出 `ValidationResult`。

生成不等于完成，验证决定是否保留。

### LineageRecorder

记录生成来源、验证结果、重要决策和后续演化入口。

Git commit 可以作为后续增强，但第一版至少要有日志和 lineage 文档。

### ProjectExporter

打包 AgentApp、运行日志和验证结果。

## 8. 第一版架构收敛

第一版只需要把这些对象做稳定：

```text
ArborSpec
GoalSpec
RequirementSpec
AgentManifest
CapabilitySpec
PermissionPolicy
WorkflowIR
GeneratedAgentApp
ValidationResult
LineageRecord
```

暂不做复杂生产治理，但命名和结构要给未来扩展留位置。

## 9. 开发判断

AgentArbor 的全局最优不是一开始做大平台，也不是为了外部展示压成短期演示，而是先做一个真实可运行、可验证、可追溯的生命闭环。

第一阶段衡量标准：

```text
能不能从一个目标生成一个 AgentApp。
AgentApp 是否有目标、计划、Agent 组织、能力声明和验证结果。
输出结果能不能被用户复现，并能被后续迭代继续读取。
```
