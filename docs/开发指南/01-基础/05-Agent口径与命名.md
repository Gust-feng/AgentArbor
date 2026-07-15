# Agent 口径与命名

## 基本口径

AgentArbor 的 `agent` 不是所有自动化逻辑的泛称。只有具备目标理解、上下文判断、工具选择、行动反馈和可观察运行边界的执行主体，才应被称为 agent。

当前产品只有一个 Workbench，并包含三类明确能力：

- Ordinary Agent：默认工作方式，负责连续对话、模型工具循环、授权工具执行、命令确认、运行投影、持久化和用户可见结果。
- Multi-Agent：用户显式选择的深入协作功能，当前内部沿用 `deep` / `DeepRuntime`，负责 intake、manager、多路 child 探索、父层综合、纠正和停止。
- Sub-Agent：Ordinary Agent 按需调用的工具能力，不是独立模式或 Multi-Agent child。

Ordinary 与 Multi-Agent 只共享模型、工具、确认、上下文机械算法和系统适配等中性能力，并分别拥有业务流程、状态、事件、仓储与 read-model。Sub-Agent 只拥有定义与 SDK AgentTool 贡献，执行事实进入父 Ordinary run；Workbench Shell 只组合导航和展示。不得以共享为名建设统一 Run runtime、RuntimeDatabase 业务仓储、全局状态或跨 feature Panel read-model。

默认普通 Agent 的产品交互是线性会话驱动，不是任务驱动。它可以处理用户以“任务”形式输入的请求，但运行时只把每一轮用户消息、历史对话、上下文引用、工具结果和确认决定串成同一条 conversation 时间线；它不维护独立任务生命周期、任务拆解状态机、Plan 交接对象或多 agent 协作状态。任务驱动、目标成形、多候选探索和 Plan 交接留给后续显式 deep / Agent 集群能力。

## 当前默认 Agent

默认普通 Agent 是当前活跃实现主线。它的产品形态应接近成熟桌面助手：用户输入任务或问题，系统在当前会话上下文内调用模型，模型按需使用授权工具，工具结果回到模型，最终由模型给出自然语言或成果级回答。

默认普通 Agent 的基本体验是同一会话中连续推进：上一轮完成回答成为后续上下文，用户可以继续追问、纠正、补充要求或提交确认决定。工程层不得把普通会话改造成隐藏任务工作流，也不得要求普通回答先落入任务对象、阶段对象或 Plan Package 才能继续。

普通 Agent 不自动升级到 Underground，不派生 child/rootlet，不把普通文件编辑包装成 Plan / Handoff / Growth / deep flow，也不在普通会话、确认卡或首屏面板展示地下/地上组织术语。

复杂输入也先进入普通 Agent。模型可以回答、请求补充上下文、调用授权工具或说明需要进入更深入流程的原因；工程层不得用关键词、文本长度、文件数量或固定阶段把普通请求自动路由到 deep。

## 深入 Agent 集群

Multi-Agent 是统一 Workbench 内的显式功能，适用于需要方向成形、多候选比较、证据探索和父层综合的任务。当前一期产物可以是综合结论，不要求伪造 Plan、执行组织或治理回流。

Multi-Agent 必须通过中性能力端口复用模型、工具、确认和系统适配，同时完整拥有自己的 DeepConversation、TaskBoard、scheduler、child、synthesis、事件、仓储和 read-model。未来 Plan、Aboveground、Nutrient Request 和 Governance 只有在真实契约出生后按独立模块接入，不能提前写进每次 Multi-Agent 流程，也不能反向污染 Ordinary。

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
| 普通会话中模型自主调用的专家助手 | `sub-agent` / `子 Agent` / `call_sub_agent` | `child` / `rootlet` / `deep child`（这些是 deep 编排术语） |

`atomic` 只能用于真正具有事务边界的场景：全部校验通过才写入、失败不落盘、或有明确回滚/一致性保证。用户可见工具说明和普通文档应优先使用“编辑”“补丁”“变更集”等直白词。

## 实现规则

- `runMode: "agent" | "deep"` 只表示编排策略选择，不表示两套工具、事件、确认、持久化或投影实现。
- 默认入口始终创建 `agent` run；deep 只能由明确产品入口、显式用户选择或后续 deep 项目契约触发。
- 历史 `work_session` 请求别名不能再被接口层映射为 deep；开发期旧数据直接废弃，不建设兼容入口。
- 普通路径不展示 fake Plan、fake report、fake artifact、未出生的 Routines、团队 agent 或 deep 占位入口。
- 新增概念前必须说明它承担的独立职责、输入输出、失败方式、测试边界和可观察投影；否则使用朴素名称。
- 子 Agent（sub-agent）是普通 Agent 的工具能力，不是独立编排流程；它通过 SDK 原生 `call_sub_agent` / `spawn_sub_agent` AgentTool 被模型自主调用，不维护独立任务生命周期、不派生 Plan、不走 `/api/deep/*` 入口。子 Agent 的工具集强制排除 Sub-Agent 工具，因此不能递归派生。子 Agent 与 deep child/rootlet 是不同概念：deep child 由 DeepRuntime 编排，走 manager 自由决策循环和 DeepTaskBoard；子 Agent 由 Ordinary 的 OpenAI Agents SDK loop 调用，并通过父 run 的 ToolCenter 执行获准工具（见 ADR-0026）。
- 工程边界可以保护权限、预算、审计、验证和命令确认，但不能替 agent 判断目标、工具选择、候选取舍或是否继续探索；普通模型正文、工具结果、错误信息、文件内容、stdout/stderr 和开发上下文不得被脱敏或安全投影吞掉。

这条口径的目标是同时避免两种错误：一是为了当前简单实现删除未来 deep / agent 集群方向；二是在默认普通 Agent 中提前使用超出实际职责的重命名、伪协议和伪复杂流程。
