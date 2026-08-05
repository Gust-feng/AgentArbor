# ADR-0034：Space 工作区引用与对话资源生命周期

日期：2026-08-06  
状态：Accepted

取代关系：本 ADR 固化 Space、Workspace、Conversation、路径权限和后台进程的当前产品语义。它不重启 Multi-Agent，也不改变 ADR-0030 对 Pi 机械运行时的所有权划分；与 ADR-0028 的功能模块化单体边界共同生效。若旧文档把 Workspace 当作 Space 的子目录、允许 Conversation 运行中切换 owner 或把 `workspaceRoot` 当作唯一权限事实，以本 ADR 为准迁移。

## 背景

AgentArbor 同时维护软件自己的语义、Conversation/Run 状态、工具事实和派生资产，并允许用户把真实本地文件夹作为工作上下文引用。过去的实现和讨论混用了以下概念：

- Space 是容器还是 Workspace 的拥有者。
- Conversation 是独立对象还是可以在运行中切换工作区。
- 模型应该使用真实路径还是只能使用内部稳定 ID。
- 文件工具的路径边界和 Shell 的命令确认是否是同一权限。
- 取消引用是否要清理历史派生数据。
- 缺失路径、移动路径和重新添加是否可以自动恢复。

如果这些问题没有单一事实源，权限会在文件工具、Shell、Panel 和后台进程之间漂移，历史证据也会被错误清理。

## 决策

### 1. Space 只拥有语义和引用，不拥有外部 Workspace

Workspace 是用户文件系统中的真实文件夹。Space 维护 `SpaceReference`，引用一个或多个 Workspace；一个 Workspace 可以被多个 Space 引用。引用不转移文件所有权，不复制目录，也不因 Space 删除而删除外部文件。

Space 可以拥有 AgentArbor 自己的 managed folder、Conversation、Run、工具事实和其他软件资产。这些软件资产与外部 Workspace 必须在类型、权限和删除流程上分开。

同一 Space 内禁止重复或父子 Workspace 引用，避免模型路径解析出现多个候选根。跨 Space 的重叠引用允许，因为它们互不改变对方的引用关系。

### 2. Conversation 统一归属 Space，创建后不可切换

首页是新 Conversation 的唯一入口。首页选择 Space，或把“选择 Workspace”解释为创建一个只引用该 Workspace 的新 Space 后再创建 Conversation。Conversation 只有一个 `SpaceConversationOwner`，不能同时持有 Space owner 和 Workspace owner。

Conversation 创建后进入独立对话面；对话面不提供切换 Space/Workspace 的运行命令。用户要使用另一个 Space，应创建或打开另一个 Conversation。

删除 Space 会级联删除其 Conversation、Run、工具证据、Space 元数据和 Space-owned managed folder。外部 Workspace 保留。删除不是 Conversation 迁移。

### 3. Run 冻结资源快照，但撤销是即时硬拒绝

每个 Run 在用户消息提交时冻结当时的 Space 引用清单、路径、文件权限、Shell 模式和工具边界。新增引用只影响后续 Run，不能在当前模型循环中扩张权限。

取消引用或删除引用是单调的硬撤销：执行器在每次文件工具调用前检查当前引用状态，已撤销引用即使存在于旧快照也不能继续读取或写入。已完成的调用不回滚；在途调用按普通取消或结果未知契约收口。

该规则同时满足“Run 需要可重放的出生事实”和“用户撤销后模型不能再次访问”两个要求：快照保护扩张，deny overlay 保护撤销。

### 4. 模型看真实路径，后端保留稳定身份

模型上下文必须包含资源标题、实际绝对路径和读写权限。文件工具和 Shell 的 `cwd` 使用模型可理解的真实路径；不把 opaque `referenceId` 伪装成文件路径，也不要求模型通过 ID 猜目录。

后端仍为每条引用保留稳定 `referenceId`，用于权限解析、路径历史、工具事实、后台进程绑定和审计。重新添加同一路径必须创建新 `referenceId`，不能恢复旧 Conversation 的访问权。

### 5. 路径变化必须显式处理

路径存在时按平台规范化和 `realpath` 检查；Windows 使用不区分大小写比较，Unix 保留大小写。symlink/junction 必须按真实目标做边界检查。

缺失路径进入 `unavailable`，UI 只提供提醒和用户确认移除。确认后从当前 Space 资源树删除引用概念，但不清理历史 Conversation、Run 或软件资产。路径移动只能由用户显式重新定位，并生成新的引用身份或明确的迁移事实；不得静默绑定同名目录。

状态区分 `available`、`unavailable`、`relocated`、`removed` 和 `deleted`，不把离线、移除和物理删除混成一个布尔值。

### 6. Shell 采用确认优先，完全访问是明确的双范围模式

普通模式下每次 Shell 命令都通过 ToolCenter 取得用户确认。确认内容包含完整命令、实际 `cwd`、Conversation/Space 和潜在后台副作用。普通模式不承诺 OS 级沙盒；确认是命令执行授权，因此命令经用户确认后可能读取文件工具边界之外的路径。

`full_access` 是 Run 级显式模式，同时覆盖：

- Shell 免逐条确认。
- 文件工具解除 Workspace 路径集合限制。

完全访问仍不能绕过 ToolCenter、schema、取消、审计、执行事实或 Space 删除/引用撤销的硬拒绝。模式在 Run 创建时冻结，只影响新 Run。

### 7. 后台进程归 Host 维护，权限撤销触发收口

现有进程注册、前后台 Shell、日志、端口等待和进程树终止能力继续由 Host 进程能力拥有。每条受管进程事实记录 `spaceId`、`referenceId`、`conversationId`、`runId`（可选）、实际命令、`cwd`、授权模式、日志引用和退出状态。

取消 Workspace 引用时，关联后台进程进入 revoke/stop 流程：停止请求成功则收口；停止失败则标记 `stop_pending` 并提醒用户。失败不能被隐藏，也不能让模型通过该进程继续取得已撤销引用的权限。进程日志和退出事实仍是软件资产。

删除 Space 时先阻止新 Run、请求停止关联进程并完成有限等待，再清理 Conversation/Run 和 Space-owned 资产。删除 journal 失败必须可见、可重试，不能伪造删除完成。

### 8. 模块所有权不扩张

- Space feature 拥有 Space、引用和引用生命周期事件。
- Ordinary feature 拥有 Conversation、Run、完成语义、工具事实和对话删除。
- ToolCenter 拥有工具 catalog、冻结执行授权、确认和唯一执行事实。
- Host/Composition Root 创建并释放 Path resolver、进程管理器、ToolCenter、Space 和 Ordinary feature。
- Pi 负责模型-工具循环、Session、压缩和 provider 机械能力；不拥有 Space/Workspace 业务权限。
- Panel 只调用公开 command/query/event facade，不读取其他 feature 的 store 或 live map。

不建设全局 Workspace manager、universal Run runtime、跨 feature service locator 或第二套 Shell/Process runner。

## 被拒绝的替代方案

### A. Space 直接拥有 Workspace

拒绝。Workspace 是用户外部资源，多个 Space 需要共享引用；把它建模为子目录会诱导 Space 删除物理删除用户文件，也会制造移动和权限转移歧义。

### B. Conversation 同时绑定 Space 和 Workspace

拒绝。双 owner 会让首页、历史、权限和删除出现两套事实。Workspace 快捷入口应创建“单 Workspace 的 Space”，而不是增加第三种 Conversation。

### C. 模型只使用稳定 ID

拒绝。模型需要知道真实路径才能正确设置 `cwd`、解释工具结果和选择文件。稳定 ID 只保留为后端审计/身份，不作为模型文件操作协议。

### D. 取消引用时清理历史派生数据

拒绝。取消引用是撤销未来权限，不是数据删除；历史回答、工具事实、日志和路径快照必须保留以支持解释、审计和软件自身语义。

### E. 自动猜测移动后的目录

拒绝。路径字符串相似不代表同一资源。自动改绑会让模型在未授权目录上继续运行，重新定位必须由用户显式选择。

### F. 当前阶段直接建设 OS 级 Shell 沙盒

暂不采用。当前产品选择每次 Shell 命令确认，优先解决可见性和授权事实。若未来需要无确认执行、隔离用户或多租户，再单独提出 OS 沙盒 ADR；不能把现有应用层路径检查描述成强制沙盒。

## 后果

正面后果：

- Space、Workspace、Conversation 和软件资产的所有权清楚。
- 模型能直接使用真实路径，同时历史和权限检查保留稳定身份。
- 新增权限不会污染旧 Run，撤销权限也不会等待新会话才能生效。
- 取消引用不会破坏历史证据，Space 删除仍有明确的级联边界。
- Shell 的确认和完全访问含义可被用户理解、审计和测试。

成本与风险：

- 需要新的 Path resolver 和当前撤销 deny overlay，不能继续只传 `workspaceRoot`。
- Space 删除需要跨 Space/Ordinary/Host 的协调和删除 journal。
- 后台进程停止失败必须有可见的异常状态，不能只依赖进程退出回调。
- 旧的只接受 `referenceId + relativePath` 的模型工具和旧 `CURRENT_RUNTIME_MODE.md` 表述需要迁移。

## 迁移与验收

迁移顺序和测试矩阵见 [Space、Workspace、Conversation 与资源权限开发指南](../../开发指南/06-工程实现/18-Space工作区对话与资源权限开发指南.md)。合并前至少证明：

- 同一 Space 的重复/父子 Workspace 引用被拒绝，跨 Space 引用可共存。
- 缺失 Workspace 只能经过用户确认移除，重新添加同路径不恢复旧权限。
- Conversation owner 不可切换，Space 删除会清理其 Conversation/Run，外部 Workspace 不受影响。
- 新增引用只影响新 Run，撤销引用会阻止活动 Run 的后续文件调用。
- 普通 Shell 每次确认，full access 同时覆盖 Shell 和文件路径但不能绕过 ToolCenter 或撤销。
- 后台进程带有 Space/reference 关联，撤销和删除都能收口或明确报错。
- 文档、运行模式说明、Space adapter、ToolCenter 和 Panel facade 不再维护相互冲突的第二套事实。

