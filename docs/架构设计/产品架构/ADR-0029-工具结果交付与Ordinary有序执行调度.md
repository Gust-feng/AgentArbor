# ADR-0029：工具结果交付与 Ordinary 有序执行调度

## 状态

已接受。

## 决策

AgentArbor 不设置单轮工具数量上限、同批工具结果总预算或按关键词隐藏工具。默认上下文按 256K 能力使用；每个工具结果的完整模型可见包络独立使用固定 6,000-token 硬上限，`read_tool_output` 每页使用同一边界。

正常 builtin 工具拥有自己的输出策略：文件、目录和搜索由 producer 分页；命令保留有界 stdout/stderr 与完整日志引用；HTTP GET 和 browser snapshot 从一次已保存快照继续；MCP、Sub-Agent 和其他无通用分页契约的超大结果由 Host-owned ToolOutputStore 保留完整 evidence。Sub-Agent 仍把完整结果作为父 Ordinary 工具事实交回，不自动摘要；ToolCenter 只负责统一最终交付守卫，不能替工具选择摘要语义。

Ordinary 为每个 run 创建有序工具 gateway。连续只读调用可以并行，非只读调用全局 FIFO 独占，写后的读取不得穿越写屏障。调度只排队，不丢弃或拒绝模型已经选择的工具；排队取消形成真实 cancelled 结果。Deep 继续拥有自己的工具循环和批调度。

工具统计是观察投影，不是工具事实：模型请求边界记录 definition token/hash，ToolCenter 记录 raw/final 包络和 retained/continuation，Ordinary 调度器记录 queue wait/active count。只持久化 bounded histogram、计数、状态和匿名 hash，任何统计失败都不能改变执行结果。

## 结果

- 模型工具选择能力不因上下文治理被工程规则压缩。
- 单个异常工具结果仍不能独占整个上下文。
- 写工具竞态由执行顺序解决，而不是通过禁止模型并行思考解决。
- 完整 evidence、模型下一步输入和统计投影保持单向派生，不形成第二套运行事实。
