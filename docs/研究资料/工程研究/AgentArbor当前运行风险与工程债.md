# AgentArbor 当前运行风险与工程债

## 文档定位

本文只登记当前生产入口仍有代码证据的运行风险和结构性工程债，不保存阶段推进过程，也不把历史报告中的旧文件名、旧测试结果或已修问题继续描述为现状。

当前运行事实以根目录 `CURRENT_RUNTIME_MODE.md`、开发指南和生产代码为准。本文是工程研究与后续任务输入，不替代正式开发指南，也不是修复计划或发布阻断清单。

本轮基线为 2026-08-05 当前工作树。结论来自静态源码和现有测试源码检查；本轮没有重新执行 build、test 或浏览器检查。未提交工作树中的 Panel 可靠性修复也计入现状，因此本文描述的不是纯 `HEAD` 基线。

## 当前运行基线

- 当前唯一默认产品入口是 Desktop Shell / Panel 中的 Ordinary Agent。
- 当前生产主线是 `request-handler -> ordinary-routes -> OrdinaryAgentFeature -> Agent Session adapter -> Pi AgentHarness/Session -> ToolCenter`。
- `/api/deep/*` 固定返回 `410 multi_agent_deferred`；延期 Multi-Agent 不进入生产组合根。
- 当前 Ordinary 持久化事实为 `ordinary-run/v6`，Workbench 结构化数据位于 `runtime/workbench.sqlite3`。
- 当前没有确认的 P0 问题，即没有证据表明正常环境下软件会因为下列遗留项而无法启动或无法进入 Ordinary 主流程。

## 分级口径

| 级别 | 含义 |
| --- | --- |
| P0 | 正常环境下阻止软件启动、阻止 Ordinary 主流程运行，或确定破坏持久化事实。 |
| P1 | 特定崩溃、重启或并发窗口可能留下持久不一致，且没有自动补偿。 |
| P2 | 可能造成界面陈旧、单轮运行降级或条件性失败，但不阻止软件整体运行。 |
| P3 | 当前没有直接运行故障证据，但会降低维护、验证或故障定位可信度。 |

## 当前运行时风险

### RUN-01：终态后的 Space 本地文件对账缺少持久化补偿

- 级别：P1
- Owner：Host 的 Ordinary -> Space 精确连接边界。
- 当前行为：Ordinary run 进入稳定终态后，Host 检查本轮冻结的 `local_file`；确认源文件不存在时，通过 Space 公开命令取消链接。
- 遗留窗口：终态事实已经持久化，但进程在内存订阅触发对账前退出时，没有 durable pending reconciliation 事实供下次启动补偿。
- 用户影响：Space 可能继续展示一个已经不存在的本地文件引用；后续访问该引用会失败，但 Ordinary 主流程仍可运行。
- 代码证据：`src/app/panel-server/runtime.ts` 的 stable-terminal 订阅装配，以及 `src/app/panel-server/space-file-reference-reconciliation.ts` 的当前对账实现。
- 关闭标准：建立幂等、可恢复的待对账事实或启动扫描入口，并增加“终态提交后、对账前崩溃”的重启测试。

### RUN-02：Workbench projection cursor 缺少跨进程代次

- 级别：P2
- Owner：Panel Server 的 Workbench projection change feed。
- 当前行为：projection revision 是进程内递增整数，每次进程启动从 0 开始；客户端 cursor 只有 revision，没有 server epoch 或 boot identity。
- 用户影响：后端独立重启后，旧 cursor 与新进程 revision 可能碰撞，客户端可能漏掉一次 invalidation，继续显示旧数据直到下一次变化或主动刷新。
- 代码证据：`src/app/panel-server/workbench-projection-change-feed.ts` 与 `src/app/panel-server/workbench-projection-routes.ts`。
- 关闭标准：cursor 带入进程代次，或重连时无条件发送可识别的 reset；覆盖跨进程相同 revision 的测试。

### RUN-03：Workbench asset 文本编辑没有对应 projection invalidation

- 级别：P2
- Owner：Workbench asset feature / Panel projection adapter。
- 当前行为：文本编辑 route 直接调用 repository 更新资产，但 Workbench projection feed 没有对应 owner 或 change event。
- 用户影响：同一资产在其他窗口、查询缓存或已打开视图中可能继续显示旧内容。
- 代码证据：`src/app/panel-server/workbench-asset-routes.ts` 与 `src/app/panel-server/workbench-projection-change-feed.ts`。
- 关闭标准：写入由 owning feature command 发布精确变化，Host 只映射事件；增加跨窗口或缓存失效测试。

### RUN-04：ReadOutput 自定义预算没有统一进入内置工具工厂

- 级别：P2，条件性风险。
- Owner：ToolCenter 的内置工具装配。
- 当前行为：ReadOutput 已支持显式 token budget，默认生产预算和最终模型投影也有测试；但内置工厂没有统一透传所有自定义 ToolCenter budget。
- 用户影响：只有非默认自定义预算配置可能出现续读窗口与调用方预期不一致；没有证据表明默认生产配置因此失败。
- 代码证据：`src/app/tool-center/adapters/tool-output-read-tool.ts` 与 `src/app/tool-center/builtin-tool-runtime.ts`。
- 关闭标准：ToolCenter 只有一个预算事实源，内置 Reader 与 producer 使用同一冻结预算，并覆盖自定义预算测试。

### RUN-05：Skill asset/script hash 没有独立字节上限

- 级别：P3，低概率性能风险。
- Owner：Skills resource resolver。
- 当前行为：asset/script 不返回 raw body，但 resolver 仍完整读取文件流并计算 SHA-256；调用层 `maxChars` 只限制返回窗口，不限制 hash 输入字节。
- 用户影响：异常大的本地 skill asset/script 可能造成额外 I/O、CPU 和等待时间；没有正常 skill 导致软件不可用的证据。
- 代码证据：`src/app/skills/skill-resource-resolver.ts` 与 `src/app/skills/skill-resource-tool.ts`。
- 关闭标准：为可索引资源定义独立字节上限和稳定错误，并覆盖超限文件测试。

## 前端结构性风险

以下问题会提高运行时回归概率，但当前没有证据证明它们会直接阻止软件启动，因此不列为当前运行故障。

### UI-01：根 AppState 仍承担过多状态所有权

根 `App` 仍以单一 `useState` 持有 Ordinary、配置和延期 Deep 兼容字段，并把 `setApp` 传入多个控制器。当前已有 `app-state-domains` 和 personal-workbench 分组，但 feature-owned controller 边界仍未完成。

关闭方向不是再横向拆 helper，而是让 Ordinary surface、设置和 Shell 各自拥有状态与命令，Shell 只组合公开投影。

### UI-02：服务器配置与本地表单仍是双状态

设置数据复制到多组本地 state，再通过多个 effect 与服务器投影同步。该模式可能覆盖用户正在编辑的值，也增加初始化时序和非空断言。

关闭方向是明确 draft owner：服务器投影只负责初始化或显式 reset，用户编辑期间由表单 draft 单独拥有，保存成功后再提交新基线。

### UI-03：实时更新控制器仍聚合多种生命周期

当前 `app-live-run-updates.ts` 同时处理 SSE、bootstrap polling、fallback、终态对账、失活和多组 refs。当前工作树已改善终态读取失败和过期订阅竞态，但控制流仍集中。

关闭方向是按“订阅生命周期、投影对账、终态收口”拆成有明确输入输出的 owner，而不是按函数数量继续拆文件。

巨型组件、CSS 体量、缺少 lint、`key={index}` 和静态 inline style 仍是前端治理问题，但没有直接运行故障证据，不进入当前运行风险清单。它们应在独立前端治理任务中处理。

## 验证与维护债务

这些问题影响工程门禁或认知成本，不代表生产软件当前无法运行。

### ENG-01：deferred 依赖图测试仍有 false negative

测试收集 `src/deferred/deep` 文件作为查询起点，却使用只由 `src/app` 构建的依赖图。deferred 文件不在图中时，依赖路径查询可能恒为空。独立 archive 守卫只能证明生产源码不 import deferred，不能证明 deferred 内部没有反向依赖 Ordinary/Desktop。

### ENG-02：测试目录清理守卫漏检直接导入的 rm

当前守卫只匹配 `fs.rm(...)` / `fs.rmSync(...)`，不能发现从 `node:fs/promises` 直接导入的 `rm(...)`。仓库仍有不带 Windows retry 参数的直接调用，可能产生测试假失败。

### ENG-03：正式文档仍有运行事实漂移

根运行事实已经是 `ordinary-run/v6` 且 `/api/deep/*` 固定返回 410，但部分普通 Agent 主干指南仍描述 v5 或正式 Deep 路径。该问题不会破坏运行时，却会误导后续实现和审查。

### ENG-04：延期 Deep 前端契约仍位于 active Panel 源码树

后端隔离已经成立，但 active Panel 仍保留 Deep state/contracts，增加类型检查、重构和认知表面积。只有重新定义 Multi-Agent 产品与运行契约后才应恢复；在此之前不能把这些类型解释为当前可用功能。

### ENG-05：ToolOutput owner 与 bearer ref 语义尚未正式化

ToolOutput 保存 owner 用于生命周期清理，而 ReadOutput 按 opaque ref 读取。当前没有已证明的跨 run 越权路径，但授权模型到底是 owner-bound 还是 bearer ref 尚未写成明确契约。应先确定语义，再决定是否让 read/release 校验 owner。

## 已关闭或不再适用的历史问题

以下旧结论不应再进入当前问题列表：

- 损坏 Ordinary run 拖垮全局 ready：恢复现已按 conversation 隔离并形成诊断。
- Sub-Agent `maxSteps` 是未执行预算：该字段已明确成为 ignored diagnostic，不进入正式定义或执行输入。
- successor 激活只有一次尝试：现已有 conversation-owned activation pump、退避重试和诊断。
- Panel `_archive` 测试与 typecheck 输入冲突：对应目录已不存在。
- ToolCenter ownership 测试对展示投影的原误报：原触发调用已移除。
- 上传附件没有 owner/GC：现由 Ordinary managed-attachment repository 持有 draft、claim、回滚、启动 orphan 对账和 conversation GC。
- Workbench restore 没有 crash phase：现已有 restore journal、commit marker、commit 前回滚和 commit 后收尾。
- Space 删除暂存文件没有启动对账：现已有 feature-owned deletion journal 和 fail-closed 启动恢复。
- SpaceAddReference 接受模型原始相对路径：现只接受本轮 Task Soil 已授权的 attachmentId。
- Personal Knowledge 托管资产发布错误 owner：现由 PersonalKnowledgeFeature command 更新并发布 `personal_knowledge` 变化。
- Knowledge asset pending/deleting 没有启动对账：现已有启动恢复和中断测试。
- PathMemory wiring 测试夹具漂移：当前夹具已创建真实 Session repository 与 checkpoint。

## 维护规则

- 只记录当前代码仍有证据的问题；修复后将条目移动到“已关闭”，不要保留失效的严重度和旧文件清单。
- 每个 active 条目必须写明 owner、触发条件、用户影响和可执行关闭标准。
- 新问题若只影响测试、文档或维护成本，进入“验证与维护债务”，不能描述为软件运行故障。
- 默认入口、运行引擎、完成语义、持久化版本或前后端职责变化时，必须先更新 `CURRENT_RUNTIME_MODE.md`，再更新本文。
- 历史测试数字不能作为当前证据；需要发布判断时必须重新执行对应验证。
