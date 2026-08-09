# ADR-0035：Conversation 双资源 owner 与统一运行作用域

日期：2026-08-07

状态：Accepted

取代关系：本方案用于取代 ADR-0034 中“Conversation 只能属于 Space”的部分。ADR-0034 关于 Pi、工具事实、Shell 确认、知识副本和后台进程的机械边界继续保留；本文已接受，Space、Workspace、Conversation 和 Run 的 owner 语义以本文为准。

## 1. 背景与问题

当前实现已把首页选择的 owner 写入新 Conversation，并在 Run 出生前统一解析 execution root。Run 的执行环境、Agent Notes、Skills、Sub-Agent roots、文件工具和 Panel 投影均从冻结 owner scope 推导，不再从全局 workspaceDirectory 推导。

根因不是某个选择框的状态同步，而是缺少统一的 ConversationExecutionScope。owner、cwd、模型上下文、文件路径授权、Shell、进程和 UI 目前没有共同的出生事实。

本文解决：

- Workspace 是否是 Conversation 的一级 owner。
- Space 的软件自有目录如何成为可运行的初始上下文。
- Conversation 选择后如何固定资源边界。
- Space 引用 Workspace 后如何形成 Run 权限。
- 路径消失、取消引用、删除和知识副本如何分别处理。
- 首页、左侧导航和对话面如何表达真实 owner。

本文不重新引入 Multi-Agent 产品入口，也不建设第二套 Agent runner。

## 2. 目标语义

### 2.1 Conversation 只有一个 owner

Conversation 创建时必须选择一个且只能选择一个 owner：

~~~ts
type ConversationOwner =
  | { kind: "space"; id: string }
  | { kind: "workspace"; id: string };
~~~

创建后 owner 不可切换。用户想在另一个资源上继续工作，应创建新的 Conversation；不提供隐式迁移、解绑或双 owner。

### 2.2 Space 与 Workspace 的关系

Workspace 是用户文件系统中的真实文件夹及其软件登记身份。Space 是 AgentArbor 维护的内部语义容器。

- Space 可以引用多个 Workspace。
- 一个 Workspace 可以被多个 Space 引用。
- 引用不转移外部文件所有权。
- 同一物理对象只能登记一个 Workspace。
- 同一个 Space 内禁止重复或父子嵌套 Workspace。
- 跨 Space 的重复引用不互相删除、不互相移动。

Space 的 Conversation owner 与 Workspace 引用是两种不同关系：

~~~text
Conversation -> Space owner
Space -> Workspace link
Conversation -> Workspace owner
~~~

Workspace 被 Space 引用，不会让该 Workspace 的直属 Conversation 归入 Space。

### 2.3 Space 必须拥有软件自有目录

每个 Space 自动拥有一个 managedRoot，作为软件维护的空间文件目录。它不是外部 Workspace，不进入 Workspace 注册表，也不能被当作外部目录重复引用。

首次启动创建一个普通 Space，默认名称为“我的空间”，并创建它的 managedRoot。这个 Space 只是开箱即用的初始对象，不是第三种 owner，也不需要永久不可删除：

- 可以重命名。
- 可以按普通 Space 规则删除。
- 删除后不自动复活。
- 删除全部 Space 后，首页显示创建引导。

此后 Space 既可以由用户在首页或资源管理页创建，也可以由模型通过结构化工具创建；两者没有行为差异（见 §5.3）。

应用数据根目录属于 Host 基础设施，不是用户资源，不出现在左侧资源列表：

~~~text
AgentArborData/
  spaces/<spaceId>/files/
  workspaces/
  knowledge/
  runtime/
~~~

### 2.4 没有全局默认 Workspace

系统不再使用一个全局默认 Workspace 作为 Conversation 的第二上下文，也不再持久化全局文件选择器初始目录。具体 Workspace/Space/附件动作可以按自身上下文向系统选择器提供 `defaultPath`；没有上下文时交给系统选择器。

首页记住上次选择的 owner 只是 UI 偏好，不是权限事实。

旧 `workspaceDirectory` 只在设置文件读取时被忽略，并由规范化写回清除；不再提供 `updateWorkspaceConfig`、配置路由或设置 UI。它不能自动注册 Workspace，也不能给任何 Conversation、Run、Notes、Skills、Sub-Agent roots 或后台进程授权。目录选择器只由具体业务动作调用，不建立全局偏好事实源。

## 3. 统一 Run 作用域

### 3.1 Run 出生事实

创建 Run 前，Host 根据 Conversation owner 生成并冻结：

~~~ts
type ConversationExecutionScope = {
  owner: ConversationOwner;
  ownerTitle: string;
  cwd: string;
  managedRoot?: string;
  workspaceGrants: readonly WorkspaceGrant[];
  attachmentGrants: readonly AttachmentGrant[];
  confirmationPolicy: "confirm_each" | "full_access";
};

type WorkspaceGrant = {
  workspaceId: string;
  linkId?: string;
  mountVersion: string;
  rootPath: string;
  sourceIdentity: string;
};
~~~

同一份 scope 必须被以下边界消费：

- Pi Session 的执行环境 cwd。
- Read、Glob、Grep、Write、Edit 的路径授权。
- Shell 的 cwd 和确认事实。
- 受管后台进程的 owner 关联。
- Agent Notes 的作用域。
- Skills 和 Sub-Agent roots 的解析。
- 模型当前 owner 和资源上下文。
- Conversation 与 Run 的 Panel 投影。

任何模块不得重新从全局配置猜测 cwd 或 owner。

### 3.2 默认 cwd

| Conversation owner | 默认 cwd | 常驻资源 |
| --- | --- | --- |
| Workspace | Workspace 当前 mount 的根目录 | 该 Workspace |
| Space | Space managedRoot | Space 自有资产 |

Space 引用的外部 Workspace 不会被任意选择为“当前工作区”。模型操作外部 Workspace 时，文件工具和 Shell 使用它的真实绝对路径。

未来如确实需要“本轮焦点 Workspace”，只能是 Run 的提示字段，不得成为 owner、持久化默认值或额外权限来源。

### 3.3 资源变化

- 新增 Space-Workspace link：只进入之后创建的 Run。
- 取消 link：立即写入 deny overlay，阻止活动 Run 的后续文件工具访问。
- Workspace 重新连接：生成新的 mountVersion，只影响后续 Run。
- 历史消息、工具结果、日志和旧路径事实不重写、不删除。

权限计算为：

~~~text
run snapshot
+ 本轮明确选择的附件
- 当前已经撤销或删除的 grant
~~~

## 4. Workspace 身份与路径生命周期

### 4.1 三层身份

必须区分：

- workspaceId：Workspace 的长期逻辑身份。
- mountVersion：某次真实目录绑定的版本。
- linkId：某个 Space 对 Workspace 的一次引用关系。

同一路径先取消引用再重新引用，必须产生新的 linkId。目录删除后在原位置重建，不能复用旧 mountVersion 或旧权限。

### 4.2 注册与唯一性

注册 Workspace 前必须：

1. 由系统文件夹选择器或等价 Host 接口获得用户选择。
2. 确认目标是目录并捕获来源身份。
3. 对规范化路径、realpath、大小写、junction 和 symlink 做唯一性检查。
4. 拒绝重复目录和父子嵌套目录。
5. 写入 Workspace、mount 和来源身份事实。

模型不能任意传入一个绝对路径就创建持久化 Workspace；这会把结构化工具变成权限升级通道。

### 4.3 路径消失与重新连接

不做后台轮询。只有创建 Run、打开、预览、附件交付或真实文件工具解析路径时检查当前 mount。

发现目录消失、类型改变或来源身份不一致时：

1. 使当前 mount 失效。
2. 撤销所有依赖该 mount 的 Space link。
3. 阻止活动 Run 的后续文件工具访问。
4. 对关联后台进程执行 revoke/stop。
5. 保留 Workspace 逻辑对象、Conversation、Run、工具事实和历史回答。
6. UI 显示 Workspace 需要重新连接。

重新选择目录必须是显式操作。Space link 不自动恢复；用户需要重新引用并获得新的 linkId。这样“消失后只能重新添加”仍然成立，同时不会因为外接盘掉线而丢失 Conversation。

## 5. 权限与工具

### 5.1 文件工具

普通模式下，标准文件工具只能访问：

- Workspace owner 的当前有效 mount。
- Space owner 的 managedRoot。
- Space 当前有效的 Workspace grants。
- 用户本轮明确选择的附件。

模型使用真实绝对路径；后端用 workspaceId、mountVersion、linkId 和 sourceIdentity 做授权与审计。

继续复用成熟的 Read、Glob、Grep、Write、Edit，不注册 SpaceWrite、SpaceEdit 等第二套文件 API。

### 5.2 Shell

普通模式下每条 Shell 命令逐次确认。确认事实至少包含完整命令、实际绝对 cwd、Conversation owner、是否启动或影响后台进程以及当前确认模式。

当前阶段不把应用层路径检查宣传成 OS 级沙盒。普通 Shell 经用户确认后可能访问文件工具范围之外的路径；这表示用户确认了该命令，不表示 owner 权限被永久扩大。

full_access 是 Run 级冻结模式：

- Shell 不逐条确认。
- 文件工具解除普通 owner 路径集合限制。
- 仍经过 ToolCenter、schema、取消传播、执行事实和审计。
- Space 删除、Workspace 删除和明确撤销的资源进入终止 deny，不能通过旧 Run 继续访问。

明确撤权优先于 `full_access` 是 ADR-0034 第 7 节已经接受的规则；本文沿用该规则，不再把它列为待确认项。若未来要改变优先级，必须单独更新 ADR，不能由某个工具适配器自行决定。

### 5.3 结构化资源工具

结构化工具只修改软件语义，不通过 Shell 修改应用数据库：

| 操作 | 默认行为 |
| --- | --- |
| 创建/重命名 Space | 默认执行 |
| 编辑/移动 Space 自有资产 | 默认执行 |
| 注册新外部 Workspace | 用户选择或确认 |
| 将 Workspace link 到 Space | 建议确认一次，属于持久化权限扩张 |
| 取消 Space link | 默认撤权，结果必须可见 |
| 删除 Space、Workspace、Conversation、软件资产 | 独立确认 |

Conversation owner 不能作为普通 Space 引用移动或解绑。

模型是创建和重命名 Space 的一等操作者：模型通过结构化工具创建/重命名 Space 默认执行，不额外弹确认。模型创建的 Space 与用户创建的 Space 完全等价：自动获得 managedRoot、进入资源列表、可被后续 Conversation 选为 owner、可按普通 Space 规则删除。

模型创建 Space 不改变当前 Conversation 的 owner（owner 在 Conversation 创建时冻结，运行中不可切换）；新建 Space 只进入之后创建的 Conversation 的 owner 选择。创建 Space 本身不授予任何外部路径权限：Workspace 注册必须经用户选择、Space-Workspace link 仍需确认（见上表），模型不能通过"先建 Space 再引用"绕过 §4.2 的权限升级防线。

## 6. 模型上下文与记忆

### 6.1 Space 与 Workspace 的用户心智模型

**Space 是主题工作台**

Space 用于组织和解决"某一类事情"，而不是单一项目的工作环境。典型场景：

- **学习空间**：引用教材文件夹、笔记仓库、练习项目；managedRoot 存放学习笔记、整理的代码片段、问题记录。
- **产品规划空间**：引用需求文档目录、竞品资料、设计草图文件夹；managedRoot 存放规划报告、决策记录、跨资源的关联分析。
- **技术调研空间**：引用多个开源项目、技术文档；managedRoot 存放调研笔记、对比分析、实验代码。

Space 的核心特征：

1. **多资源组合**：可以引用多个外部 Workspace，这些引用是"参考资料"，不是主战场。
2. **软件自有存储**：managedRoot 是"空间的草稿本"，用于存放 Agent 生成的内容、用户的临时想法、跨资源的整理成果。
3. **引用的动态性**：外部资源可以随时添加或移除（比如学习阶段换临时练习文件夹）。
4. **默认工作位置**：Agent 的 cwd 在 managedRoot，因为这是"工作台的中心"；访问引用的外部资源时使用其真实绝对路径。

**Workspace 是单一项目**

Workspace 对应用户文件系统中的一个真实文件夹，通常是代码仓库或文档项目。它的生命周期独立，专注明确。

### 6.2 模型上下文注入

模型当前用户回合必须得到宿主提供的 owner 区块：

**Space owner 示例**：

~~~text
[Current conversation owner]
kind=space
name=学习 Rust
managed_root=C:\...\spaces\<spaceId>\files

[Workspace references in this space]
You can access the following external resources by their name or full path:

- "RustBook"
  Full path: C:\Users\xzf28\Documents\RustBook
  Status: Available

- "rust-practice"
  Full path: C:\Users\xzf28\Code\rust-practice
  Status: Available

When the user mentions these names, use the corresponding full path to access files.
The managed_root is your default working directory for this space.
~~~

**Workspace owner 示例**：

~~~text
[Current conversation owner]
kind=workspace
name=AgentArbor
path=Z:\AgentArbor
~~~

**关键要求**：

1. Space owner 必须注入 managedRoot，即使没有任何外部引用。
2. Space 引用的 Workspace 必须列出：名称（title，用户可改名）、路径、状态。
3. 模型需要能够：
   - 理解用户提到的"RustBook"、"练习项目"等指代，映射到对应的真实路径。
   - 知道 managedRoot 是默认工作目录。

**不建设用户维护的别名与说明字段**。引用名称就是用户可改名的 `title`，文件夹名通常已足够语义化；自然语言指代到真实路径的映射是模型的职责，工程侧只保证把名称、真实路径和状态注入上下文，不要求用户为引用维护额外元数据，避免增加用户心智负担。
   - 使用真实绝对路径调用文件工具，但在与用户交流时可以使用简称。

### 6.3 引用的智能映射

Agent 必须能够根据用户的自然语言描述，匹配到对应的 Workspace 引用。这是模型自身的能力：上下文中的引用名称（可改名的 title）与真实路径足够让模型理解指代，工程侧不维护别名或描述字段（见 §6.2）。

**示例对话**：

```
用户：帮我看看 Rust 练习项目的错误
Agent：（内部映射）"Rust 练习项目" → rust-practice → C:\Users\...\Code\rust-practice
       （调用工具）Read(path="C:\Users\...\Code\rust-practice\src\main.rs")
       （回复用户）检查了练习项目的 main.rs...
```

**工具调用与显示的分离**：

```typescript
// 工具调用时使用真实路径；授权身份绝不来自模型参数
{
  tool: "Read",
  path: "C:\\Users\\xzf28\\Documents\\RustBook\\chapter3.md"
}
```

后端在执行边界内把真实路径解析到本轮有效的 `workspaceId / linkId / mountVersion` 后，将其附加到执行事实用于授权与审计；这些身份字段只能由后端从 Run snapshot 解析注入，不作为工具入参暴露给模型，避免把结构化工具变成伪造授权通道。

日志和用户可见的消息中可以友好显示简称路径，例如 `[RustBook] chapter3.md`；这是展示投影，不改变工具入参与执行事实的真实路径。

### 6.4 Notes 作用域

Notes 作用域建议：

- 全局 Notes：按现有规则注入。
- Workspace owner：注入以 `workspaceId` 为身份的 Workspace Notes。
- Space owner：注入以 `spaceId` 为身份的 Space Notes。
- Space 引用的 Workspace 不自动合并其全部 Notes，避免多根冲突和隐式上下文扩张。

### 6.5 Notes 身份与持久化

Notes 的持久化键必须使用软件对象身份，而不是规范化路径或路径哈希：

~~~ts
type AgentNotesScope =
  | { kind: "global" }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "space"; spaceId: string };
~~~

路径只用于本轮解析和读写位置，不能作为 Notes 的长期身份。Workspace 重新连接、挂载版本变化或同一路径被新对象占用时，旧 Notes 仍归原 `workspaceId`，不会漂移到新对象；旧的 root-keyed Notes 只允许在一次可证明的迁移中转换，无法证明归属时不得猜测合并。

### 6.6 Skills 与 Sub-Agent roots

Skills 与 Sub-Agent roots 同理：优先使用 owner 根；外部引用只是数据源，不自动成为配置根。未来若需要项目级技能，应新增显式的本轮焦点机制。

## 7. 资产与删除

### 7.1 资产归属

| 对象 | 所有者 | 取消引用 | 删除 owner |
| --- | --- | --- | --- |
| 外部 Workspace 文件 | 用户文件系统 | 保留 | 保留 |
| Workspace 元数据和 mount | Workspace feature | mount 失效 | 删除 |
| Space managedRoot | Space feature | 不适用 | 物理删除 |
| Conversation/Run/工具事实 | Ordinary feature | 保留 | 随 owner 级联 |
| 知识库独立副本 | Personal Knowledge | 保留 | 保留，清除来源关联 |
| 后台进程事实和日志 | Host/Ordinary | 保留事实，停止权限 | 按 owner 清理或收口 |

取消引用永远只是权限变化，不是历史清理。

### 7.2 删除流程

删除 Space：

1. 进入 deleting，拒绝新 Conversation/Run。
2. 停止 Space 关联进程。
3. 删除 Space owner 的 Conversation、Run、工具证据和普通日志。
4. 删除 Space managedRoot 与 Space 自有资产。
5. 删除 Space-Workspace links。
6. 清理知识副本的来源关联，保留知识页面和物理副本。

删除 Workspace：

1. 进入 deleting，拒绝直属 Conversation 的新 Run。
2. 停止直属 Workspace 进程。
3. 删除 Workspace owner 的 Conversation、Run 和 Workspace 软件侧资产。
4. 移除所有 Space links。
5. 保留用户真实文件夹和知识库独立副本。

两条流程都由 Host coordinator 和 SQLite journal 协调，支持重启后恢复，不静默吞掉补偿失败。

## 8. 持久化与模块边界

### 8.1 推荐表

~~~text
spaces
  id, title, managed_root, created_at, updated_at

workspaces
  id, title, status, created_at, updated_at

workspace_mounts
  workspace_id, mount_version, root_path, source_identity, status

space_workspace_links
  link_id, space_id, workspace_id, mount_version, created_at

conversations
  conversation_id, owner_kind, owner_id, ...
~~~

Conversation owner 应由 Ordinary Conversation 保存为 canonical fact。Space 页面中的“关联对话”是组合根生成的 read-model，不再在 Space store 保存第二份 owner link。

### 8.2 Feature 所有权

- WorkspaceFeature：Workspace 元数据、mount、唯一性、连接状态和公开 query/command/event。
- SpaceFeature：Space、managedRoot、Space 资产和 Workspace links。
- OrdinaryFeature：Conversation、Run、owner、完成语义、工具事实和删除。
- ToolCenter：工具定义、冻结执行边界、确认和执行事实。
- Host Composition Root：跨 feature 创建/删除协调、Path resolver、进程生命周期和资源释放。
- Pi：Session、模型-工具循环、压缩和 provider 机械能力。
- Panel：公开 facade 的协议适配和 read-model 展示。

不建设全局 Workspace manager、universal Run runtime 或第二套 Shell/Process runner。

## 9. API 与 Panel 契约

### 9.1 创建 Conversation API

创建 Conversation：

~~~json
{
  "goal": "整理构建问题",
  "owner": {
    "kind": "space",
    "id": "space-123"
  }
}
~~~

或：

~~~json
{
  "goal": "修复项目",
  "owner": {
    "kind": "workspace",
    "id": "workspace-456"
  }
}
~~~

不再接受 workspaceDirectory 作为 Conversation owner 参数。

### 9.2 Conversation DTO

Conversation DTO 至少投影：

~~~ts
type ConversationOwnerView = {
  kind: "space" | "workspace";
  id: string;
  title: string;
  status: "available" | "disconnected" | "deleting";
};

// Space owner 时需要额外投影引用信息
type SpaceWorkspaceReference = {
  workspaceId: string;
  linkId: string;
  name: string;
  path: string;
  status: "available" | "disconnected";
};
~~~

### 9.3 UI 状态分离

Panel 状态必须分离：

~~~text
homeOwnerSelection       首页创建选择
spacePageSelection       当前浏览的 Space
conversationOwner        后端返回的固定 owner
knowledgeFilterSpaceId   知识库筛选
~~~

左侧导航：

~~~text
首页
空间
工作区
知识库
设置
~~~

侧边栏信息架构细则：

- **首页**：新 Conversation 的唯一入口，同时承载跨 owner 的"最近对话"视图（按 owner 分组、带 owner 徽标）。"最近对话"不是侧边栏主列表，只作为首页内容存在。
- **空间**：只列出 Space 行，不展开会话子列表。点击 Space 行后进入右侧 SpacePage（独立 UI），关联 Conversation、managedRoot、引用资源与状态都在 SpacePage 中展示。
- **工作区**：列出已注册 Workspace，每项可展开显示其直属 Conversation（owner 为 workspace）。点击会话进入对话面；点击工作区行显示轻量工作区详情（路径、mount 状态、直属会话列表）。
- 对话列表不再以全局 top-N 混合列表形式出现在侧边栏；会话按 owner 归属展示（工作区下展开、Space 内通过 SpacePage 关联视图）。
- 资源管理页可以显示关联 Conversation，但不提供另一套 owner 切换入口。

首页是新 Conversation 的唯一入口。资源管理页可以显示关联 Conversation，但不提供另一套 owner 切换入口。

### 9.4 对话界面 owner 显示

**对话顶部固定 owner 显示**：

~~~text
产品规划 · 空间
AgentArbor · 工作区
~~~

**Space owner 展开详情**：

用户点击展开后，应显示：

~~~text
┌─ 空间：学习 Rust ─────────────────┐
│ 空间文件夹：C:\...\spaces\xxx\files       │
│                                           │
│ 引用资源：                                 │
│   • RustBook (可用)                       │
│     C:\Users\...\Documents\RustBook      │
│     Rust 官方教材中文版                    │
│                                           │
│   • rust-practice (可用)                  │
│     C:\Users\...\Code\rust-practice      │
│     日常练习代码仓库                       │
└──────────────────────────────────┘
~~~

**首页创建对话选择器**：

选择 owner 时应清楚展示资源的组成：

~~~text
○ 学习 Rust (空间)
  包含 2 个引用资源：RustBook, rust-practice
  
○ 产品规划 (空间)
  空间自有文件夹，暂无引用
  
○ AgentArbor (工作区)
  Z:\AgentArbor
~~~

### 9.5 引用管理界面

**Space 详情页增强**：

1. **引用列表**：显示所有引用的 Workspace，包括名称、路径、状态
2. **引用改名**：复用现有引用改名机制；不提供独立的别名或说明编辑（见 §6.2，避免用户为引用维护额外元数据）
3. **最近使用**：显示哪些 Conversation 使用了这个引用
4. **快速添加**：便捷的添加引用按钮，打开文件选择器

**引用状态指示**：

- ✓ 可用（绿色）
- ⚠ 已断开（橙色）：目录不可访问，需要重新连接
- 🗑 已删除（灰色）：Workspace 已被删除

### 9.6 首次使用引导

**首次启动时**：

```
欢迎使用 AgentArbor！

空间是什么？
空间是一个主题工作台，用来组织某一类工作。

例如：
• "学习空间"：引入教材、笔记、练习项目
• "产品规划空间"：引入需求文档、竞品资料、设计草图

空间有自己的文件夹，用来存放：
• Agent 生成的报告和整理
• 你的临时笔记和想法
• 跨资源的关联内容

引用的外部资源随时可以添加或移除。

[创建我的第一个空间] [了解更多]
```

**创建第一个对话时**：

```
选择工作环境：

🏠 我的空间 (空间)
   这是为你准备的默认工作台
   
➕ 添加工作区
   选择电脑上的项目文件夹

💡 提示：空间可以引用多个项目和资料，
        工作区专注于单一项目
```

## 10. 实施顺序

### 阶段一：事实源与契约

1. ~~接受本文并更新 ADR-0034 的取代说明。~~（已完成：本文已接受，ADR-0034 状态与取代关系已补注）
2. ~~更新 ADR-0034 配套的开发指南 18、产品架构索引和 `CURRENT_RUNTIME_MODE.md`，让旧的"Conversation 只能属于 Space"表述与目标方案一起断代迁移。~~（已完成：开发指南 18 已改双 owner 口径，索引与运行模式说明已标注迁移中）
3. 定义 ConversationOwner、ConversationExecutionScope、WorkspaceGrant 和 owner DTO。
4. 写 owner 不可切换、空 Space owner 和撤权优先于 `full_access` 的测试。

### 阶段二：WorkspaceFeature

1. 新增 Workspace contracts、repository、commands、queries、events。
2. 实现 mountVersion、sourceIdentity、重复/父子校验。
3. 实现显式注册、重新连接和断连状态。
4. 将 Space 外部路径引用迁移为 workspaceId + linkId。

### 阶段三：Conversation owner

1. Ordinary Conversation 使用判别联合保存 owner。
2. 创建 Run 前通过公开 facade 校验 owner。
3. 删除 Space/Workspace 时按 owner 查询 Ordinary Conversation。
4. 移除 Space store 中重复的 Conversation owner 事实。
5. 用 Host journal 处理跨 feature 删除和重启恢复。

### 阶段四：统一 Run scope

1. 在 Run birth 前解析 owner scope。
2. 用 scope 设置 Pi ExecutionEnv cwd。
3. 用 scope 装配文件工具、Shell、Notes、Skills、Sub-Agent 和进程。
4. 将 Space 资源和 Workspace mount 快照写入 Run snapshot。
5. 加入 live deny overlay 和按需来源身份检查。

### 阶段五：模型与工具

1. 注入 owner 区块和真实绝对路径。
2. 保留标准文件工具，不建设第二套 Space 文件 API。
3. 统一 Shell 确认、full_access 和 cwd 事实。
4. 限制 Workspace 注册/Space link 的权限扩张路径。
5. 让后台进程携带 owner、link 和 mountVersion。

### 阶段六：Panel 与初始化

1. 将”我的空间”和 managedRoot 的创建并入现有 `initializeInitialWorkbenchData` 初始化入口，复用同一初始化互斥、幂等和重试机制；不得新增平行初始化器。已有 Space 或用户数据存在时不重复创建，不覆盖现有资产。
2. 首页改为 Space/Workspace 统一选择器，清楚显示每个 Space 包含的引用资源。
3. 左侧增加独立 Spaces、Workspaces 管理入口。
4. 对话顶栏显示固定 owner，支持展开查看 Space 的引用详情（名称、路径、状态）。
5. 拆分前端 selection state，删除全局 activeSpaceId 的跨职责复用。
6. Space 详情页增加引用管理功能：改名、最近使用、快速添加（不建设别名/说明字段，见 §6.2）。
7. 实现首次使用引导，解释 Space 与 Workspace 的区别和用途。

### 阶段七：模型上下文与智能映射

1. 实现 Space owner 的完整模型上下文注入：owner 信息、managedRoot、引用列表（名称、路径、状态）。
2. 实现模型对用户自然语言的引用映射能力（”RustBook”、”练习项目” → 真实路径）。
3. 工具调用使用真实绝对路径 + 权限校验，日志和用户消息使用友好显示路径。
4. 确保空 Space 也能正确注入 owner 和 managedRoot 到模型上下文。

### 阶段八：旧语义退役

1. 删除 `workspaceDirectory` 兼容字段、`config-center.updateWorkspaceConfig`、旧配置路由和旧设置文案；读取旧设置时忽略该字段并在规范化写回时清除。
2. 删除 workspaceFolder 作为 owner 的旧投影。
3. 清理只接受 opaque referenceId 的旧模型描述和测试。
4. 清理双重 Path resolver、全局默认 cwd 和旁路进程状态。
5. 完成文档索引和源结构测试更新。

## 11. 验收矩阵

### Owner 与首页

- 选择 Space A 后，新 Conversation owner 必须是 A。
- 选择 Workspace X 后，不隐式创建 Space。
- Conversation owner 缺失、冲突或被删除时明确失败。
- 已创建 Conversation 不受首页再次选择影响。
- 空 Space 仍有正确 owner、managedRoot 和模型上下文。
- 首页选择器清楚显示 Space 包含的引用资源数量和名称。
- 模型可通过结构化工具创建 Space，创建后与用户创建的 Space 行为一致（managedRoot、资源列表、owner 可选）。
- 模型创建 Space 不改变当前 Conversation owner，也不授予任何外部路径权限。

### Run 与路径

- Space Run 的 cwd 是 Space managedRoot。
- Workspace Run 的 cwd 是 Workspace mount 根目录。
- Space 只能访问自己的 managedRoot 和有效 links。
- Workspace 直属对话不能访问 Space managedRoot。
- 新增 link 不扩张活动 Run；取消 link 立即拒绝后续文件调用。
- 真实绝对路径显示给模型，内部 ID 同时保留在工具事实。

### 模型智能与上下文

- Space owner 的模型上下文必须包含：owner 信息、managedRoot、完整的引用列表（名称、路径、状态）。
- 模型能够理解用户提到的"RustBook"、"练习项目"等自然语言，映射到对应的真实路径。
- 工具调用使用真实绝对路径，日志和用户消息使用友好的显示路径（如 `[RustBook] chapter3.md`）。
- 空 Space（无引用）也能正确注入 owner 区块到模型上下文。

### 生命周期

- 同一物理目录不能重复注册。
- 父子 Workspace 被拒绝。
- 路径消失不会自动恢复旧权限。
- 重新连接或重新引用生成新 mountVersion/linkId。
- 删除 Space 不删除外部文件夹。
- 删除 Workspace 不删除外部文件夹。
- 知识库副本在 owner 删除后仍可用。

### UI 与交互

- 对话顶部显示固定 owner（如"学习 Rust · 空间"）。
- Space owner 的对话顶部可展开，显示 managedRoot 和引用列表。
- 引用状态（可用/已断开/已删除）清楚标示。
- Space 详情页支持引用改名（复用现有机制），不提供别名/说明编辑。
- 首次使用时显示引导，解释 Space 与 Workspace 的区别。

### Shell、工具和进程

- 普通 Shell 每次确认，拒绝形成真实工具失败结果。
- full_access 同时覆盖 Shell 和文件工具，但仍受明确删除/撤权 deny。
- cwd、命令、退出码和日志引用全部持久化。
- 引用撤销停止或标记关联进程 stop_pending。
- 重启恢复不重放 Shell 或模型调用。

## 12. 迁移策略

当前仓库仍处于语义收口阶段，开发数据优先采用明确断代，不从旧 workspaceDirectory 或缺失来源身份推测权限。

如果未来已有正式用户数据，迁移必须：

1. 先按规范路径和来源身份去重 Workspace。
2. 为每条 Space 引用生成独立 linkId。
3. 将旧 Space owner 转换为 Conversation owner。
4. 对无法证明来源身份的外部引用标记为需要重新添加。
5. 保留 Conversation、工具事实和知识副本。
6. 对旧字段只读一次，写入新 schema 后停止双写。
7. 丢弃旧 `workspaceDirectory` 设置值；不得因为该值创建 Workspace、Conversation owner 或 Run 权限。
8. 将旧的 root-keyed Workspace Notes 仅在能通过现有身份事实证明归属时迁移到 `workspaceId`；无法证明的 Notes 保留为待处理资产，不自动合并到新 Workspace。

## 13. 非目标

本文不包含：

- OS 级强制沙盒或容器化执行。
- Multi-Agent 重新进入生产入口。
- Conversation 跨 owner 迁移。
- 多 Space 合并。
- 自动猜测移动后的目录。
- 取消引用即删除历史或派生资产。
- 把所有引用 Workspace 的 Skills/Notes 自动合并成一个隐式配置环境。

## 14. 已确认的边界

实现前需要确认的两项边界已经确认如下：

1. **重新连接到不同文件系统对象时，创建新 Workspace，不替换旧 mount**。旧 mount 保持失效状态，旧 Conversation 不得静默操作陌生目录；用户重新选择目录时，若来源身份可证明是同一对象则走重新连接流程生成新 mountVersion，否则登记为新 Workspace。
2. **第一阶段不提供"本轮焦点 Workspace"**。根据 Space 作为"主题工作台"的定位，Space 的 managedRoot 是默认工作位置，引用的外部资源通过智能映射和绝对路径访问；这符合"空间组织多种资源，而非单一项目工作"的心智模型。若未来需要焦点机制，只能是 Run 的提示字段，不得成为 owner、持久化默认值或额外权限来源。

后续实施（首页 UI 扩展与旧路径适配器修改）以上述确认结论为前提进行。

## 15. 设计理念总结

**Space 不是”多项目的 Workspace”**

Space 的设计目标是”围绕主题组织资源的工作台”，而不是”同时在多个项目里干活”。理解这一点对正确实现和使用 Space 至关重要：

**✓ 正确的 Space 用法**：
- 学习 Rust：引用教材、笔记、练习项目；在 managedRoot 整理学习笔记和代码片段
- 产品规划：引用需求文档、竞品分析、设计草图；在 managedRoot 生成规划报告和决策记录
- 技术调研：引用多个开源项目文档；在 managedRoot 写对比分析和实验代码

**✗ 错误的预期**：
- 把 Space 当作”同时打开多个项目”的 IDE 工作区
- 期望 Agent 在 Space 的多个引用项目间”自动选择焦点”
- 认为引用了项目就应该”默认在项目里干活”

**为什么 managedRoot 是默认 cwd**：
- managedRoot 是”工作台的中心”，存放跨资源的整理成果
- 引用的外部资源是”参考资料”，按需访问
- Agent 通过智能映射理解用户说的”RustBook”、”练习项目”，自动使用对应路径
- 这样的设计让 Space 成为”知识整合的地方”，而不是”项目切换器”

**如果用户需要专注单一项目**：
- 应该创建 Workspace owner 的对话，而不是 Space
- Workspace 就是为”在单一项目里深度工作”设计的
