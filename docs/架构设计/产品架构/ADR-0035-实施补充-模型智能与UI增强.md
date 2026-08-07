# ADR-0035 实施补充：模型智能与 UI 增强

日期：2026-08-07

关联：ADR-0035 Conversation 双资源 owner 与统一运行作用域

## 1. 文档目的

本文档作为 ADR-0035 的实施补充，详细说明模型上下文注入、智能映射、UI 交互设计的具体要求。这些内容已经整合到 ADR-0035 主文档中，本文档提供开发实施时的快速参考。

## 2. 模型上下文注入规范

### 2.1 Space Owner 上下文模板

```
[Current conversation owner]
kind=space
name={spaceName}
managed_root={absolutePath}

[Workspace references in this space]
You can access the following external resources by their name or full path:

- "{primaryName}"
  Full path: {absolutePath}
  Status: {Available|Disconnected}

- "{primaryName2}"
  Full path: {absolutePath2}
  Status: {Available|Disconnected}

When the user mentions these names, use the corresponding full path to access files.
The managed_root is your default working directory for this space.
```

**关键要求**：
1. 即使 Space 没有任何引用，也必须注入 owner 信息和 managedRoot
2. 引用必须包含名称（可改名的 title）、完整路径、状态；不建设用户维护的别名或描述字段（ADR-0035 §6.2，避免增加用户心智负担）
3. 明确告知模型 managedRoot 是默认工作目录
4. 明确告知模型如何映射用户提到的名称到路径

### 2.2 Workspace Owner 上下文模板

```
[Current conversation owner]
kind=workspace
name={workspaceName}
path={absolutePath}
```

**关键要求**：
1. 提供 Workspace 名称和完整路径
2. 不需要额外的引用信息（Workspace 不引用其他资源）

### 2.3 空 Space 的特殊处理

**场景**：用户创建了新 Space，还没有添加任何引用

```
[Current conversation owner]
kind=space
name=我的新空间
managed_root=C:\AgentArborData\spaces\space-123\files

[Workspace references in this space]
No external resources have been added to this space yet.
You can work with files in the managed_root directory.
```

**要求**：
- 必须注入 owner 区块，不能因为没有引用就省略
- 明确告知模型没有外部资源
- 告知模型可以在 managedRoot 工作

## 3. 智能路径映射

### 3.1 映射规则

模型需要能够将用户的自然语言描述映射到实际路径。这是模型自身能力，不依赖用户维护的别名/描述字段：

| 用户表述 | 映射目标 | 使用路径 |
|---------|---------|---------|
| "RustBook" | 引用名称 | C:\Users\...\Documents\RustBook |
| "Rust 练习项目" | 引用名称/目录语义 | C:\Users\...\Code\rust-practice |
| "rust-practice" | 引用名称 | C:\Users\...\Code\rust-practice |

**实现要求**：
1. 模型应该从上下文中的引用列表（名称 + 真实路径）进行模糊匹配
2. 引用名称来自用户可改名的 title；不再提供别名/说明字段
3. 如果有歧义，应该列出可能的选项让用户选择

### 3.2 工具调用示例

**用户输入**：
```
帮我看看 RustBook 的第三章
```

**模型内部映射**：
```
"RustBook" → 查找引用列表 → 匹配到：
  name: "RustBook"
  path: "C:\Users\xzf28\Documents\RustBook"
  status: "Available"
```

**工具调用**：
```typescript
{
  tool: "Read",
  path: "C:\\Users\\xzf28\\Documents\\RustBook\\chapter3.md"
}
```

**授权与审计**：工具入参只有真实绝对路径。`linkId / workspaceId / mountVersion` 等内部身份由后端在执行边界内从 Run snapshot 解析后附加到执行事实，绝不作为模型参数暴露；这防止模型伪造授权字段形成权限升级通道。

**工具结果展示给用户**：
```
读取了 [RustBook] chapter3.md 的内容...
```

### 3.3 路径显示分离原则

**内部使用（工具调用、权限校验）**：
- 始终使用完整的绝对路径
- `linkId`、`workspaceId` 由后端从 Run snapshot 解析后附加到执行事实，用于权限校验与审计，不作为模型参数
- 记录在审计日志中

**用户可见（消息、日志）**：
- 使用友好的简化路径：`[RustBook] chapter3.md`
- 或相对于 managedRoot 的路径：`notes/learning.md`
- 在需要明确时显示完整路径

## 4. UI 交互设计规范

### 4.1 首页选择器

**布局**：
```
┌─ 选择工作环境 ─────────────────────┐
│                                       │
│ ○ 学习 Rust (空间)                    │
│   📦 包含 2 个引用资源                │
│   RustBook, rust-practice            │
│   最近使用：2 小时前                  │
│                                       │
│ ○ 产品规划 (空间)                    │
│   📁 空间自有文件夹                   │
│   暂无引用                           │
│   最近使用：昨天                      │
│                                       │
│ ○ AgentArbor (工作区)                │
│   📂 Z:\AgentArbor                   │
│   最近使用：5 分钟前                  │
│                                       │
│ ➕ 添加新工作区                       │
│ ✨ 创建新空间                         │
└───────────────────────────────────┘
```

**交互要求**：
1. 清楚区分 Space 和 Workspace（图标 + 标签）
2. Space 显示引用数量和名称摘要
3. 显示最近使用时间，帮助用户快速定位
4. 支持快速创建新资源

### 4.2 对话顶部 Owner 显示

**折叠状态**：
```
学习 Rust · 空间 ▼
```

**展开状态**：
```
┌─ 空间：学习 Rust ───────────────────┐
│ 📁 空间文件夹                         │
│ C:\AgentArborData\spaces\xxx\files  │
│                                       │
│ 📦 引用资源                           │
│                                       │
│ ✓ RustBook                           │
│   C:\Users\...\Documents\RustBook   │
│   Rust 官方教材中文版                │
│   [打开] [取消引用]                   │
│                                       │
│ ✓ rust-practice                      │
│   C:\Users\...\Code\rust-practice   │
│   日常练习代码仓库                    │
│   [打开] [取消引用]                   │
│                                       │
│ ➕ 添加引用                           │
└─────────────────────────────────────┘
```

**状态指示**：
- ✓ 绿色：可用
- ⚠ 橙色：已断开，需要重新连接
- 🗑 灰色：已删除

**交互功能**：
1. 点击展开/折叠
2. 快速打开引用的文件夹
3. 取消引用（需确认）
4. 添加新引用

### 4.3 Space 详情页引用管理

```
┌─ 学习 Rust ─────────────────────────┐
│                                       │
│ 空间文件夹                            │
│ C:\AgentArborData\spaces\xxx\files  │
│ [在文件管理器中打开]                  │
│                                       │
│ 引用的工作区                          │
│                                       │
│ ┌─ RustBook ─────────────────────┐ │
│ │ 状态：✓ 可用                    │ │
│ │ 路径：C:\Users\...\RustBook    │ │
│ │ 最近使用：2 小时前在"语法学习" │ │
│ │ [改名] [打开] [取消引用]        │ │
│ └───────────────────────────────┘ │
│                                       │
│ ┌─ rust-practice ────────────────┐ │
│ │ 状态：✓ 可用                    │ │
│ │ 路径：C:\Users\...\rust-practice│ │
│ │ 最近使用：昨天在"错误排查"      │ │
│ │ [改名] [打开] [取消引用]        │ │
│ └───────────────────────────────┘ │
│                                       │
│ [➕ 添加引用]                         │
└───────────────────────────────────┘
```

**编辑引用弹窗**（仅改名，复用现有引用改名机制；不提供别名/说明字段）：
```
┌─ 重命名引用 ──────────────┐
│                             │
│ 名称：[RustBook        ]    │
│                             │
│ [取消] [保存]               │
└─────────────────────────────┘
```

### 4.4 首次使用引导

**首次启动时显示**：
```
┌─ 欢迎使用 AgentArbor ────────────────┐
│                                       │
│ 🏠 空间是什么？                       │
│                                       │
│ 空间是一个主题工作台，用来组织某一类  │
│ 工作。                                │
│                                       │
│ 例如：                                │
│ • "学习空间"：引入教材、笔记、练习项目 │
│ • "产品规划空间"：引入需求文档、竞品  │
│   资料、设计草图                      │
│                                       │
│ 空间有自己的文件夹，用来存放：        │
│ • Agent 生成的报告和整理              │
│ • 你的临时笔记和想法                  │
│ • 跨资源的关联内容                    │
│                                       │
│ 引用的外部资源随时可以添加或移除。    │
│                                       │
│ 📂 工作区是什么？                     │
│                                       │
│ 工作区对应你电脑上的一个项目文件夹，  │
│ 比如代码仓库。在工作区对话中，Agent   │
│ 专注于这个项目。                      │
│                                       │
│ [创建我的第一个空间] [了解更多]       │
└───────────────────────────────────────┘
```

**创建第一个对话时**：
```
┌─ 选择工作环境 ─────────────────────┐
│                                       │
│ 🏠 我的空间 (空间)                    │
│    这是为你准备的默认工作台            │
│    [选择]                             │
│                                       │
│ ➕ 添加工作区                         │
│    选择电脑上的项目文件夹              │
│                                       │
│ 💡 提示：                             │
│    • 空间可以引用多个项目和资料        │
│    • 工作区专注于单一项目              │
└───────────────────────────────────────┘
```

## 5. 实施检查清单

### 5.1 模型上下文

- [ ] Space owner 注入完整引用列表（名称、路径、状态）
- [ ] Workspace owner 注入名称和路径
- [ ] 空 Space 也正确注入 owner 区块
- [ ] 模型能理解用户提到的引用名称并映射到真实路径
- [ ] 工具调用使用真实绝对路径
- [ ] 用户可见消息使用友好路径

### 5.2 UI 实现

- [ ] 首页选择器清楚区分 Space 和 Workspace
- [ ] Space 显示引用数量和名称
- [ ] 对话顶部显示固定 owner
- [ ] Space 对话顶部支持展开引用详情
- [ ] 引用状态清楚标示（可用/断开/删除）
- [ ] Space 详情页支持引用管理
- [ ] Space 详情页支持引用改名（复用现有机制），不提供别名/说明编辑
- [ ] 显示引用最近使用情况
- [ ] 首次使用引导已实现

### 5.3 功能验证

- [ ] 用户说"看看 RustBook"，Agent 能映射到正确路径
- [ ] 工具入参只有真实路径；后端把解析出的身份附加到执行事实
- [ ] 权限校验使用后端解析的身份，不依赖模型提供的路径字符串或伪造授权字段
- [ ] 用户可见的日志使用友好路径
- [ ] 空 Space 的对话能正常工作
- [ ] 引用名称与真实路径正确传递给模型（不建设别名/描述字段）

## 6. 常见问题

**Q: 为什么不让 Agent 自动选择"当前项目"？**

A: Space 是"主题工作台"，不是"项目切换器"。managedRoot 是工作中心，引用是参考资料。如果用户需要专注单一项目，应该创建 Workspace owner 的对话。

**Q: 用户如果频繁提到某个引用，每次都要写完整路径吗？**

A: 不需要。模型通过智能映射，能理解"RustBook"、"练习项目"等自然语言，自动使用对应的完整路径。用户和模型交流时可以用简称。

**Q: 文件夹名不好懂（如 "project-2024-backup"），模型理解不了怎么办？**

A: 改名。引用名称就是可改名的 title（复用现有改名机制），用户主动把引用改成语义化名称即可；不需要也不提供单独的别名/说明字段，避免用户为每个引用维护额外元数据。模型从名称与真实路径自然理解指代。

**Q: 如果 Space 引用了 10 个项目，模型上下文会不会太长？**

A: 每个引用只占几行文本（名称、路径、状态），10 个引用约 200 token，影响很小。如果确实有问题，可以考虑只注入最近使用的引用，或者让用户整理不需要的引用。

**Q: 能不能让 Space 对话"切换"到某个引用项目，让那个项目变成 cwd？**

A: 当前设计不支持。这会破坏"owner 决定 cwd"的一致性。如果用户需要深度操作某个项目，应该为那个项目创建独立的 Workspace 对话。
