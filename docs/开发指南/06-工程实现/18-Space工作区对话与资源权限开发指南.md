# Space、Workspace、Conversation 与资源权限开发指南

## 1. 文档定位

本指南把 Space、Workspace、Conversation、Run、文件工具、Shell 和受管后台进程的稳定语义转化为工程契约。它适用于当前生产主线 Ordinary Agent，不为已延期的 Multi-Agent 重新建立入口、状态或运行时。

长期取舍见 [ADR-0034-Space工作区引用与对话资源生命周期](../../架构设计/产品架构/ADR-0034-Space工作区引用与对话资源生命周期.md) 与 [ADR-0035-Conversation双资源owner与统一运行作用域](../../架构设计/产品架构/ADR-0035-Conversation双资源owner与统一运行作用域.md)。Conversation owner 语义（Space 或 Workspace、创建后冻结、统一 Run 作用域、WorkspaceFeature 与三层身份）以 ADR-0035 为准；ADR-0034 的 Pi、工具事实、Shell 确认、知识副本和后台进程机械边界继续有效。本指南负责实现细节、边界条件、迁移顺序和验收标准。代码、测试和 Panel adapter 必须以本指南为准；旧文档中仅把 `workspaceRoot` 当作唯一资源事实、允许对话切换工作区或把 Conversation 强制绑定 Space 的表述均视为待迁移口径。

## 2. 稳定结论

### 2.1 产品入口

- 首页是创建新 Conversation 的唯一入口。
- 首页选择 Conversation owner：已有 Space 或已注册 Workspace，二者必选其一。创建 Space、注册 Workspace 和添加 Space-Workspace 引用属于资源管理操作，由 Space/Workspace 管理入口完成。
- Conversation 创建后 owner 冻结，进入独立对话面。后续只能从历史/侧栏打开它，不能在对话中切换 Space 或 Workspace。
- 首页承载跨 owner 的"最近对话"视图，按 owner 分组展示；它不是侧边栏主列表。
- 首页不承担历史对话的运行事实，只调用 Ordinary 的 command/query facade。
- Multi-Agent 不属于当前产品入口；相关源码是延期材料，不能被本功能重新装配。

### 2.2 核心关系

```text
Workspace       用户拥有的真实外部文件夹，含软件登记身份（workspaceId + mount）
Space           AgentArbor 维护的语义容器，拥有 managedRoot 软件自有目录
SpaceReference  Space 对外部 Workspace（linkId）或软件资产的一条引用
Conversation    固定归属一个 owner（Space 或 Workspace），创建后不可切换
Run             一条用户消息对应的一次执行，拥有当时的统一运行作用域快照
Process         AgentArbor 维护的后台进程事实
```

Space 是 AgentArbor 的内部语义容器。它拥有自己维护的 managedRoot（软件自有目录）、笔记、生成产物、Conversation、Run、工具事实和其他软件资产；这些资产在删除 Space 时一并清理。Workspace 是用户文件系统中的真实文件夹及其软件登记身份；一个 Space 可以引用多个 Workspace（linkId），一个 Workspace 也可以被多个 Space 独立引用。删除 Space 只删除当前 Space 的引用记录，不删除外部 Workspace；Workspace 被 Space 引用不会让该 Workspace 的直属 Conversation 归入 Space。Conversation owner 与 Space-Workspace link 是两种不同关系：Conversation 只能持有一个 owner（Space 或 Workspace），创建后不可切换，也不能同时拥有双 owner。

### 2.3 数据所有权

| 对象 | 事实所有者 | owner 删除时 | 取消引用时 |
| --- | --- | --- | --- |
| 外部 Workspace 文件夹 | 用户文件系统 | 保留 | 保留 |
| Space 元数据、managedRoot 和引用 | Space feature | 删除 | 删除该引用 |
| Workspace 元数据和 mount | Workspace feature | 删除 | mount 失效 |
| Conversation/Run | Ordinary feature，owner 为 Space 或 Workspace | 随 owner 级联删除 | 保留 |
| 工具事实、历史回答、路径快照 | Ordinary feature/证据存储 | 随 Conversation 删除 | 保留 |
| Space 软件资产（managedRoot 内容、生成产物等） | Space/Host | 删除 | 按资产命令处理 |
| 后台进程记录和日志 | Host 进程管理能力 | 按 owner 收口后删除或按删除审计保留 | 保留，但标记权限已撤销 |

“取消引用”永远不是数据清理命令。它只改变以后能否读取或写入该 Workspace；已经写入软件资产的消息、工具结果、日志、路径事实和派生数据继续保留。

## 3. 领域对象与存储契约

### 3.1 SpaceReference

现有 `SpaceReference` 联合类型可以继续承载 Workspace 引用和软件资产，但两类对象的权限、操作与删除策略必须分开。Workspace 引用至少具备以下语义字段：

```ts
type WorkspaceReferenceItem = {
  id: string;                 // 内部稳定身份，只给后端、审计和持久化使用
  spaceId: string;
  title: string;
  reference: {
    kind: "workspace_folder";
    path: string;             // 用户和模型可见的真实绝对路径
  };
  sourceIdentity: string;     // 后端文件系统身份，不进入模型正文
  createdAt: string;
  updatedAt: string;
};
```

`id` 不能暴露成模型操作入口。模型应看见可读标题和实际路径；后端在执行前将路径解析到本轮有效的 `id`，并把 `id` 写入工具事实。这样既不隐藏模型所需的路径，又避免历史事实依赖脆弱的字符串。

`managed_folder` 是 AgentArbor 自己维护的目录，拥有权和删除权与外部 Workspace 不同。两者不能用一个“workspace”字段混淆。Space 的系统目录必须有明确的 root，并且不能被用户选择器当作外部 Workspace 再次引用。ADR-0035 将 Space 软件自有目录收敛为每个 Space 的 `managedRoot`（`AgentArborData/spaces/<spaceId>/files/`）；现有 `managed_folder` 引用保留兼容展示，不再新建。

### 3.1.1 Workspace 三层身份

Workspace 引用必须区分三层身份（ADR-0035 §4.1）：

```ts
workspaceId: string;    // Workspace 的长期逻辑身份
mountVersion: string;   // 某次真实目录绑定的版本，重新连接时生成新版本
linkId: string;         // 某个 Space 对 Workspace 的一次引用关系
```

- 同一路径先取消引用再重新引用，必须产生新的 `linkId`。
- 目录删除后在原位置重建，来源身份变化，不能复用旧 `mountVersion` 或旧权限。
- 注册 Workspace 前必须由系统文件夹选择器或等价 Host 接口获得用户选择，对规范化路径、realpath、大小写、junction 和 symlink 做唯一性检查，拒绝重复目录和父子嵌套目录。
- 模型不能任意传入一个绝对路径就创建持久化 Workspace；这会把结构化工具变成权限升级通道。
- 重新连接到不同文件系统对象时创建新 Workspace，不替换旧 mount；旧 Conversation 不得静默操作陌生目录。

### 3.2 Conversation 与 Run

- `ConversationOwner` 是 Conversation 的唯一归属事实，为判别联合：`{ kind: "space"; id }` 或 `{ kind: "workspace"; id }`。owner 由 Ordinary Conversation 保存为 canonical fact，Space store 不再保存第二份 owner link。
- Conversation 创建时必选且只能选一个 owner；创建后 owner 不可切换。移动 Conversation 等同于新建 Conversation 并由用户显式迁移内容，不提供隐式改绑。
- Run 创建前由 Host 根据 Conversation owner 解析并冻结统一运行作用域（cwd、managedRoot、workspaceGrants、attachmentGrants、confirmationPolicy），生成 `ConversationExecutionScope`；同一份 scope 被 Pi 执行环境、文件工具、Shell、Notes、Skills、Sub-Agent roots、后台进程和 Panel 投影一致消费，任何模块不得重新从全局配置猜测 cwd 或 owner。
- 新增 Workspace link 只影响之后创建的 Run，不追溯扩张正在运行或历史 Run 的资源集合。
- 取消引用是硬撤销：执行器在每次文件工具调用前检查当前引用状态。即使旧 Run 的快照包含该引用，已撤销引用也必须拒绝新的文件访问。撤销不是对快照的重写，而是快照之上的单调 deny overlay。
- 已经完成的调用不回滚；正在执行的调用由 ToolCenter 按取消/结果未知契约收口，不能伪造为成功。

### 3.3 资源快照

Run 的资源快照至少包含：

```ts
type RunResourceSnapshot = {
  owner: { kind: "space" | "workspace"; id: string; title: string };
  cwd: string;                    // Workspace: mount 根目录；Space: managedRoot
  managedRoot?: string;
  workspaceGrants: readonly {
    workspaceId: string;
    linkId?: string;
    mountVersion: string;
    rootPath: string;
    sourceIdentity: string;
  }[];
  shellMode: "confirm_each" | "full_access";
  capturedAt: string;
};
```

快照是模型上下文和审计的出生事实，不是永久授权。有效权限计算为：`runSnapshot` 允许集合，加上本轮明确选择的附件，减去当前已经撤销或删除的 grant。新增引用不能注入旧 Run；撤销引用可以立即阻止旧 Run 的后续调用。

## 4. 路径语义

### 4.1 模型可见路径与内部身份分层

系统提示词或资源清单必须向模型提供真实路径与 owner 区块：

```text
[Current conversation owner]
kind=space
name=产品规划
managed_root=C:\...\spaces\<spaceId>\files

[Authorized workspaces]
name=AgentArbor
path=Z:\AgentArbor
```

即使 Space 没有任何外部引用，也必须注入 owner 和 managedRoot。Space owner 的引用列表至少包含名称（可改名的 title）、路径和状态；不建设用户维护的别名/说明字段，模型按名称或简称映射到真实绝对路径（见 ADR-0035 §6.2）。工具入参只使用真实绝对路径；`workspaceId / linkId / mountVersion` 由后端从 Run snapshot 解析后附加到执行事实，绝不作为模型参数暴露。

### 4.2 规范化与解析

路径解析由一个中性 Host path resolver 提供，所有文件工具和后台进程复用同一实现：

1. 解析为绝对路径，统一分隔符，去除非根路径末尾分隔符。
2. Windows 比较使用不区分大小写的规范形式；Unix 保留大小写语义。
3. 添加外部引用时目标必须存在，并捕获平台文件身份（当前 Node 实现使用 `stat.dev + stat.ino`）；访问已有引用时同时使用 `realpath` 和来源身份检查 symlink/junction 的真实目标。引用根不存在、类型变化或同一路径已经换成另一对象时，移除当前 Space 的外部引用并明确失败，不保留可恢复的树节点。
4. 检查目标是否为引用根本身或其后代；拒绝 `..` 逃逸、符号链接逃逸和跨盘符逃逸。
5. 同一 Space 内的外部 Workspace 引用不能互为父子，也不能重复引用同一规范路径。跨 Space 的重叠引用允许，因为引用不转移所有权。
6. 文件工具输入使用真实绝对路径；`referenceId` 与相对路径只作为后端权限、continuation 和审计事实，不是模型文件协议。

路径匹配不依赖模糊搜索。若多个有效根仍然同时匹配，执行器必须拒绝并返回 `workspace_mount_conflict`，不能自行猜测。

### 4.3 路径变化与缺失

外部 Workspace 引用只有有效和已删除两种产品状态：

| 状态 | 含义 | 用户动作 |
| --- | --- | --- |
| `available` | 路径存在且类型正确 | 正常使用 |
| `removed` | 引用记录已从当前 Space 删除 | 只能重新添加 |
| `deleted` | 引用记录按 Space 删除流程清理 | 不提供恢复命令 |

缺失路径不能静默改绑到同名目录，不能根据父目录或最近路径自动恢复。即使新目录立即出现在同一路径，来源身份不符也视为原引用失效。探测到 Workspace 消失、类型改变或来源身份不一致后：使当前 mount 失效、撤销所有依赖该 mount 的 Space link、阻止活动 Run 的后续文件访问并收口关联后台进程；Workspace 逻辑对象、Conversation、Run、工具事实和历史回答保留，UI 显示 Workspace 需要重新连接。重新选择目录是显式操作：来源身份可证明是同一对象时走重新连接流程生成新 mountVersion；不同文件系统对象则创建新 Workspace，不替换旧 mount。Space link 不自动恢复，用户需要重新引用并获得新的 linkId。

探测必须发生在真实访问边界：用户打开/预览引用、读取或修改引用内容、附件工具或视觉附件交付，以及标准文件工具解析目标路径时检查引用根。所有入口复用 Run-scoped 授权和同一来源身份事实。Space 列表、Space 树查询、应用启动和 Run 结束都不扫描外部 Workspace；否则大量离线磁盘、网络盘和临时挂载会把后台轮询变成第二套生命周期 owner。子文件缺失而引用根仍存在时，只返回子文件缺失，不能删除整个 Workspace 引用。

## 5. Space 生命周期

### 5.1 创建与添加引用

创建 Space 只创建软件元数据，不自动创建外部 Workspace。添加 Workspace 必须经过系统文件夹选择器或等价的 Host 选择接口，不接受模型任意传入路径来扩张 Space 权限。

添加前必须完成：

- 路径存在、确实是文件夹、可被 Host 访问。
- 捕获文件系统来源身份；捕获失败时不创建无身份的外部引用。
- 与当前 Space 的现有 Workspace 没有重复或父子重叠。
- 不把 Space 的 managed folder 当作外部 Workspace。
- 写入引用元数据、规范路径和首次可见状态。
- 发布 `space.reference_added`，但不修改现有 Conversation 的 owner。结构化添加工具默认执行，不额外弹确认；用户明确删除 Space 或软件资产时才进入删除确认。

Workspace 引用没有“移动到另一个 Space”的操作。要让另一个 Space 使用同一文件夹，直接在目标 Space 新增一条独立引用；源 Space 的引用和权限不受影响。只有 Space 自己维护的软件资产允许移动，移动表示软件资产所有权改变。

### 5.2 取消引用

取消外部引用是 `unlinkReference` 语义：

1. 先将引用标记为撤销，阻止新的文件工具访问。
2. 对绑定该引用的活跃后台进程发出停止请求；不能停止时记录 `permission_revoked_stop_pending` 并向 UI 提醒。
3. 写入 `space.reference_removed` 和权限撤销事实。
4. 保留 Conversation、Run、工具证据、日志、派生数据和外部文件。

取消外部引用不能调用物理文件删除流程。`removeReference` 之类的破坏性命令只允许作用于 AgentArbor 明确拥有的软件资产（例如 `managed_folder`），且必须经过独立确认。Conversation 没有取消引用命令，只能通过 Ordinary 删除流程删除；其 owner 不能移动或解绑。

### 5.3 删除 Space

Space 删除是高影响级联操作，必须由 Space feature 和 Ordinary feature 协作完成，不能由 Panel route 直接删除文件：

1. Space 进入 `deleting`，停止接受新 Conversation/Run。
2. 查询并请求停止属于该 Space 的活跃后台进程，等待有限时限。
3. 删除该 Space 所有 Conversation、Run、工具证据、普通日志和 Space 元数据；Conversation 不迁移到其他 Space。
4. 删除 Space 自己拥有的 managed folder 和其他软件资产。
5. 删除外部 Workspace 的引用元数据，但绝不删除外部 Workspace 文件夹。
6. 删除成功后发布 `space.deleted`；失败则保留删除 journal 和可见 `space_deletion_failed`，不能把部分删除伪装成完成。

删除失败可重试，但不得自动恢复已删除的 Conversation。启动时必须先完成 journal reconciliation，再接受新请求。

### 5.3.1 删除 Workspace

Workspace 删除是高影响级联操作，由 WorkspaceFeature、SpaceFeature 和 Ordinary feature 协作完成，不删除用户真实文件夹：

1. Workspace 进入 `deleting`，拒绝直属 Conversation 的新 Run。
2. 停止直属 Workspace 进程。
3. 删除 Workspace owner 的 Conversation、Run 和 Workspace 软件侧资产。
4. 移除所有 Space links（不删除外部文件夹）。
5. 保留用户真实文件夹和知识库独立副本。

删除流程由 Host coordinator 和 SQLite journal 协调，支持重启后恢复，不静默吞掉补偿失败。

### 5.4 知识收藏与来源关联

- 收藏 Space 中的文件或文件夹时，`PersonalKnowledgeFeature` 通过 Host 文件端口复制一份到软件维护的知识资产目录；知识页面与物理副本是 Personal Knowledge 自有资产，不再依赖源路径可读。
- `sourceReferenceId` 和 `sourceRelativePath` 只是来源关联，用于在原 Space 文件上展示已收藏状态，不表示 Space 拥有知识副本。
- 删除 Space 时，删除该 Space 自有的个人笔记、修订和关系，并清除知识副本上的来源关联；知识页面、主题关系和物理副本继续保留。
- 取消外部 Workspace 引用不能删除知识副本。只有显式取消收藏才由 Personal Knowledge 删除知识页面及其物理副本。
- 启动恢复可以对账软件自有知识目录与知识页面，这不属于外部 Workspace 扫描；两种机制不得复用为一个后台路径探测器。

## 6. 首页与对话创建流程

推荐的唯一创建流程：

```text
首页
  -> 选择 owner（已有 Space 或已注册 Workspace）
  -> 创建 Conversation（绑定该 owner）
  -> 创建首个 Run（解析统一运行作用域）
  -> 进入独立对话面
```

对话面顶部显示固定 owner（如"产品规划 · 空间"、"AgentArbor · 工作区"），Space owner 可展开查看 managedRoot 与引用资源详情；对话面不提供切换 Space 或切换 Workspace 的运行中下拉框，也不能把当前 Conversation 作为普通 Space 引用加入。用户若要使用另一个资源，应返回首页创建或打开另一个 Conversation。

首页选择 Space 或 Workspace 的行为必须可追溯；不能在 API 中保留"无 owner 的临时 Conversation"作为第二种 owner 模型。

## 7. 文件工具契约

### 7.1 普通模式

普通模式下，文件工具只能访问：

- Workspace owner 的当前有效 mount 根目录。
- Space owner 的 managedRoot。
- Space 当前有效且未撤销的 Workspace grants（linkId）。
- 用户本轮明确选择的附件。

模型使用真实绝对路径；后端解析到 `workspaceId / mountVersion / linkId / sourceIdentity` 后做授权与审计。继续复用成熟的 `Read / Glob / Grep / Write / Edit`，不注册第二套 Space 文件 API。

必须拒绝：

- 不属于当前 owner 的路径。
- 已撤销、已删除的 grant。
- 路径规范化后越过授权根的目标。
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
  ownerKind?: "space" | "workspace";
  ownerId?: string;
  spaceId?: string;
  workspaceId?: string;
  linkId?: string;
  mountVersion?: string;
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
- `src/app/workspaces/`：WorkspaceFeature（ADR-0035 阶段二新增），Workspace 元数据、mount、唯一性、连接状态和公开 query/command/event。
- `src/app/spaces/space-feature.ts`：Space 元数据、managedRoot、引用生命周期和删除 journal。
- `src/app/spaces/space-tools.ts`：只贡献模型可见的 Space 管理工具；文件读写复用标准工具。
- `src/app/spaces/space-run-path-authorization.ts`：把本轮 owner scope、冻结 grant、live deny overlay 和 `full_access` 解析为中性路径授权。
- `src/app/panel-server/space-agent-access.ts`：Conversation owner 访问解析和本轮资源装配。
- `src/app/tool-center/tool-center.ts`：冻结工具边界、确认、执行事实和动态授权检查。
- `src/app/tool-center/adapters/local-workspace-sandbox.ts`：应用层路径/大小/命令策略；它不是 OS 级沙盒。
- `src/app/tool-center/adapters/local-workspace-command-tools.ts`：前后台 Shell、日志、端口等待和进程树终止。

当前已收敛状态：模型继续使用成熟的 `Read / Glob / Grep / Write / Edit`，Host 通过中性 Run-scoped path authorization 注入 owner 权限，不再注册 `SpaceWrite / SpaceEdit` 第二套文件 API。外部 Workspace 消失或来源身份改变时使当前 mount 失效并撤销依赖它的 Space link，生产 schema 不再保存 `unavailable` 状态，Panel 也不提供恢复入口；Space 事件驱动的 live deny overlay 会立即阻止活动 Run 的后续附件读取和文件操作。标准文件工具、Attachment 工具、视觉附件交付、Space HTTP 访问和知识收藏都必须执行同一来源身份检查。受管进程显式记录 owner/link/mountVersion 和授权状态，取消引用同步撤权并异步停止；Space/Workspace 删除遇到无法确认停止的进程时返回 `background_process_stop_pending`。结构化 Space 工具除删除 Space/软件资产外默认执行，模型是创建/重命名 Space 的一等操作者；模型创建 Space 不改变当前 Conversation owner，也不授予任何外部路径权限。Workspace 注册必须经用户选择、Space-Workspace link 需确认，模型不能通过"先建 Space 再引用"绕过权限升级防线。Host 对新 Conversation 绑定和单独删除也使用 SQLite journal：恢复只收口既有 Space/Ordinary 事实，绝不重放模型或 Shell。owner 级联删除同样在监听端口前恢复。当前开发数据采用明确断代：Space 写入 `space-tree/v5`（v5 在 `SpaceReferenceItem.annotation` 中保存 Agent/用户整理内容，来源事实仍只存于 `reference`），SQLite v6 清除缺少来源身份的旧外部引用、v7 增加 `annotation_json` 列，文件仓储不读取 `space-tree/v3` 之前的版本。Shell 普通模式仍是逐命令确认，不得把应用层路径检查宣传成 OS 强制沙盒。

## 11. 建议状态与错误码

状态/错误码应保持少而稳定，至少覆盖：

| 代码 | 触发条件 |
| --- | --- |
| `space_not_found` | Space 不存在 |
| `workspace_not_found` | Workspace 不存在 |
| `conversation_owner_required` | 创建 Conversation 时未提供或提供了非法 owner |
| `conversation_owner_conflict` | Conversation 同时关联多个 owner 或 owner 与请求不一致 |
| `conversation_owner_immutable` | 尝试切换 Conversation owner |
| `workspace_duplicate_path` | 同一物理目录重复注册 |
| `workspace_mount_conflict` | 重复或父子 Workspace 注册/引用 |
| `workspace_mount_invalid` | 当前 mount 失效、路径消失或来源身份不一致 |
| `workspace_reference_removed` | 引用已被确认移除 |
| `workspace_path_outside_reference` | 文件路径不在授权根内 |
| `shell_confirmation_required` | 普通模式尚未取得本次命令确认 |
| `shell_confirmation_denied` | 用户拒绝本次命令 |
| `full_access_not_enabled` | 需要完全访问但 Run 未启用 |
| `permission_revoked` | grant 已撤销，阻止后续访问 |
| `background_process_stop_pending` | 进程停止请求尚未完成 |
| `space_deletion_in_progress` | 删除期间拒绝新工作 |
| `space_deletion_failed` | 删除 journal 收口失败 |

错误必须保留原始工具/系统错误上下文，不能只返回泛化的“无权限”。

## 12. 实施顺序

实施顺序以 [ADR-0035](../../架构设计/产品架构/ADR-0035-Conversation双资源owner与统一运行作用域.md) 第 10 节阶段一至阶段八为准，本指南补充以下工程落点：

### 阶段一：事实源与契约

1. 定义 `ConversationOwner`（判别联合）、`ConversationExecutionScope`、`WorkspaceGrant` 与 owner DTO，写入 domain 层跨 feature 契约。
2. 固化 owner 不可切换、空 Space owner 注入和撤权优先于 `full_access` 的测试。
3. 在 Space contracts 中补齐 Workspace 引用状态、规范路径和引用生命周期事件。
4. 为旧 `workspaceRoot + relativeCwd`、`referenceId + relativePath` 标记兼容边界和迁移测试。

### 阶段二：WorkspaceFeature

1. 新增 `src/app/workspaces/`：contracts、repository（SQLite 新表 `workspaces / workspace_mounts / space_workspace_links`）、commands、queries、events。
2. 实现 mountVersion、sourceIdentity、重复/父子校验和显式注册、重新连接、断连状态。
3. 将 Space 外部路径引用迁移为 workspaceId + linkId；无法证明来源身份的引用断代清除。
4. 提取唯一 Path resolver，供文件工具、Shell cwd 和进程绑定使用。

### 阶段三：Conversation owner 事实

1. Ordinary Conversation 使用判别联合保存 owner；创建 API 接受 `owner:{kind,id}`，移除"无 owner 临时 Conversation"路径。
2. 移除 Space store 中重复的 owner 事实；关联 Conversation 改为组合根 read-model。
3. 创建 Run 前通过公开 facade 校验 owner；删除 Space/Workspace 时按 owner 查询并级联。
4. 用 Host journal 处理跨 feature 删除和重启恢复。

### 阶段四：统一 Run scope

1. Run 出生前解析 owner scope（Workspace: mount 根；Space: managedRoot），冻结进 Run snapshot。
2. 同一份 scope 装配 Pi 执行环境 cwd、文件工具授权、Shell、Notes、Skills、Sub-Agent roots 和进程关联。
3. 文件工具每次执行前做撤销 deny overlay，确保中途撤销后不能继续读取。
4. Space managedRoot 落地（`AgentArborData/spaces/<spaceId>/files/`），并入现有初始化入口。

### 阶段五：Shell 与完全访问

1. 统一 Shell 通过 ToolCenter 进入，确认事实和执行事实分离，事实包含 owner 与真实绝对 cwd。
2. 普通模式固定 `requiresConfirmation: true`；`full_access` 是 Run 级冻结模式，同时覆盖 Shell 确认和文件路径限制。
3. 验证 full access 不绕过 ToolCenter、审计、取消和 owner 删除/撤销 deny。

### 阶段六：模型、工具与 Panel

1. 注入 owner 区块和引用列表（名称、路径、状态）；工具入参真实路径，授权由后端解析。不建设别名/说明字段（ADR-0035 §6.2）。
2. 模型是创建/重命名 Space 的一等操作者；Workspace 注册经用户选择，Space-Workspace link 确认一次。
3. 侧边栏按"首页/空间/工作区/知识库/设置"重构：最近对话归首页、空间不挂会话、工作区展开直属会话；对话顶部显示固定 owner。
4. 拆分前端 selection state，删除全局 activeSpaceId 的跨职责复用；实现首次引导。

### 阶段七：旧实现退役

1. 删除模型只能使用 opaque `referenceId` 的正式描述和测试。
2. 删除全局 `workspaceDirectory` 配置、旧 API 和设置 UI；运行时只接受 owner execution root，目录选择器由具体业务动作按需提供上下文。
3. 删除 route 直接操作 Space/进程内部状态的旁路。
4. 更新 `CURRENT_RUNTIME_MODE.md`、owner 访问 adapter 和相关架构索引；不保留双重 owner、双重 Path resolver 或双重 Shell 执行器。

## 13. 测试与验收矩阵

### 13.1 Space 与路径

- Space 可引用多个 Workspace，Workspace 可被多个 Space 引用。
- 同一 Space 重复、父子和规范化后相同的 Workspace 均被拒绝。
- 跨 Space 重叠引用不互相删除或转移。
- 缺失路径直接移除外部引用并从资源树消失；不能自动改绑，重新添加才获得新身份。
- Space 列表、树查询、启动和 Run 结束不扫描外部路径；打开、预览、正文操作和文件工具访问会按需发现缺失根。
- 子文件缺失但引用根仍存在时只报告文件缺失，不移除 Workspace 引用。
- 同路径重新添加产生新 `referenceId`，旧 Conversation 不能读取新引用。
- 原路径删除后立即创建同类型目录或文件，旧来源身份仍必须拒绝并移除。
- symlink/junction、`..`、大小写和 UNC 路径按平台规则正确处理。

### 13.2 Conversation 与 Run

- 首页创建的 Conversation 必须且只能绑定一个 owner（Space 或 Workspace），owner 缺失、冲突或被删除时明确失败。
- 对话面不存在切换 Space/Workspace 的运行命令，也不存在把 Conversation 加入/移出 Space 的普通引用命令。
- Space Run 的 cwd 是 managedRoot；Workspace Run 的 cwd 是当前 mount 根目录。
- Workspace 直属对话不能访问 Space managedRoot；Space 直属对话只能访问自己的 managedRoot 和有效 links。
- 新增 link 只进入新 Run；撤销 link 立即拒绝活动 Run 的后续文件调用。
- Conversation 历史只从其 owner 查询；owner 删除级联清理 Conversation/Run。
- 模型可创建 Space，创建后与其他 Space 行为一致；创建 Space 不改变当前 Conversation owner，也不授予外部路径权限。
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

### 13.5 知识收藏

- 收藏文件或文件夹会生成 Personal Knowledge 自有副本，源内容后续变化或消失不影响副本读取。
- 取消 Workspace 引用不删除知识页面或副本。
- 删除 Space 会删除该 Space 的笔记、修订和关系，只清除收藏副本的来源关联。
- 取消收藏才删除知识页面及其软件自有副本；重启对账不会把已保留副本当作孤儿清理。

## 14. 非目标

当前指南不扩大范围到：

- OS 级强制沙盒或容器化执行。普通 Shell 的边界是逐条用户确认；是否建设 OS 沙盒另立 ADR。
- MCP、其他工具入口、远端资源和隐私脱敏策略。
- 自动路径迁移、同名目录猜测、历史权限恢复。
- 多 Space 合并、Conversation 跨 Space 迁移和新的全局工作流引擎。
- 把派生数据权限清理成“取消引用即删除”。

## 15. 维护规则

当默认入口、Conversation owner、统一运行作用域、路径输入、Shell 确认模式、完全访问范围、引用删除或后台进程生命周期发生变化时，必须先更新 ADR，再更新本指南和 `CURRENT_RUNTIME_MODE.md`，最后修改代码。任何只改 UI 文案而不更新执行契约的做法都视为不完整变更。
