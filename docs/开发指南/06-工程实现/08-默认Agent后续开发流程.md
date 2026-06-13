# 默认 Agent 后续开发流程

## 目标

当前开发先补稳两种模式共享的基础设施，再在这套基础设施上完成默认普通桌面 Agent。`agent` 和未来 `deep` 共享 AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase、Skill Context 和 Workbench Panel read-model；二者隔离的是编排策略、用户入口和可见语义，而不是运行平台。

deep / Agent 集群是未来项目边界：不做默认可见入口，不主动改动 deep 后端，也不把复杂输入自动升级到 Underground。显式 deep 兼容能力只能保留在后端未来边界中，普通会话入口始终默认创建 `agent` 运行。这里反对的过度设计是普通路径概念命名和流程包装过重，不是删除 deep 长期方向。

后续每一轮开发都必须能回答：

1. 这是否直接提升默认 Agent 的可用性。
2. 这是否复用了现有 AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase 和 Workbench Panel。
3. 这是否避免把历史 `.trellis/tasks`、deep 编排或平台适配文件重新变成当前事实源。
4. 这是否使用了和真实职责匹配的朴素命名，而不是把普通动作包装成 agent / Plan / Handoff / atomic 概念。

## 开发顺序

### 1. 共享基础设施基线

- 固化 `runMode: "agent" | "deep"` 的语义：它只表示编排策略选择，不代表两套工具、事件、确认、持久化或投影实现。
- 默认会话 API、工作台输入、普通回答和命令确认卡固定走 `agent`；未来 deep 只能复用同一套基础设施，不能另起平行运行时。
- 模型运行只产出模型响应、流式增量、模型 refs 和失败归一化。
- 工程边界只作为运行守卫和诊断投影存在，不能被包装成模型的能力限制；普通回答应表达可做什么、需要什么上下文或下一步怎么继续。
- 工程动作使用朴素名称：文件编辑叫编辑或补丁，批量变更叫变更集，helper / adapter 保持 helper / adapter；只有真正具有全成功/全失败、回滚或一致性边界时才使用 atomic。
- ToolCenter 统一声明工具用途、参数、operation type、确认策略和用户可见结果策略。
- Confirmation Gate 在默认普通 Agent 路径只处理命令执行确认；普通工作区文件创建、编辑、删除、写入、MCP 工具、搜索读取和本地/私网访问不默认打断用户。
- RuntimeDatabase 保存结构化 read-model，不保存 raw prompt、raw provider response、raw tool output、stdout/stderr、文件正文或 secret。
- 验收：普通 Agent 路径仍复用共享 runtime；没有出现普通模式专用的第二套工具、事件、确认或持久化实现。

### 2. 默认会话闭环

- 稳定新会话、连续追问、历史可见消息回填和取消。
- 普通问题直接由默认普通 `agent` 主循环返回自然语言回答；当前模型目的使用 `desktop_agent`，`desktop_chat` 只作为历史事件和旧记录读取兼容名称。
- 复杂输入也先进入普通 Agent，由模型决定回答、请求补充、调用授权工具或说明需要的上下文与下一步。
- 验收：普通问答不产生 fake report、不进入 Underground、不展示 deep / Plan / child agent 文案。

### 3. 工具和确认闭环

- 优先打磨 `search`、`read`、文件引用短预览和工具可见结果。
- 命令执行必须进入 Confirmation Gate；普通工作区文件创建、编辑、删除、写入、MCP 工具和搜索读取走执行边界、运行摘要和审计事件，不做逐次确认。
- 工具失败、取消、拒绝和预算耗尽必须回到用户可理解的回答，不能在普通回答中暴露轮次、预算、provider、raw output 或投影规则。
- 验收：工具结果、refs、stdout/stderr、文件正文和可见输出可以进入会话；运行投影可按体积截断，但不能以摘要替代模型可继续使用的真实工具结果。

### 4. 工作台结果呈现

- 主工作区优先展示回答、结果摘要、关键证据、不确定性和下一步。
- 详情抽屉承载模型 refs、工具 refs、运行 trace、诊断和错误边界。
- Skills、Tools、Settings 只展示真实可用能力；Routines、团队 agent、deep 入口不做占位。
- 验收：空态、运行态、待确认、完成态、失败态都可读，不出现内部架构菜单或调试面板首屏化。

### 5. 持久化和恢复

- RuntimeDatabase 持久化会话、运行、事件、确认请求、模型调用和工具调用的结构化 read-model。
- 前端断开后能恢复运行状态、待确认事项和已完成结果。
- 配置不完整时停在配置边界，不自动 fallback 成 fake 成功。
- 验收：重载面板后不丢失最近会话、待确认、失败原因和运行事件。

### 6. Skills 与配置中心

- Skills 先做 `SKILL.md` 元数据发现、启用状态、触发说明和按需正文注入。
- 配置中心统一模型 profile、默认 AI mode、工具启用状态、MCP server 元数据和工作目录。
- secret 只能进入本地 secret store，普通 settings 只保存 `secretRef` 与必要元数据。
- 验收：禁用的 skill/tool 不进入模型上下文；配置状态可解释且不泄漏密钥。

### 7. 质量门

每个非琐碎改动至少完成：

- `pnpm build`
- `pnpm test`
- 影响面涉及 panel 时运行 `pnpm panel:smoke`
- 影响面涉及桌面壳时运行 `pnpm panel:desktop:smoke`
- `git diff --check`

测试应优先覆盖普通 Agent 的真实路径：连续对话、工具调用、命令确认、失败、取消、配置边界、持久化恢复和运行投影。

## 禁止回退

- 不从 `.trellis/tasks` 创建、启动或续接当前任务。
- 不新增可见 deep 入口。
- 不主动改动 deep 后端。
- 不用关键词、长度或工程规则把普通请求自动升级到 Underground。
- 不把普通文件编辑、helper、adapter、状态更新或一次工具循环命名为 deep、Plan、Handoff、Agent cluster 或 atomic mutation。
- 不让平台适配目录、Codex / Claude / OpenCode agent 文件或历史 Trellis skill 反向定义 AgentArbor 产品语义。
- 不为了演示效果创建假报告、假 artifact、假任务、假运行进度或未出生的能力入口。
