# 默认 Agent 后续开发流程

## 目标

当前开发先补稳两种模式共享的基础设施，再在这套基础设施上完成默认普通桌面 Agent。`agent` 和显式多 Agent（内部 `deep` / `DeepRuntime`）共享 AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase、Skill Context 和 Workbench Panel read-model；二者隔离的是编排策略、用户入口和可见语义，而不是运行平台。

默认入口仍是普通 `agent`。显式多 Agent 已通过 Panel 模块和 `/api/deep/*` 暴露，用户文案使用“多 Agent”，内部 API / 实现仍可叫 `deep` / `DeepRuntime`；普通会话入口始终默认创建 `agent` 运行，不因复杂输入、关键词、文件数量或模型判断自动升级到多 Agent。默认 Agent 开发不能顺手夹带 deep 编排变更；显式多 Agent 变更必须按 ADR-0025 的边界推进，并证明不污染普通路径。这里反对的过度设计是普通路径概念命名和流程包装过重，不是删除 deep 长期方向。

后续每一轮开发都必须能回答：

1. 这是否直接提升默认 Agent 的可用性。
2. 这是否复用了现有 AgentTurnRuntime、ToolCenter、Confirmation Gate、RunEvent、RuntimeDatabase 和 Workbench Panel。
3. 这是否避免把历史 `.trellis/tasks`、deep 编排或平台适配文件重新变成当前事实源。
4. 这是否使用了和真实职责匹配的朴素命名，而不是把普通动作包装成 agent / Plan / Handoff / atomic 概念。
5. 这是否保持用户文案“多 Agent”和内部实现 `deep` / `DeepRuntime` 的边界，不把 deep 术语泄漏到普通用户路径。

## 开发顺序

### 1. 共享基础设施基线

- 固化 `runMode: "agent" | "deep"` 的语义：它只表示编排策略选择，不代表两套工具、事件、确认、持久化或投影实现。
- 默认会话 API、工作台输入、普通回答和命令确认卡固定走 `agent`；显式多 Agent 只能通过独立模块和 `/api/deep/*` 进入，并复用同一套基础设施，不能另起平行运行时。
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
- 验收：普通问答不产生 fake report、不进入多 Agent / Underground、不展示 deep / Plan / child agent 文案。

### 3. 工具和确认闭环

- 优先打磨 `search`、`read`、文件引用短预览和工具可见结果。
- 命令执行必须进入 Confirmation Gate；普通工作区文件创建、编辑、删除、写入、MCP 工具和搜索读取走执行边界、运行摘要和审计事件，不做逐次确认。
- 工具失败、取消、拒绝和预算耗尽必须回到用户可理解的回答，不能在普通回答中暴露轮次、预算、provider、raw output 或投影规则。
- 验收：工具结果、refs、stdout/stderr、文件正文和可见输出可以进入会话；运行投影可按体积截断，但不能以摘要替代模型可继续使用的真实工具结果。

### 4. 工作台结果呈现

- 主工作区优先展示回答、结果摘要、关键证据、不确定性和下一步。
- 详情抽屉承载模型 refs、工具 refs、运行 trace、诊断和错误边界。
- Skills、Tools、Settings 只展示真实可用能力；多 Agent 已是真实模块，不再作为占位；Routines、团队 agent 和未完成 deep 能力不做占位。
- 验收：空态、运行态、待确认、完成态、失败态都可读，不出现内部架构菜单或调试面板首屏化。

### 5. 持久化和恢复

- RuntimeDatabase 持久化会话、运行、事件、确认请求、模型调用和工具调用的结构化 read-model。
- 前端断开后能恢复运行状态、待确认事项和已完成结果。
- 配置不完整时停在配置边界，不自动 fallback 成 fake 成功。
- 验收：重载面板后不丢失最近会话、待确认、失败原因和运行事件。

### 6. Skills 与配置中心

- Skills 作为官方兼容能力包加载：`SKILL.md` 元数据进入 run-created frozen catalog，普通 agent 通过 `skill_routing` 模型路由选择，显式 `$skill` 是强信号，keyword 只做候选召回和 fallback。
- 默认发现用户级和项目级 `.agents/skills`；宿主可以显式追加 admin/plugin skill roots，但这是受管来源接入，不是 marketplace、installer、自动更新或回滚；当前不自动扫描 marketplace 或 managed skills。
- 被选中 skill 的 body 按需注入 Context Ledger；正文和 resource 读取都校验冻结 hash，hash 不一致 fail closed。
- `references/`、`assets/`、`scripts/` 只通过 `read_skill_resource` 按需读取；reference 内容作为 tool result 回到模型，asset/script 不返回 raw body，script 不自动执行。
- `evals/` 只作为 loader/doctor 本地质量 artifact 被索引和校验统计，不进入 frozen runtime resource index，不进入 Context Ledger / Context Pack，也不能通过 `read_skill_resource` 读取；doctor 默认做确定性 JSON 结构、case 数、routing 断言、quality/regression 的 `qualityBaseline` with/without skill 记录和字面量质量检查，显式传入模型通道时可通过 `skill_routing` 跑 routing eval；它仍不自动生成 with/without 输出、不调用 LLM judge、不评估运行时真实回答质量。
- `allowed-tools` 是 skill 级工具意图声明：当前只冻结、展示、审计和报告不可用声明，不扩张工具，不隐藏普通 agent 原本可见的工具，也不是 Claude Code 风格免确认授权。
- 当前新增或计划中的 local installer 只能作为本地分发治理原语，负责把明确来源的 skill 包安装到受管 root 并记录版本/来源/校验事实；它不等于 marketplace，也不表示已有远程 registry、自动更新、回滚或企业 managed skills。
- 配置中心统一模型 profile、默认 AI mode、工具启用状态、MCP server 元数据和工作目录。
- secret 只能进入本地 secret store，普通 settings 只保存 `secretRef` 与必要元数据。
- 验收：禁用的 skill/tool 不进入模型上下文；选中 skill 的正文和资源只按需进入模型 continuation；配置状态可解释且不泄漏密钥。

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
- 不新增绕过 Panel 显式“多 Agent”模块的隐式 deep 入口。
- 不在默认 Agent 开发中夹带 DeepRuntime / `/api/deep/*` 编排变更；显式多 Agent 变更必须按 ADR-0025 单独说明边界和验证。
- 不用关键词、长度、文件数量或工程规则把普通请求自动升级到多 Agent / Underground。
- 不把 `deep`、`DeepRuntime`、`/api/deep/*` 写成用户可见主文案；用户侧称“多 Agent”，内部契约可继续沿用 deep 命名。
- 不把普通文件编辑、helper、adapter、状态更新或一次工具循环命名为 deep、Plan、Handoff、Agent cluster 或 atomic mutation。
- 不让平台适配目录、Codex / Claude / OpenCode agent 文件或历史 Trellis skill 反向定义 AgentArbor 产品语义。
- 不为了演示效果创建假报告、假 artifact、假任务、假运行进度或未出生的能力入口。
