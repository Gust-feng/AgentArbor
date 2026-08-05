# Space、Workspace、Conversation 与资源权限开发指南

## 1. 文档定位

本指南把 Space、Workspace、Conversation、Run、文件工具、Shell 和受管后台进程的稳定语义转化为工程契约。它适用于当前生产主线 Ordinary Agent，不为已延期的 Multi-Agent 重新建立入口、状态或运行时。

长期取舍见 [ADR-0034-Space工作区引用与对话资源生命周期](../../架构设计/产品架构/ADR-0034-Space工作区引用与对话资源生命周期.md)。本指南负责实现细节、边界条件、迁移顺序和验收标准。代码、测试和 Panel adapter 必须以本指南为准；旧文档中仅把 `workspaceRoot` 当作唯一资源事实、允许对话切换工作区或把 Space 当作 Workspace 容器的表述均视为待迁移口径。

## 2. 稳定结论

### 2.1 产品入口

- 首页是创建新 Conversation 的唯一入口。
- 首页可以选择一个已有 Space，也可以使用“从 Workspace 开始”的快捷入口。快捷入口创建一个只引用该 Workspace 的新 Space，再创建 Conversation；不得让 Conversation 同时拥有 Space owner 和 Workspace owner 两套归属。
- Conversation 创建后进入独立对话面。后续只能从历史/侧栏打开它，不能在对话中切换 Space 或 Workspace。
- 首页不承担历史对话的运行事实，只调用 Ordinary 的 command/query facade。
- Multi-Agent 不属于当前产品入口；相关源码是延期材料，不能被本功能重新装配。

### 2.2 核心关系

```text
Workspace       用户拥有的真实外部文件夹
Space           AgentArbor 维护的语义容器
SpaceReference  Space 对外部 Workspace 或软件资产的一条引用
Conversation    固定归属一个 Space
Run             一条用户消息对应的一次执行，拥有当时的资源快照
Process         AgentArbor 维护的后台进程事实
```

Space 引用 Workspace，不拥有 Workspace。一个 Space 可以引用多个 Workspace，一个 Workspace 也可以被多个 Space 引用。Space 删除不得物理删除外部 Workspace；Space 自己维护的目录、Conversation、Run 和其他软件资产则按删除契约处理。

### 2.3 数据所有权

| 对象 | 事实所有者 | Space 删除时 | 取消引用时 |
| --- | --- | --- | --- |
| 外部 Workspace 文件夹 | 用户文件系统 | 保留 | 保留 |
| Space 元数据和引用 | Space feature | 删除 | 删除该引用 |
| Conversation/Run | Ordinary feature，owner 为 Space | 删除 | 保留 |
| 工具事实、历史回答、路径快照 | Ordinary feature/证据存储 | 随 Conversation 删除 | 保留 |
| Space 管理目录 | Space/Host | 删除 | 不适用 |
| 后台进程记录和日志 | Host 进程管理能力 | 收口后删除或按删除审计保留 | 保留，但标记权限已撤销 |

“取消引用”永远不是数据清理命令。它只改变以后能否读取或写入该 Workspace；已经写入软件资产的消息、工具结果、日志、路径事实和派生数据继续保留。

## 3. 领域对象与存储契约

### 3.1 SpaceReference

现有 `SpaceReference` 联合类型可以继续承载 `workspace_folder`、`managed_folder`、`local_file` 等种类，但 Workspace 引用必须具备以下语义字段：

```ts
type WorkspaceReferenceItem = {
  id: string;                 // 内部稳定身份，只给后端、审计和持久化使用
  spaceId: string;
  kind: "workspace_folder";
  title: string;
  absolutePath: string;       // 用户和模型可见的规范绝对路径
  normalizedPath: string;     // 平台比较用，不替代 absolutePath
  status: "available" | "unavailable" | "removed";
  createdAt: string;
  updatedAt: string;
  unavailableAt?: string;
  removedAt?: string;
};
```

`id` 不能暴露成模型操作入口。模型应看见可读标题和实际路径；后端在执行前将路径解析到本轮有效的 `id`，并把 `id` 写入工具事实。这样既不隐藏模型所需的路径，又避免历史事实依赖脆弱的字符串。

`managed_folder` 是 AgentArbor 自己维护的目录，拥有权和删除权与外部 Workspace 不同。两者不能用一个“workspace”字段混淆。Space 的系统目录必须有明确的 root，并且不能被用户选择器当作外部 Workspace 再次引用。

### 3.2 Conversation 与 Run

- `SpaceConversationOwner` 是 Conversation 到 Space 的唯一归属链接。
- Conversation 创建后 owner 不可切换。移动 Conversation 等同于新建 Conversation 并由用户显式迁移内容，不提供隐式改绑。
- Run 创建时读取 Space 的当前引用集合、当前权限模式、模型能力和工具 catalog，生成 `resourceSnapshot`。
- 新增 Workspace 只影响之后创建的 Run，不追溯扩张正在运行或历史 Run 的资源集合。
- 取消引用是硬撤销：执行器在每次文件工具调用前检查当前引用状态。即使旧 Run 的快照包含该引用，已撤销引用也必须拒绝新的文件访问。撤销不是对快照的重写，而是快照之上的单调 deny overlay。
- 已经完成的调用不回滚；正在执行的调用由 ToolCenter 按取消/结果未知契约收口，不能伪造为成功。

### 3.3 资源快照

Run 的资源快照至少包含：

```ts
type RunResourceSnapshot = {
  spaceId: string;
  references: readonly {
    referenceId: string;
    title: string;
    absolutePath: string;
    permission: "read" | "read_write";
  }[];
  shellMode: "confirm_each" | "full_access";
  capturedAt: string;
};
```

快照是模型上下文和审计的出生事实，不是永久授权。有效权限计算为：`runSnapshot` 允许集合，减去当前已经撤销或删除的引用。新增引用不能注入旧 Run；撤销引用可以立即阻止旧 Run 的后续调用。

## 4. 路径语义

### 4.1 模型可见路径与内部身份分层

系统提示词或资源清单必须向模型提供真实路径：

```text
当前 Space：AgentArbor 开发

可用资源：
1. AgentArbor 项目
   绝对路径：Z:\Projects\AgentArbor
   权限：可读写
```

模型可以直接生成：

```json
{ "path": "Z:\\Projects\\AgentArbor\\src\\App.tsx" }
```

后端仍保留 `referenceId`，用于权限检查、路径历史、工具事实、进程绑定和重新添加后的身份隔离。不得把 opaque ID 伪装成文件路径，也不得让模型只能凭 ID 猜测资源。

### 4.2 规范化与解析

路径解析由一个中性 Host path resolver 提供，所有文件工具和后台进程复用同一实现：

1. 解析为绝对路径，统一分隔符，去除非根路径末尾分隔符。
2. Windows 比较使用不区分大小写的规范形式；Unix 保留大小写语义。
3. 目标存在时使用 `realpath` 检查 symlink/junction 的真实目标；目标不存在时保留规范化的词法路径并返回 `unavailable` 或 `path_not_found`。
4. 检查目标是否为引用根本身或其后代；拒绝 `..` 逃逸、符号链接逃逸和跨盘符逃逸。
5. 同一 Space 内的外部 Workspace 引用不能互为父子，也不能重复引用同一规范路径。跨 Space 的重叠引用允许，因为引用不转移所有权。
6. 文件工具输入允许真实绝对路径；兼容期可以接受内部 `referenceId + relativePath`，但该形式不能继续作为模型唯一契约。

路径匹配不依赖模糊搜索。若多个有效根仍然同时匹配，执行器必须拒绝并返回 `workspace_mount_conflict`，不能自行猜测。

### 4.3 路径变化与缺失

状态必须区分：

| 状态 | 含义 | 用户动作 |
| --- | --- | --- |
| `available` | 路径存在且类型正确 | 正常使用 |
| `unavailable` | 暂时找不到或无权访问 | 只显示提醒和“确认移除” |
| `relocated` | 用户确认目标已移动 | 通过显式重新定位更新路径并生成新引用身份 |
| `removed` | 引用已被用户确认移除 | 从当前资源树消失，只能重新添加 |
| `deleted` | 引用记录按 Space 删除流程清理 | 不提供恢复命令 |

缺失路径不能静默改绑到同名目录，不能根据父目录或最近路径自动恢复。用户确认移除后，引用从当前 Space 资源树中删除，表现为“这个工作区不再存在”；历史 Conversation、Run、路径快照、工具事实和软件资产仍不因这次移除而清理。再次添加同一路径生成新的 `referenceId`，旧 Conversation 不自动获得新路径权限。

## 5. Space 生命周期

### 5.1 创建与添加引用

创建 Space 只创建软件元数据，不自动创建外部 Workspace。添加 Workspace 必须经过系统文件夹选择器或等价的 Host 选择接口，不接受模型任意传入路径来扩张 Space 权限。

添加前必须完成：

- 路径存在、确实是文件夹、可被 Host 访问。
- 与当前 Space 的现有 Workspace 没有重复或父子重叠。
- 不把 Space 的 managed folder 当作外部 Workspace。
- 写入引用元数据、规范路径和首次可见状态。
- 发布 `space.reference_added`，但不修改现有 Conversation 的 owner。

### 5.2 取消引用

取消引用是 `unlinkReference` 语义：

1. 先将引用标记为撤销，阻止新的文件工具访问。
2. 对绑定该引用的活跃后台进程发出停止请求；不能停止时记录 `permission_revoked_stop_pending` 并向 UI 提醒。
3. 写入 `space.reference_removed` 和权限撤销事实。
4. 保留 Conversation、Run、工具证据、日志、派生数据和外部文件。

取消引用不能调用物理文件删除流程。`removeReference` 之类的破坏性命令只允许作用于 AgentArbor 明确拥有的 `managed_folder`，且必须经过独立确认。

### 5.3 删除 Space

Space 删除是高影响级联操作，必须由 Space feature 和 Ordinary feature 协作完成，不能由 Panel route 直接删除文件：

1. Space 进入 `deleting`，停止接受新 Conversation/Run。
2. 查询并请求停止属于该 Space 的活跃后台进程，等待有限时限。
3. 删除该 Space 所有 Conversation、Run、工具证据、普通日志和 Space 元数据；Conversation 不迁移到其他 Space。
4. 删除 Space 自己拥有的 managed folder 和其他软件资产。
5. 删除外部 Workspace 的引用元数据，但绝不删除外部 Workspace 文件夹。
6. 删除成功后发布 `space.deleted`；失败则保留删除 journal 和可见 `space_deletion_failed`，不能把部分删除伪装成完成。

删除失败可重试，但不得自动恢复已删除的 Conversation。启动时必须先完成 journal reconciliation，再接受新请求。

## 6. 首页与对话创建流程

推荐的唯一创建流程：

```text
首页
  -> 选择已有 Space 或“从 Workspace 开始”
  -> 创建 Conversation（绑定一个 Space）
  -> 创建首个 Run
  -> 进入独立对话面
```

对话面可以展示当前 Space 的资源清单、可用/缺失状态和引用管理入口，但不能提供切换 Space 或切换 Workspace 的运行中下拉框。用户若要使用另一个 Space，应返回首页创建或打开另一个 Conversation。

首页快捷选择 Workspace 的行为必须可追溯：创建一个新的 Space、添加一个 Workspace 引用、创建一个 Conversation。不能在 API 中保留“无 Space 的临时 Conversation”作为第二种 owner 模型。

## 7. 文件工具契约

### 7.1 普通模式

普通模式下，文件工具只能访问当前 Space 已引用且在 Run 资源快照中的 Workspace、当前仍未撤销的引用，以及 Space 允许的 managed folder。工具输入使用模型可见路径，后端解析为内部引用后再执行。

必须拒绝：

- 不属于当前 Space 的路径。
- 已撤销、已删除或 `unavailable` 的引用。
- 路径规范化后越过引用根的目标。
- symlink/junction 指向边界外的目标。
- 同一 Space 父子引用冲突导致无法唯一解析的目标。

### 7.2 完全访问模式

`full_access` 是一个明确的 Run 级权限模式，同时改变两件事：

- Shell 不再逐条等待用户确认。
- 文件工具不再受 Workspace 引用路径集合限制，可以处理模型给出的真实路径。

完全访问仍必须经过 ToolCenter、schema 校验、取消传播、执行事实和错误归一化。它不允许绕过工具注册、审计或运行终态，也不把权限自动写回 Space。模式在 Run 创建时冻结，只影响新 Run；Space 删除/撤销仍是硬 deny，不能因为 full access 继续访问已被用户移除的 Workspace。

### 7.3 工具事实

每次文件操作至少记录：`runId`、`conversationId`、`spaceId`、`referenceId`（若可解析）、原始模型路径、规范化路径、操作类型、确认模式、开始/结束时间、结果状态和错误码。工具结果不得被摘要或脱敏链路替代；UI 摘要只能是附加投影。

## 8. Shell 契约

### 8.1 普通模式：每次确认

普通模式不建设当前阶段的 OS 级沙盒，Shell 的安全边界是用户确认。每次命令执行前，ToolCenter 必须生成确认事实并展示：

- 完整命令行。
- 实际工作目录 `cwd`。
- 当前 Conversation、Space 和权限模式。
- 是否会启动后台进程、等待端口或写入文件的可见提示。

用户拒绝只拒绝这一次调用，形成标准工具失败结果并交回模型判断；不能把拒绝误报为整个 Run 取消，也不能在拒绝后继续执行同一副作用。

Shell 可以执行命令本身能访问的路径，这是“确认授权”而不是文件工具沙盒。产品必须在 UI 文案中明确这一点，避免用户误以为普通模式能阻止命令读取其他目录。

### 8.2 完全访问模式

完全访问模式跳过逐命令确认，但仍须记录命令、cwd、退出码、stdout/stderr、日志引用、超时、取消和进程状态。模式只对新 Run 生效；设置变化不能改写已启动 Run 的授权事实。

### 8.3 CWD 与路径展示

模型上下文必须包含每个资源的实际绝对路径。Shell 工具的 `cwd` 接受绝对路径，并在后端解析、记录和展示规范绝对路径。兼容旧的 `workspaceRoot + relativeCwd` 输入时，必须在 adapter 层转换，不能让两套路径事实进入 ToolCenter。

## 9. 后台进程

后台进程是软件维护的运行事实，不是一次 Shell 返回文本。进程记录至少包括：

```ts
type ManagedProcessRecord = {
  processId: string;
  spaceId?: string;
  referenceId?: string;
  conversationId?: string;
  runId?: string;
  commandLine: string;
  cwd: string;
  authorizationMode: "confirm_each" | "full_access";
  permissionState: "active" | "revoked" | "stop_pending" | "stopped";
  status: "running" | "exited" | "failed";
  logRef?: string;
  startedAt: string;
  endedAt?: string;
};
```

现有进程注册、前后台 Shell、停止、日志、端口等待和进程树终止能力继续由 Host 进程能力拥有；不要在 Space 或 Ordinary 内复制第二套进程管理器。

取消 Workspace 引用时，关联进程必须进入 revoke/stop 流程：不允许新工具继续向该进程发送命令，先请求停止；停止失败保持可见的 `stop_pending`，不能静默让它看起来仍拥有有效 Workspace 权限。进程日志和退出事实继续保留。

删除 Space 时，必须先停止或明确记录无法停止的进程。Host 负责释放自己创建的句柄，Space/Ordinary 只保存业务关联和结果，不直接调用操作系统进程 API。

## 10. Feature ownership 与接线

```text
Workbench Shell
  -> Ordinary facade
     -> Space query/command facade
     -> ToolCenter
        -> Path resolver
        -> File tools
        -> Shell/process adapter
     -> Ordinary repository/read-model
```

- Space feature 拥有 Space、引用、引用状态和 Space 事件；不得拥有 Conversation/Run 状态。
- Ordinary feature 拥有 Conversation、Run、完成语义、工具事实和对话删除；不得读取 Space store 内部结构，只调用公开 query/command。
- ToolCenter 拥有工具定义、冻结执行授权、确认和唯一执行事实；不得从 UI 或路径字符串推导 Space 业务状态。
- Host/Composition Root 创建并释放 Path resolver、进程管理器、ToolCenter、Space feature 和 Ordinary feature。
- Panel route 只做协议映射，不直接修改 Space snapshot、进程 map 或 Ordinary repository。
- Pi 继续负责模型-工具循环、Session 和 provider 机械能力；Space/Workspace 权限是 AgentArbor 业务事实，必须在 Pi AgentTool 进入 ToolCenter 前后由宿主处理。

### 10.1 现有代码落点与迁移差异

当前实现的主要落点如下，后续修改应保持这些 ownership，不要通过新建平行服务绕开它们：

- `src/app/spaces/contracts.ts`：Space、引用、Space command/query/event 的公开契约。
- `src/app/spaces/space-feature.ts`：Space 元数据、引用生命周期和删除 journal。
- `src/app/spaces/space-tools.ts`：模型可见的 Space 管理和文件写入工具贡献。
- `src/app/panel-server/space-agent-access.ts`：Conversation/Space 访问解析和本轮资源装配。
- `src/app/tool-center/tool-center.ts`：冻结工具边界、确认、执行事实和动态授权检查。
- `src/app/tool-center/adapters/local-workspace-sandbox.ts`：应用层路径/大小/命令策略；它不是 OS 级沙盒。
- `src/app/tool-center/adapters/local-workspace-command-tools.ts`：前后台 Shell、日志、端口等待和进程树终止。

迁移期间必须明确以下差异：当前 `SpaceWrite`/`SpaceEdit` 主要接受 `referenceId + relativePath`，目标契约改为模型可见绝对路径并在后端解析到内部身份；当前 Task Soil 快照规则不能阻止撤销后的活动 Run 继续访问，必须增加即时 deny overlay；当前 Space 删除和 Ordinary Conversation 级联清理若未完全接线，不能在 UI 中声称已经完成；当前 Shell 的应用层策略不能宣传成强制沙盒。

## 11. 建议状态与错误码

状态/错误码应保持少而稳定，至少覆盖：

| 代码 | 触发条件 |
| --- | --- |
| `space_not_found` | Space 不存在 |
| `conversation_space_immutable` | 尝试切换 Conversation owner |
| `workspace_mount_conflict` | 重复或父子 Workspace 引用 |
| `workspace_unavailable` | 引用路径当前不可用 |
| `workspace_reference_removed` | 引用已被确认移除 |
| `workspace_path_outside_reference` | 文件路径不在授权引用内 |
| `workspace_path_relocated_requires_confirmation` | 路径变化需要用户显式重新定位 |
| `shell_confirmation_required` | 普通模式尚未取得本次命令确认 |
| `shell_confirmation_denied` | 用户拒绝本次命令 |
| `full_access_not_enabled` | 需要完全访问但 Run 未启用 |
| `permission_revoked` | 引用已撤销，阻止后续访问 |
| `background_process_stop_pending` | 进程停止请求尚未完成 |
| `space_deletion_in_progress` | 删除期间拒绝新工作 |
| `space_deletion_failed` | 删除 journal 收口失败 |

错误必须保留原始工具/系统错误上下文，不能只返回泛化的“无权限”。

## 12. 实施顺序

### 阶段一：事实源与类型

1. 在 Space contracts 中补齐 Workspace 引用状态、规范路径和引用生命周期事件。
2. 固化 `SpaceConversationOwner` 唯一约束和 Conversation 删除 facade。
3. 定义 Run `resourceSnapshot` 与当前撤销 deny overlay 的查询端口。
4. 为旧 `workspaceRoot + relativeCwd`、`referenceId + relativePath` 标记兼容边界和迁移测试。

### 阶段二：路径解析与引用规则

1. 提取唯一 Path resolver，供文件工具、Shell cwd 和进程绑定使用。
2. 实现重复/父子 Workspace 检测、realpath 检查和缺失状态对账。
3. 实现“缺失提醒 -> 用户确认移除 -> 当前资源树删除 -> 可重新添加”的命令链。
4. 确认同一路径重新添加产生新身份且不恢复旧 Conversation 权限。

### 阶段三：Ordinary 与文件工具

1. 首页创建流程统一先确定 Space，再创建 Conversation。
2. Run 创建时生成资源清单并注入真实绝对路径。
3. 文件工具改为路径输入为主，执行前解析到当前有效引用；保留内部 `referenceId` 事实。
4. 每次执行前做撤销 deny overlay，确保 Space 中途移除 Workspace 后不能继续读取。

### 阶段四：Shell 与完全访问

1. 统一 Shell 通过 ToolCenter 进入，确认事实和执行事实分离。
2. 普通模式固定 `requiresConfirmation: true`，确认 UI 展示命令和 cwd。
3. 新增 Run 级 `full_access` 快照，同时覆盖 Shell 确认和文件路径限制。
4. 验证 full access 不绕过 ToolCenter、审计、取消和 Space 删除/撤销 deny。

### 阶段五：后台进程和删除收口

1. 在现有进程注册事实中加入 Space/reference/conversation/run 关联和授权状态。
2. 引用撤销触发停止请求、状态变更和失败提醒。
3. Space 删除先停止进程、停止新 Run、清理 Conversation/Run/软件资产，再移除引用元数据。
4. 启动 reconciliation 处理未完成 journal、迟到退出和日志收口。

### 阶段六：旧实现退役

1. 删除模型只能使用 opaque `referenceId` 的正式描述和测试。
2. 删除 route 直接操作 Space/进程内部状态的旁路。
3. 更新 `CURRENT_RUNTIME_MODE.md`、Space 访问 adapter 和相关架构索引。
4. 迁移完成后，不保留双重 Conversation owner、双重 Path resolver 或双重 Shell 执行器。

## 13. 测试与验收矩阵

### 13.1 Space 与路径

- Space 可引用多个 Workspace，Workspace 可被多个 Space 引用。
- 同一 Space 重复、父子和规范化后相同的 Workspace 均被拒绝。
- 跨 Space 重叠引用不互相删除或转移。
- 缺失路径进入 `unavailable`，不能自动改绑；确认后从资源树消失。
- 同路径重新添加产生新 `referenceId`，旧 Conversation 不能读取新引用。
- symlink/junction、`..`、大小写和 UNC 路径按平台规则正确处理。

### 13.2 Conversation 与 Run

- 首页创建的 Conversation 必须且只能绑定一个 Space。
- 对话面不存在切换 Space/Workspace 的运行命令。
- 新增引用只进入新 Run；撤销引用立即拒绝活动 Run 的后续文件调用。
- Conversation 历史只从其 owner Space 查询；Space 删除级联清理 Conversation/Run。
- 取消引用保留历史消息、工具结果、路径快照和日志。

### 13.3 文件工具与 Shell

- 普通文件工具只能访问当前有效引用，路径越界和撤销引用明确失败。
- 模型收到真实绝对路径，工具事实同时保留原始路径和内部 referenceId。
- 普通 Shell 每次命令都产生确认请求；拒绝后不执行，Run 可以继续。
- full access 同时解除 Shell 逐条确认和文件工具路径限制，但仍经过 ToolCenter 和审计。
- full access、Space 删除和引用撤销的优先级明确，撤销不能被 full access 绕过。

### 13.4 进程与删除

- 前台/后台 Shell、端口等待、日志、退出和进程树终止都写入受管进程事实。
- 取消引用会停止或标记关联进程，停止失败对用户可见。
- Space 删除不会删除外部 Workspace；删除失败可重试且不伪造成功。
- 重启后 journal、进程退出和日志状态能对账，不重复执行命令或删除副作用。

## 14. 非目标

当前指南不扩大范围到：

- OS 级强制沙盒或容器化执行。普通 Shell 的边界是逐条用户确认；是否建设 OS 沙盒另立 ADR。
- MCP、其他工具入口、远端资源和隐私脱敏策略。
- 自动路径迁移、同名目录猜测、历史权限恢复。
- 多 Space 合并、Conversation 跨 Space 迁移和新的全局工作流引擎。
- 把派生数据权限清理成“取消引用即删除”。

## 15. 维护规则

当默认入口、Space owner、路径输入、Shell 确认模式、完全访问范围、引用删除或后台进程生命周期发生变化时，必须先更新 ADR，再更新本指南和 `CURRENT_RUNTIME_MODE.md`，最后修改代码。任何只改 UI 文案而不更新执行契约的做法都视为不完整变更。
