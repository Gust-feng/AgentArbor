# ADR-0036：Conversation 归属与移动工作台信息架构

## 状态

已接受。取代 ADR-0034 第 6 节中“全局对话索引、任务抽屉和底部主导航”的移动端产品面；补充 ADR-0035 的受管内容同步边界。当前实现先收敛 Space owner，Workspace owner 只有满足本 ADR 的稳定身份与功能闭环后才能开放。

## 背景

早期移动端把首页输入、Space 列表、最近对话、知识库和账户入口并列展示。Conversation 可以缺少 `spaceId`，桌面运行又只有 `workspaceFolder.path` 摘要。结果是首页同时承担启动、历史和资源导航，用户看不出对话属于哪里；若直接把本地路径下发为 Workspace 身份，还会产生隐私泄漏、盘符变化和跨设备无法恢复的问题。

当前产品判断是：Conversation 不是全局漂浮记录，必须固定依附一个 Space 或 Workspace。移动端应映射这一归属关系，而不是复制桌面所有控件或恢复全局“最近对话”。

## 决策

### 1. Conversation owner 是正式业务事实

长期契约使用判别联合：

```ts
type ConversationOwnerRef =
  | { readonly kind: "space"; readonly id: string }
  | { readonly kind: "workspace"; readonly id: string };
```

- owner 在创建 Conversation 时确定，并随 Conversation 持久化；继续对话不能暗中更换 owner。
- Ordinary Conversation 是该关系的事实 owner。Space/Workspace 页面通过公开 query 投影所属 Conversation，不再依赖两边各存一份可漂移的关系。
- 创建命令必须携带 owner。组合根只编排 owner 存在性校验和 feature command，不建设全局 owner store 或统一工作流引擎。
- 已有无 owner Conversation 属于迁移数据：桌面可以提供显式归属修复，但移动端不得把它们重新包装成全局最近对话。

当前 `OrdinaryConversationControlState` 尚未持有 `ConversationOwnerRef`，Space 仍以 conversation reference 反向表达归属。这是明确迁移缺口，不把现状伪称为最终契约。

### 2. Workspace 必须先成为完整功能模块

Workspace owner 只有在 WorkspaceFeature 至少提供以下事实后才能出生：

- 稳定、不可由路径反推的 `workspaceId`；
- 用户可识别的 `title`；
- `mounted | unavailable | disconnected` 等挂载状态；
- 由桌面 Host 私有保存的 `rootPath`、挂载版本和来源身份；
- owner 存在性 query、Conversation 查询和必要迁移测试。

远程与移动端最多投影 `{ workspaceId, title, status }`。不得把绝对路径、路径哈希、盘符或 symlink 解析结果写入 Relay、Content Vault、移动端 IndexedDB 或 localStorage。Workspace 外部文件仍遵守 ADR-0034/0035 的禁止同步边界。

### 3. 当前远程阶段只接受真实 Space owner

当前 `remote-collaboration/v1` 仍使用可选 `spaceId` 兼容桌面既有数据，但正式移动行为是：

- 新建 Conversation 必须选择存在的 Space，并发送 `spaceId`；
- pending/outbox 项必须保存同一 `spaceId`，重启后投影回该 Space；
- Conversation 只从所属 Space 进入，header 显示可返回的 owner breadcrumb；
- 缺少或指向未知 Space 的 Conversation 不进入首页、侧栏或伪造列表；
- WorkspaceFeature 未完成前，不增加路径型 `workspaceId`、Workspace 占位卡片或不可用入口。

当 WorkspaceFeature 与 Ordinary owner 持久化同时完成时，远程协议直接收敛为结构化 `owner`。当前协议尚未正式发布，不为开发态 schema 建设 V1/V2 双写；迁移必须同步修改桌面投影、命令处理、移动缓存/outbox 和行为测试。

### 4. 移动端唯一信息架构

当前移动协同 release 只交付会话闭环：

```text
首页（选择 Space）
  └─ Space
       └─ Conversation
            └─ 正文、运行、确认与继续输入
```

- 首页只展示当前 owner、模型和输入动作，不展示全局最近对话、混杂资源入口或底部主导航。
- 侧栏当前只用于切换 Space、创建 Space 和设置；知识库等内容入口必须等对应内容 surface 真实出生后再加入。当前 Space 必须在首页、Conversation 和返回路径中保持高亮。
- Space 当前只展示所属 Conversation。笔记、资料、知识库和 Workspace 内容属于后续阶段，不能以空卡片或占位入口提前出现在移动端。
- Conversation 默认层保留标题、owner breadcrumb、正文、需要行动的状态和输入区。常规成功、路径、原始日志和完整证据进入按需详情。
- 内容编辑器的 owner 上下文、自动保存、冲突、删除能力和离线 outbox 仍由既有 Vault 契约保留，待后续内容 surface 接入；本阶段不在移动端装配这些 UI。

### 5. 状态与失败语义

- `running / awaiting_approval / failed / conflict` 只在会改变用户行为时进入 attention 层；正常完成保持安静。
- 电脑或网络离线时，待发送项继续属于原 owner；不得复制成第二条 Conversation 或移动到全局队列。
- owner 被删除或不可用时，打开页面返回最近有效层级，并保留可诊断错误；不能把 Conversation 静默改挂其他 owner。
- Android 返回当前依次关闭最上层 sheet、drawer，再按 `Conversation → Space → 首页` 退出；未来内容 surface 接入后再扩展 editor 层级。

## 不采用

- 全局最近对话作为移动端主要导航：它抹掉归属，并让首页重新承担历史浏览。
- 用 `workspaceFolder.path` 或路径哈希充当 Workspace ID：不稳定、不可迁移且会泄漏桌面结构。
- 只在远程 schema 增加 `workspaceId` 而不建设 WorkspaceFeature 和 Ordinary owner 持久化：会形成没有业务 owner 的假契约。
- 同时保留 `spaceId`、`workspaceId` 和 `owner` 三套可选字段：调用方无法判断权威来源。
- 让 Content Vault 保存 Conversation：Conversation、run、确认和 AI 输出继续由桌面 Ordinary 权威维护。

## 迁移验收

在宣称 Space/Workspace owner 完成前，必须同时证明：

- Ordinary Conversation 创建、恢复、列表和删除都保留同一 `ConversationOwnerRef`；
- SpaceFeature/WorkspaceFeature 不再各自保存可漂移的 Conversation 关系副本；
- Panel 与远程只从公开 Ordinary query 获取 owner；
- 移动端 home、drawer、owner 页面、Conversation、pending/outbox 和返回栈消费同一结构化 owner；
- 未知/已删 owner、离线重试、确认、编辑冲突和 Android 返回都有行为测试；
- 远程、Vault 和移动存储中不存在 Workspace 绝对路径或可逆路径身份。

## 后果

移动端导航获得稳定的对象层级，Space 与未来 Workspace 可以共享信息架构而不共享内部 store。代价是 Workspace 不能通过一次 UI 补丁提前上线；必须先补 Ordinary owner 持久化和 WorkspaceFeature，再统一迁移协议与投影。
