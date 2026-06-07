# 当前软件运行方式

本文件是 AgentArbor 当前软件运行方式的唯一根目录说明。后续只要默认运行方式、默认入口、主执行引擎或前后端职责发生稳定变化，都必须同步更新本文件，再更新实现代码与其他开发文档。

## 当前默认运行方式

当前 AgentArbor 以桌面普通 `agent` 作为唯一默认运行方式。

- 用户入口：`Desktop Shell / Panel`
- 默认运行模式：`agent`
- 默认执行主线：`用户消息 -> Task Soil -> 普通 Agent 主循环 -> 工具调用/确认 -> 结果投影`
- 当前不对用户暴露 `deep` 入口
- 当前不自动把普通请求升级为 `deep`
- `/api/conversations` 与 `/api/desktop/runs` 当前都只接受普通 `agent` 运行
- 显式深度兼容路径只保留在 `/api/underground/*`

## 当前真实工作方式

### 1. 一个默认 Agent 主循环

当前软件默认只有一个对用户可见的普通 Agent 主循环。它的核心行为是：

1. 装配安全上下文
2. 调用模型
3. 如果模型请求工具，则走后端工具执行与确认边界
4. 把安全工具结果回传模型
5. 直到模型不再调用工具，形成最终结果

这意味着：

- “模型不再调用工具”才表示本轮普通 Agent 正常完成
- 工具调用、确认等待、工具失败后继续判断，都是普通运行的一部分
- `provider` 失败、网络失败、上下文维护失败、进程失败都不是正常完成
- `out_of_fuel` 与 `context_overflow` 必须投影为 `blocked` / `paused`，不能被包装成 `completed`
- 默认普通 Agent 当前不设置固定模型/工具轮次上限；若未来某个普通 Agent 需要轮次边界，必须由 `AgentDefinition.turnPolicy` 显式冻结并进入 run ref，而不是由前端、route helper 或临时执行参数私自决定

### 2. 前后端分离

当前软件采用前后端分离：

- 前端负责：发起请求、订阅流式事件、展示后端 read-model、提交确认决定
- 后端负责：上下文装配、模型调用、工具可见性裁剪、工具执行、确认门控、运行状态、事件投影、持久化与恢复
- 当前 `GET /api/conversations/:id` 会直接返回当前会话正在查看的 `currentRun` 安全投影，包含当前 run 的基础状态、工作视图、结果详情和安全 replay
- 当前 `GET /api/basic-agent/runs/:runId/view?cursor=...` 会返回同一套后端拥有的 run view，供前端在 live refresh、结算刷新和历史运行读取时复用
- 当前后端 run view 的语义字段是 `workView`；`GET /api/basic-agent/runs/:runId/view` 和 `GET /api/conversations/:id` 的 `currentRun` 不再返回顶层 `workSession` alias
- `GET /api/basic-agent/runs/:runId/work-session` 仍作为历史兼容端点保留，会同时返回 `workView` 与 `workSession`；后续新增普通 UI 和普通后端路径不能继续依赖该端点
- 前端在打开会话，以及提交消息、确认决策、取消运行、运行结算、历史 transcript 读取后的刷新路径中，都应优先消费这些后端 read-model，而不是自行拼装运行状态、工作视图、结果详情和事件
- 当前 Panel 前端普通运行主线不再直接依赖 `/api/desktop/runs/:id` 或 `/api/basic-agent/runs/:id/work-session` 来拼装运行视图；这些接口即使保留，也不应继续作为默认普通 Agent 观察主线
- 历史运行和恢复运行的 read-model 必须优先使用 run 创建时冻结的 `capabilitySnapshot` 和 `informationAccess` 作为模型、工具、工作区和信息访问事实；当前配置只能作为旧记录缺失快照时的兼容回退
- 普通 `agent` run 的 live model stream 只接受 `desktop_agent` 和历史 `desktop_chat` 的用户可见模型增量；`work_session_*` 增量只服务显式 `deep` 或历史兼容路径，不能混入默认普通流式输出

前端不是 Agent 引擎，也不负责推导任务状态、补全工具语义或重建运行事实。

### 3. 工具属于后端设施能力

当前工具能力属于后端设施，不属于前端，也不属于 prompt 自由扩展范围。

- 工程决定本轮 Agent 能看见哪些工具
- 当前默认普通 `agent` 的工具可见性由后端结构化能力快照与 `AgentDefinition.toolVisibilityProfile` 共同裁剪，不再依赖工具名前缀约定
- 普通 `agent` 只有在后端已经冻结 `capabilitySnapshot` 后，才会把工具暴露给模型；裸 `ToolCenter` 只负责执行，不再单独决定模型可见工具
- 普通 `agent` 的本轮模型配置事实来自 run 创建时冻结的 `capabilitySnapshot.activeModel`；执行、持久化、恢复和用户可见 read-model 不能再用当前全局模型配置覆盖它
- 普通 `agent` 的本轮模型能力事实来自 run 创建时冻结的 `capabilitySnapshot.modelCapabilities`；直接调用参数里的临时 `modelCapabilities` 只能服务没有冻结快照的测试或兼容调用，不能覆盖已创建 run 的上下文窗口、输出预算、工具调用能力或流式能力
- 普通 `agent` 在请求未显式指定 `aiMode` 时，默认 `aiMode` 也从本轮 `capabilitySnapshot.activeModel.defaultAiMode` 派生；入口层不得为了默认值提前读取当前全局模型配置
- 普通 `agent` 执行阶段只能消费 run 创建时冻结的 `capabilitySnapshot`；执行资源不得在运行中重新向 `CapabilityCenter` 获取当前快照来替代本轮事实
- 普通 `agent` 的本轮 ToolCenter 执行器全集也必须从 `capabilitySnapshot.toolCatalog.tools` 派生；当前代码新增、删除或启停工具只能影响新 run，不能扩张已创建 run 的可执行工具集合
- 普通 `agent` 的技能可见与触发集合也来自 run 创建时冻结的 `capabilitySnapshot.skillCatalog`；执行期间的当前 skill 启停状态只影响新 run，不改写已创建 run
- MCP 当前只进入配置目录、能力快照的 `mcpCatalog` 和能力草案投影；默认普通 `agent` 不把 MCP 工具作为模型可见工具或默认可执行工具
- 工程决定哪些工具可以执行、哪些需要确认、哪些被隐藏
- `AgentTurnRuntime / tool-use-loop` 在调用工具执行器前必须强制校验本轮 `allowedTools`；`ToolCenter` 和具体 adapter 仍可重复校验，但不能成为唯一防线
- 模型只能在本轮可见工具集合内自主选择
- 模型不能绕过 ToolCenter、权限、确认、沙箱和安全投影

### 4. 当前默认产品边界

当前默认产品只打磨普通桌面 Agent，不把长期 deep 架构混入默认路径。

- 保留长期 `deep / Agent cluster` 架构方向
- 但当前默认路径不展示、不自动触发、不主动扩展 deep 后端
- 普通文件编辑、读写、命令、搜索等动作必须使用朴素命名，不能包装成过重概念

## 当前应如何理解代码

如果你只想知道当前软件“怎么运行”，优先以本文件为准，再看这些正式文档：

1. `docs/开发指南/README.md`
2. `docs/开发指南/00-总览.md`
3. `docs/开发指南/04-模型与契约/09-普通Agent自主运行契约.md`
4. `docs/开发指南/06-工程实现/README.md`
5. `docs/开发指南/06-工程实现/09-普通Agent主干开发指南/README.md`

只有在这些文档不足以解释细节时，才需要进入代码。

## 更新规则

出现以下任一变化时，必须先更新本文件：

- 默认用户入口变化
- 默认运行模式变化
- 主执行引擎变化
- 普通 Agent 完成语义变化
- 前后端职责边界变化
- 工具暴露与执行边界变化
- 默认是否暴露 `deep` 的产品策略变化

如果代码实现已经变化，但本文件未更新，应视为文档失效，需要先补齐文档再继续演进。
