# 系统架构

本章定义 AgentArbor 的主要系统层和边界。当前架构必须支持 `Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil` 的桌面任务闭环。

架构重点不是堆更多角色，而是保证用户有统一桌面入口、agent 语义判断走 AI-first 主线、Plan 能被执行 runtime 消费、运行过程可监督、候选经验经治理后才进入长期土壤。

## 文档列表

- [系统总览](01-系统总览.md)
- [核心模块](02-核心模块.md)
- [工作台界面](03-工作台界面.md)
- [Agent 集群运行结构](04-Agent集群运行结构.md)
- [植物学语义映射](05-植物学语义映射.md)
- [运行时组织模型](06-运行时组织模型.md)
- [地下中枢与方向成形](07-地下中枢与方向成形.md)
- [地下养料供给与方向修订](08-地下养料供给与方向修订.md)
