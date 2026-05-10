# 工程实现

本章定义代码实现阶段的工程约束。当前仓库已进入 Local Runtime Lite Profile 实现：Desktop Shell、AgentTurnRuntime、ToolCenter、本地策略沙盒、Observation 安全投影和轻量 RuntimeDatabase 共同支撑当前桌面 Agent 工作流。运行记录可以进入 appHome / runHome 下的 RuntimeDatabase 安全投影；完整数据库后端、迁移体系、治理回流和 Full Profile 能力仍按 ADR-0022 / ADR-0023 的共享契约演进。

## 文档列表

- [技术主线](01-技术主线.md)
- [模块划分](02-模块划分.md)
- [人工智能与确定性边界](03-人工智能与确定性边界.md)
- [测试与验收](04-测试与验收.md)
- [文档治理](05-文档治理.md)
- [最小实现边界](06-最小实现边界.md)
- [阶段验收边界](07-阶段验收边界.md)

## 当前最小运行命令

第一阶段根目录工具链使用 `pnpm + TypeScript + tsc + node:test`：

- `pnpm build`：编译 TypeScript。
- `pnpm test`：编译并运行 `node:test` 覆盖最小闭环边界。
- `pnpm demo`：编译并打印完整最小 EventLog 与 Fruit / RunMemory / ExperienceCandidate / PathBias 摘要。
