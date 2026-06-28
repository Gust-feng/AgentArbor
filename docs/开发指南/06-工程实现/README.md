# 工程实现

本章定义代码实现阶段的工程约束。当前仓库已进入 Desktop Basic Agent Runtime + Local Runtime Lite Profile 实现：Desktop Shell、AgentTurnRuntime、ToolCenter、本地策略沙盒、Confirmation Gate、RunEvent 投影、Skills 最小闭环和轻量 RuntimeDatabase 共同支撑当前桌面 Agent 工作流。当前阶段优先保证默认普通 `agent` 的运行能力；普通回答、工具结果和错误信息不得被“脱敏”“安全投影”或摘要化链路吞掉。显式“多 Agent”已按 ADR-0025 暴露为独立模块，后端正式入口是 `/api/deep/*`，内部实现可继续使用 `deep` / `DeepRuntime`；它不能自动升级普通请求，也不能混入默认普通路径。完整数据库后端、迁移体系、治理回流、Routines、完整 Agent Team、多层递归和 Full Profile 能力仍按 ADR-0022 / ADR-0023 / ADR-0024 / ADR-0025 的共享契约显式推进。deep / Agent 集群能力保留为长期方向，但普通路径命名和实现必须保持朴素准确。

## 文档列表

- [技术主线](01-技术主线.md)
- [模块划分](02-模块划分.md)
- [人工智能与确定性边界](03-人工智能与确定性边界.md)
- [测试与验收](04-测试与验收.md)
- [文档治理](05-文档治理.md)
- [最小实现边界](06-最小实现边界.md)
- [阶段验收边界](07-阶段验收边界.md)
- [默认 Agent 后续开发流程](08-默认Agent后续开发流程.md)
- [普通 Agent 主干开发指南](09-普通Agent主干开发指南/README.md)
- [多 Agent 最小协作闭环开发书](10-多Agent最小协作闭环开发书.md)

## 当前最小运行命令

第一阶段根目录工具链使用 `pnpm + TypeScript + tsc + node:test`：

- `pnpm build`：编译 TypeScript。
- `pnpm test`：编译并运行 `node:test` 覆盖最小闭环边界。
- `pnpm demo`：编译并打印完整最小 EventLog 与 Fruit / RunMemory / ExperienceCandidate / PathBias 摘要。
