# 后端/运行时规范索引

AgentArbor 已进入第一阶段确定性最小运行内核实现。当前 `src/` 中的真实代码是内存版 runtime kernel，不是 HTTP 后端、数据库服务或外部 adapter。

本目录现在只记录已出生的运行时约定；仍不得编造 routes、controllers、ORM、日志管线或服务框架。

| 指南 | 用途 | 当前状态 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | 运行时内核代码目录和模块组织。 | 生效：最小 runtime kernel |
| [地下辐射生长](./underground-radial-growth.md) | Underground Center 最小 radial growth、候选池、收束、用户澄清升级、澄清恢复和 handoff 输入守卫。 | 生效：V0.5+ clarification recovery |
| [方向交接包契约](./direction-handoff-package.md) | `.agentarbor` Direction Handoff Package 的内存/文件系统读写、校验、版本谱系和边界。 | 生效：V0.2+ handoff lineage |
| [运行观察读模型](./observation-read-model.md) | EventLog 派生的 JSON-safe Observation Kernel 读模型和恢复路径事件 refs。 | 生效：V0.4+ recovery observation |
| [Soil Store 只读接口](./soil-store.md) | 地下独立闭环读取 Soil 约束、能力资产引用、Path Bias 引用和历史运行引用。 | 生效：地下单环最小只读 store |
| [数据库规范](./database-guidelines.md) | 数据访问、schema、迁移和事务约定。 | 延后：本阶段无数据库 |
| [错误处理](./error-handling.md) | 运行时错误类型和守卫失败语义。 | 生效：最小 runtime kernel |
| [日志规范](./logging-guidelines.md) | 日志等级、隐私、追踪和观测模式。 | 延后：本阶段无日志系统 |
| [质量规范](./quality-guidelines.md) | 构建、测试和 demo 验证要求。 | 生效：pnpm + tsc + node:test |

## Pre-Development Checklist

- 读 `AGENTS.md` 和 `docs/开发指南/06-工程实现/` 中与任务相关的边界。
- 若改动 `src/` 运行时内核，读 [目录结构](./directory-structure.md)、[错误处理](./error-handling.md) 和 [质量规范](./quality-guidelines.md)。
- 若改动 Underground Center、rootlet、候选池、收束或 handoff 输入候选，读 [地下辐射生长](./underground-radial-growth.md)。
- 若改动 Direction Handoff Package、`.agentarbor` 读写边界或 Aboveground planning 输入，读 [方向交接包契约](./direction-handoff-package.md)。
- 若改动 `src/domain/soil/**`、Soil refs、Capability Asset refs、Path Bias refs 或历史运行 refs，读 [Soil Store 只读接口](./soil-store.md)。
- 若改动 EventLog 观察、未来前端读模型或 runtime result 投影，读 [运行观察读模型](./observation-read-model.md)。
- 若改动数据库、HTTP API、日志或外部 adapter，不要套用当前最小内核规则；先创建对应任务并补齐新的可执行规范。

## Quality Check

- 运行 `pnpm build`。
- 运行 `pnpm test`。
- 若改动 demo 链路，运行 `pnpm demo` 并确认 EventLog 顺序可读。
- 确认未写入真实 `.agentarbor/` 运行资产，未引入真实 LLM、数据库、UI 或外部 adapter。
