# ADR-0030：AgentArbor Pi 原生底层架构

日期：2026-07-20

状态：Accepted

取代关系：本 ADR 取代当前文档中把 OpenAI Agents SDK 作为 Ordinary 生产主循环和 Sub-Agent 原生执行机制的实现口径；保留 ADR-0028 的功能模块化单体、ADR-0026 的 Sub-Agent 产品边界、ADR-0027 的工具单向事实链和 ADR-0029 的工具交付约束。Multi-Agent 业务闭环不在本次迁移范围内。

## 背景

AgentArbor 已经拥有完整的 Ordinary 业务闭环、ToolCenter、确认、工具证据、MCP、Skills、工作区与进程能力，但同时自行维护会话树、模型循环、上下文压缩、工具调度、provider 协议和 SDK 兼容代码。Pi 已提供成熟的 Agent、AgentHarness、Session、分支导航、JSONL 持久化、压缩原语、工具调度、流式事件、provider registry 和动态认证能力。继续并行维护同类机械能力会增加协议扩展、OAuth、token 刷新、分支重试和 provider 适配成本。

本次决策不为既有实现的沉没成本保留第二套底层，也不因为 Pi 能力丰富而把 AgentArbor 的产品业务状态交给外部库。

## 决策

### 1. Ordinary 采用 Pi-native 主链

目标主链是：

```text
Workbench / HTTP
  -> OrdinaryAgentFeature
     -> AgentArbor Pi adapter
        -> Pi AgentHarness / Agent
           -> Pi Session / compaction / provider transport
           -> AgentArbor AgentTool adapter
              -> ToolCenter / confirmation / evidence / MCP / Skills / workspace
     -> ordinary state / repository / read-model
```

Pi 是 Ordinary 的机械执行底座，不是新的业务 feature。OrdinaryAgentFeature 继续决定一次运行何时是 completed、blocked、cancelled 或 failed，并继续拥有 command、event、repository 和 read-model。

### 2. Pi 负责的能力

生产接入完成后，以下机械能力默认直接复用 Pi，不在 AgentArbor 内保留平行实现：

- Agent 与模型-工具-模型循环。
- AgentHarness 的事件、资源与运行控制。
- Session 树、活动 leaf、move/fork、JSONL 存储和分支摘要。
- Pi compaction 的估算、切点、摘要和 compaction entry 语义。
- Pi AgentTool 参数校验、批次执行与流式工具事件。
- `pi-ai` 的 Models/provider registry、流式 transport、provider 认证解析和动态凭据获取。
- Pi 已支持的模型协议和 provider 特性归一化。

AgentArbor 只允许增加必要的薄适配：类型转换、错误归类、事件映射、资源装配和产品事实提交。薄适配不能复制 Pi 的循环、Session tree、provider client、重试器或协议状态机。

### 3. AgentArbor 保留的能力

以下能力属于产品或宿主事实，不能下沉给 Pi：

- Ordinary conversation/run lifecycle、完成语义、排队、取消准入和业务事件。
- ToolCenter 的 executor catalog、冻结工具边界、权限、命令确认和唯一执行事实。
- `ToolCallResult`、完整工具证据、`ToolOutputStore` 与 `read_output`。
- MCP、Skills、附件、工作区、受管进程和 Host 资源生命周期。
- capability snapshot、AgentDefinition 和本轮冻结事实。
- Ordinary repository、HTTP/SSE facade 和 Panel read-model。
- Sub-Agent 的定义发现、权限收窄、禁止递归和父 Ordinary 工具事实。

Pi 的消息与事件只作为执行输入和机械事实被映射；不能直接成为 Panel DTO，也不能绕过 Ordinary reducer 写业务终态。

### 4. 会话与业务状态只有各自一个事实源

- Pi Session 是模型实际消费的会话树和分支上下文的唯一事实源。
- Ordinary repository 是 run 状态、工具事实、确认、usage、timeline 与结果投影的唯一事实源。
- Ordinary run 只保存 Pi session id、起止 leaf/entry ref 和必要的冻结身份，不再复制一份 `canonicalMessages`。
- Pi Session 中的 tool-result message 是有界的模型消费表示；完整执行事实仍只存在于 AgentArbor 的 `ToolCallResult` 与 evidence store。
- 标题、置顶、删除等产品控制事实可以继续由 Ordinary conversation control 保存，但不能再维护另一棵消息 lineage。

旧 Ordinary 会话和旧 snapshot 不迁移、不双读、不回填。切换时采用新的存储版本与目录；旧字节可保留在磁盘，但生产代码不读取。

### 5. 确认与取消通过工具边界适配

Pi 当前没有替 AgentArbor 定义产品级、跨进程可恢复的确认状态。确认仍由 ToolCenter 与 Ordinary feature 拥有，并在 Pi `AgentTool.execute` 内暂停：

1. ToolCenter preflight 形成精确的 confirmation fact。
2. Ordinary 持久化 `approval_required` 并向用户展示。
3. 当前进程内等待同一 confirmation 的决定。
4. approve 后只执行同一预检事实一次。
5. deny/guidance 只拒绝当前 tool call，形成带原 call id 的 error tool result，并交回模型继续判断；不得调用 Pi `abort()`，不得把一次拒绝升级成整个 Agent 停止。
6. 用户显式停止整个 run 是独立 command，继续由 Ordinary 先提交 cancelled 终态，再释放 Pi runtime；它不能复用 confirmation denial 的结果语义。

不得把确认等待放进 `tool_call` hook 后靠抛异常表达拒绝；该路径会把 hook failure 与用户决定混为一谈。进程重启后 live continuation 丢失时，Ordinary 继续按现有契约进入诚实 blocked 状态，不伪造恢复。

### 6. 调度与工具事实边界

Pi 负责模型请求中的工具批次和 AgentTool 调用。AgentArbor 的 ToolCenter 继续保证权限、确认、一次执行和事实完整性。

Pi 的 per-tool `executionMode` 只能表达全批并行或遇顺序工具时全批串行。若 Ordinary 仍需要“前序读取并行、写入独占、后续读取等待”的更细顺序，现有 run-scoped gateway 可以暂时作为 ToolCenter 前的执行机械端口保留；不得再承担模型循环、总量预算或第二套工具结果排序。确认 Pi 能直接表达等价语义后应删除该 gateway。

### 7. 压缩必须覆盖同一运行内的长工具循环

Pi Session compaction entry 是持久会话压缩事实；Pi compaction helpers 是压缩算法实现。生产接入必须同时证明：

- 新一轮 prompt 前可以在 idle Session 上完成持久压缩。
- 同一次 prompt 的多轮模型/工具循环中，每次 provider 请求前仍受物理上下文窗口保护。
- 最新未消费工具协议组保持完整，压缩不能拆开 tool call/result。
- 压缩失败、保留后仍超窗和取消都有明确业务结果。

若 AgentHarness 的公开 hook 无法在不复制压缩算法、不破坏 Session 顺序的前提下满足同一运行内压缩，视为必要能力缺口，必须先向用户报告证据与替代方案；未经同意不得修改或发布 Pi。

### 8. Provider 与认证迁移到 pi-ai

AgentArbor 的模型设置长期改为 Pi provider/model 身份和 provider-owned 配置。OAuth、动态 token 刷新与流式 transport 由 `pi-ai` 负责；AgentArbor 的中性 binding 只通过 Pi 公开 `compat` / payload hook 映射冻结的 provider 方言并逐请求解析 API key。AgentArbor 只保存产品需要的模型选择、能力快照和用户配置，不维护第二套 provider client。

自定义 OpenAI-compatible endpoint 仍是必须能力，但应通过 Pi 的 provider 扩展点接入，不恢复 AgentArbor 自有 Chat/Responses 客户端。未知模型能力由所选 Pi protocol/provider 的真实 round-trip 能力与本轮冻结 override 决定，不使用模型名白名单。

### 9. Multi-Agent 边界不变

本次不改 Multi-Agent 的 manager、TaskBoard、scheduler、child、仓储、事件、read-model 或 `/api/deep/*`。中性模型能力可以演进为将来的 Pi adapter，但不能借 Ordinary 迁移把 Multi-Agent 状态并入 Pi Session 或 Ordinary repository。

Sub-Agent 属于 Ordinary 工具能力，后续改为普通 Pi AgentTool 调用嵌套 Pi Agent/Harness；它仍不建立平行产品状态、仓储或 read-model。

## 迁移规则

迁移按可回滚垂直切片推进：

1. 固定 Pi 版本、Node 版本和能力契约测试。
2. 引入 Pi Session identity 与新会话存储，旧会话直接失效。
3. 用 Pi Agent/Harness 接管 Ordinary 主循环和事件，保持 Ordinary 公共 facade 不变。
4. 把 ToolCenter、确认、证据、MCP、Skills 和 Sub-Agent 贡献映射为 Pi AgentTool。
5. 用 Pi compaction 和 Session 分支替换 `canonicalMessages`、自研压缩与 Ordinary lineage 重复实现。
6. 用 `pi-ai` provider/auth 替换 OpenAI Agents SDK 与自有 Chat/Responses transport。
7. 删除仅服务旧主链的 adapter、类型、测试和依赖。

每个切片必须满足“新能力已经成为生产 owner，旧能力随同删除”。只允许在迁移分支中短期保留对照测试；不得把双运行时、双 Session 或双 provider 作为合并后的稳定架构。

## 当前实施状态

截至 2026-07-21，Ordinary 已完成 Pi AgentHarness/Session、分支回退、上下文压缩、AgentTool、确认、Sub-Agent 和 pi-ai provider binding 的生产切换，OpenAI Agents SDK Ordinary 主循环已经退役。普通 Agent 的显式语义 Skills 路由已通过 Pi Models/provider 的窄无工具通道接入，保留现有输出校验与 fallback。自定义 OpenAI-compatible provider binding 已接入，并完成 profile identity 隔离和动态 API key 清空语义。Multi-Agent 与其他 parity-sensitive Skills consumer 的业务闭环没有改动，仍通过中性 `IntelligenceChannel` 使用原 Chat/Responses transport。

Ordinary provider 切片已经完成：仓库对 pi-ai 0.80.10 固化最小 patch，补齐 Chat/Responses 非流式响应、refusal diagnostic、Responses hosted output continuation 与 incomplete reason、MiniMax 累计 delta 和文本 reasoning details；binding 通过公开 `compat` / `before_provider_payload` 映射 Chat 方言、视觉能力、冻结请求设置和 provider-native Web Search。opaque provider item 只在 provider/API/model 完全一致时由 Pi Session 回放，不进入 Ordinary 业务 snapshot。剩余停线项是 Pi 公共消息契约尚不能无损表达的部分 file/audio/URL/file-id 输入，以及 provider transport 没有 Host 自定义 fetch 注入口。按照本 ADR 的停线规则，未经用户明确决定不得切换仍依赖这些能力的 consumer、删除旧 transport 或把信息缺失伪装成兼容成功。

## 停线条件

发现以下任一情况时停止对应生产切换并先报告用户：

- Pi 无法保留 AgentArbor 必需的工具 call/result 身份或完整消息顺序。
- 无法在同一长运行内安全压缩，且只能复制一套新的压缩状态机。
- 动态认证或自定义 OpenAI-compatible endpoint 无公开扩展点。
- confirmation denial 无法只拒绝当前 tool call，或拒绝后仍可能执行该副作用。
- Pi Session 无法可靠恢复活动 branch/leaf 或 JSONL 顺序。
- 新发现的必要能力只能通过修改或发布 Pi 才能继续，且当前任务未获得对应授权。

报告必须包含代码或测试证据、受影响产品行为、可选方案和推荐；未经用户明确同意不得修改 Pi。

## 验收

- Pi 能力契约覆盖 Session 分支/回退、JSONL 重启、Harness、工具调度、确认、取消、压缩与动态凭据。
- Ordinary 完成、失败、取消、确认、重启 blocked、排队、工具事实、证据续读和 read-model 行为保持。
- 新会话支持回退到历史用户轮并从目标 leaf 创建分支，不删除废弃分支。
- 真实 provider 冒烟至少覆盖一个 Pi 原生 provider 和一个自定义 OpenAI-compatible endpoint。
- Ordinary 生产依赖图中不存在 OpenAI Agents SDK 主链、第二套工具调度器或 `canonicalMessages` 会话事实；共享 provider transport 的退役必须等待上述能力缺口解除或用户明确接受降级。
- Multi-Agent 目标测试保持不变。

## 相关文档

- [当前软件运行方式](../../../CURRENT_RUNTIME_MODE.md)
- [功能模块边界与组合根](../../开发指南/06-工程实现/11-功能模块边界与组合根.md)
- [Pi 原生底层迁移契约](../../开发指南/06-工程实现/12-Pi原生底层迁移契约.md)
- [ADR-0028-AgentArbor统一Workbench与功能模块化单体架构](ADR-0028-AgentArbor统一Workbench与功能模块化单体架构.md)
- [ADR-0027-工具执行事实与单向消费架构](ADR-0027-工具执行事实与单向消费架构.md)
- [ADR-0029-工具结果交付与Ordinary有序执行调度](ADR-0029-工具结果交付与Ordinary有序执行调度.md)
