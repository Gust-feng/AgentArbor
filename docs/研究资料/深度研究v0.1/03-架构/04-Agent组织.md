# Agent 组织结构

## 1. 核心原则

AgentArbor 不应该追求“Agent 越多越好”。

多 Agent 的价值在于：

- 角色分离；
- 相互制衡；
- 专业能力聚焦；
- 责任可追踪；
- 防止单一 Agent 自我肯定。

## 2. 推荐三层组织

```text
RootOrchestrator
  ↓
PhaseLeadAgent
  ↓
WorkerAgents
```

不要无限套娃。三层以内像组织，三层以外容易变成 AI 官僚系统。

## 3. RootOrchestrator

负责全局：

- 维护目标；
- 调用自主内核；
- 决定阶段切换；
- 判断是否继续、修复、转向、分化、重生；
- 管理用户确认点；
- 防止局部优化破坏全局目标。

## 4. PhaseLeadAgent

负责某一阶段：

- 读取阶段目标；
- 生成阶段任务图；
- 选择 Worker Agents；
- 协调执行；
- 汇总结果；
- 向 RootOrchestrator 报告。

PhaseLead 是临时负责人，不是永久权力中心。

## 5. Worker Agents

典型 Worker：

- BuilderAgent：写代码、生成文件。
- TestAgent：写测试、跑测试、解释失败。
- ReviewAgent：审查代码和文档一致性。
- RepairAgent：修复局部问题。
- RefactorAgent：重构结构。
- DocumentationAgent：维护文档。
- GitAgent：commit、branch、diff、lineage。
- CapabilityAgent：安装和验证能力。
- SecurityAgent：检查危险操作。

## 6. 必须存在的高价值 Agent 角色

以下角色是 AgentArbor 的基础人格：

1. GoalStewardAgent：守护用户目标，防止跑偏。
2. CriticAgent：专门反对和挑刺。
3. EvolutionAgent：判断维护、转向、分化、重生。
4. GovernanceAgent：检查权限、安全和策略。
5. DebtAgent：维护技术债账本。
6. TestAgent：验证收敛。
7. GitAgent：记录年轮。

## 7. 动态创建专家 Agent

AgentArbor 可以根据目标临时创建专家 Agent：

- ReactUISpecialist；
- MCPServerSpecialist；
- DatabaseMigrationSpecialist；
- SecurityReviewSpecialist；
- DeploymentSpecialist。

但这些专家必须受到 Capability Fabric 和 Governance System 约束。

## 8. Agent 之间如何协作

不建议让 Agent 自由聊天。协作应该通过结构化产物：

- 计划；
- 任务图；
- diff；
- 测试结果；
- 评审报告；
- 演化建议；
- Git 提交。

结构化产物比对话更可靠。

## 9. 关键结论

AgentArbor 不是“很多 Agent 在一起聊天”，而是“有分工、有制衡、有产物、有验收的 Agent 组织”。
