# Generated AgentApp Contract

AgentArbor 生成的 AgentApp 必须满足以下契约。

## 1. 可运行

AgentApp 应提供明确运行方式。

例如：

```bash
pnpm install
pnpm dev
pnpm test
```

## 2. 可审查

必须能看到：

- 需求文档；
- 架构文档；
- Agent 角色；
- 能力配置；
- 测试策略；
- Git 提交历史；
- 变更原因。

## 3. 可验证

必须有测试或评测样例。

没有验证的 AgentApp 只能算原型，不算被成功孕育。

## 4. 可继续迭代

AgentApp 必须能被 AgentArbor 重新读入。

重新读入时，AgentArbor 应能理解：

- 当前目标；
- 当前版本；
- 当前 Agent 组织；
- 当前能力；
- 当前测试状态；
- 当前演化历史。

## 5. 可分化

AgentApp 必须具备 lineage 信息，允许从当前版本开出新分支。

## 6. 可重生

AgentApp 必须保留足够文档、测试和失败记录，以便旧架构失效时生成新一代。

## 7. 核心契约

一个合格的 AgentApp 不仅是“能跑”，还必须能被理解、被验证、被维护、被分化。
