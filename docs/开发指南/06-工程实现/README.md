# 工程实现

本章定义代码实现阶段的工程约束。当前仓库已进入第一阶段确定性最小运行内核实现：只证明内存版闭环、事件、状态、产物、验证和治理回流，不因此提前引入真实 LLM、数据库、UI 或外部 adapter。

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
