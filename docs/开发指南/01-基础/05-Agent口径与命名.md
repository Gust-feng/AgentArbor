# Agent 口径与命名

## 基本口径

AgentArbor 的 `agent` 不是所有自动化逻辑的泛称。只有具备目标理解、上下文判断、工具选择、行动反馈和可观察运行边界的执行主体，才应被称为 agent。

当前产品同时保留两层能力：

- 默认普通 Agent：当前默认桌面会话入口，负责连续对话、模型工具循环、授权工具执行、确认、安全投影、持久化和用户可见结果。
- 深入 Agent 集群：长期 `deep` 能力边界，负责目标成形、多路探索、child/rootlet 派生、父层综合、裁决、Plan 形成和后续执行组织；它不是废弃方向，但必须等显式 deep 项目重启后按契约推进。

二者共享 AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase、Skill Context、模型运行时和 Workbench Panel read-model；二者隔离的是编排策略、用户入口和可见语义。

## 当前默认 Agent

默认普通 Agent 是当前活跃实现主线。它的产品形态应接近成熟桌面助手：用户输入任务或问题，系统在安全上下文内调用模型，模型按需使用授权工具，工具结果回到模型，最终由模型给出自然语言或成果级回答。

普通 Agent 不自动升级到 Underground，不派生 child/rootlet，不把普通文件编辑包装成 Plan / Handoff / Growth / deep flow，也不在普通会话、确认卡或首屏面板展示地下/地上组织术语。

复杂输入也先进入普通 Agent。模型可以回答、请求补充上下文、调用授权工具或说明需要进入更深入流程的原因；工程层不得用关键词、文本长度、文件数量或固定阶段把普通请求自动路由到 deep。

## 深入 Agent 集群

深入 Agent 集群是 AgentArbor 的长期产品能力，不因为当前先打磨普通 Agent 而删除。它适用于需要方向成形、多候选比较、证据探索、父层综合、Plan 交接、执行组织和治理回流的任务。

deep 重启时必须复用共享基础设施，不能另起平行运行时。它可以拥有自己的 Underground / Aboveground 编排策略、Agent Fabric、Plan Package、Nutrient Request 和 Governance 流程，但这些能力不能反向污染普通 Agent 的默认工具可见性、事件投影、确认语义和用户文案。

## 什么是这里的过度设计

这里反对的过度设计，不是保留长期 deep / agent 集群架构，而是把简单工程动作套上超出实际语义重量的概念名、状态机或协议。

命名必须和真实职责匹配：

| 场景 | 推荐命名 | 避免命名 |
| --- | --- | --- |
| 修改一个文本文件 | `FileEdit` / `edit_file` / `Patch` | `Atomic Mutation` / `Plan Rewrite` |
| 多个编辑先全部校验再一次落盘 | `ChangeSet` / `batch edit`；确有全成功/全失败语义时可用 `atomic` | 用 `atomic` 包装普通修改 |
| 模型按需调用工具并回答 | `Basic Agent Run` / `普通 Agent run` | `Underground flow` / `deep run` |
| 多 child/rootlet 探索并由父层综合 | `Underground` / `deep` / `Agent cluster` | 普通会话内部隐式触发 |
| 可持久化、可验证、可恢复的方向交接对象 | `Plan` / `Plan Package` | 普通回答或临时摘要叫 Plan |
| 纯函数、helper、adapter 或 formatter | `helper` / `service` / `adapter` | `agent` |

`atomic` 只能用于真正具有事务边界的场景：全部校验通过才写入、失败不落盘、或有明确回滚/一致性保证。用户可见工具说明和普通文档应优先使用“编辑”“补丁”“变更集”等直白词。

## 实现规则

- `runMode: "agent" | "deep"` 只表示编排策略选择，不表示两套工具、事件、确认、持久化或投影实现。
- 默认入口始终创建 `agent` run；deep 只能由明确产品入口、显式用户选择或后续 deep 项目契约触发。
- 历史 `work_session` 请求别名不能再被接口层映射为 deep；旧读模型或兼容路径只能服务历史数据和诊断，不能成为新入口。
- 普通路径不展示 fake Plan、fake report、fake artifact、未出生的 Routines、团队 agent 或 deep 占位入口。
- 新增概念前必须说明它承担的独立职责、输入输出、失败方式、测试边界和可观察投影；否则使用朴素名称。
- 工程边界可以保护权限、预算、审计、验证和脱敏，但不能替 agent 判断目标、工具选择、候选取舍或是否继续探索。

这条口径的目标是同时避免两种错误：一是为了当前简单实现删除未来 deep / agent 集群方向；二是在默认普通 Agent 中提前使用超出实际职责的重命名、伪协议和伪复杂流程。
