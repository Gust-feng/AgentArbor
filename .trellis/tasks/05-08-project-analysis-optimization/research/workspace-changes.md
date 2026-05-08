# Research: workspace changes

- **Query**: 分析当前 git 工作区未提交变更的主题与风险，关注 task soil workspace、real-ai-smoke、redaction、panel、safe-visible-output、tool-events、.trellis/spec 如何改变 AgentArbor 方向。
- **Scope**: internal
- **Date**: 2026-05-08

## Findings

### Git / Workspace State Observed

| Location | Observation |
|---|---|
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90` | `git status --short` 当前无输出；该 worktree 当前 HEAD 为 `c8bad99 feat: 接入真实 AI 与 Task Soil 工作台入口`。 |
| `/z/AgentArbor` | 当前只显示未跟踪任务目录 `?? .trellis/tasks/05-08-project-analysis-optimization/`。 |
| Initial session snapshot | 会话开始时曾显示一组未提交变更：`.trellis/spec/**`、`src/app/**`、`src/kernel/intelligence/**`、`src/kernel/redaction.ts`、新增 `task-soil-workspace*` / `real-ai-smoke*` 等；这些内容在当前 worktree 中已落入 HEAD `c8bad99`。 |

因此，本报告按用户点名的变更集合分析 `c8bad99` 中的实际文件内容与主题；不是对当前 main 工作区中仅剩研究任务目录的代码评审。

### Files Found

| File Path | Description |
|---|---|
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/tasks/05-07-task-soil-workspace-context-entry/prd.md` | 明确任务目标：从 fake-AI demo 闭环推进到真实 openai-compatible + Task Soil 工作台入口；面板成为可用 agent 工作台。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/task-soil-workspace.ts` | 新增 Desktop Task Soil 输入解析与组装 helper，支持 context refs、permission boundary refs、只读 preview、脱敏和边界校验。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/task-soil-workspace.test.ts` | 覆盖 Desktop Task Soil 输入、非法 refs、secret 脱敏等测试。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/real-ai-smoke.ts` / `src/app/real-ai-smoke-runner.ts` | 显式真实 AI smoke CLI 当前使用 Cognitive Work Session，而不是旧 `runMinimalLoop()`；配置缺失时输出 skipped/config boundary。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/real-ai-smoke.test.ts` | 覆盖真实 AI smoke 的配置边界、stubbed openai-compatible Work Session contract 和 secret 脱敏。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/kernel/redaction.ts` | 新增统一文本脱敏函数，处理 `sk-`、`tvly-`、Authorization/Bearer、api key、token、secret/password 等形状。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/kernel/intelligence/safe-visible-output.ts` | 模型输出安全可见投影：只展示已验证通过输出、限制字段、字段数量和长度、过滤敏感字段名并脱敏。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/kernel/intelligence/tool-events.ts` | 工具事件安全消息：生成 `tool.requested/completed/failed`，对 input/output/error 做 JSON-safe、深度/长度裁剪、secret-like key 脱敏和 verbose output 省略。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/minimal-loop.ts` | `runMinimalLoop()` 接收 `taskSoilInput`、tool center 和 model delta 回调；完成 Underground 后通过 `createTaskSoilFromDesktopInput()` 生成 Task Soil，再进入 Aboveground/Fruits。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-server.ts` | Panel API 接收 Desktop run 的 Task Soil 输入；Desktop 默认 AI mode 改为 `openai-compatible`；异步 job 保存 `taskSoilInput`；Desktop run 走 `runMinimalLoop()` 并生成 canvas。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-run-jobs.ts` | `PanelRunJob` 新增 `runKind` 与 `taskSoilInput`，支持 desktop/underground 两类 job 区分。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-canvas-read-model.ts` | Main Canvas 新增 `desktop_shell_canvas` 投影，展示 Task Soil、Plan、Aboveground、Fruits 的连续故事，并对 preview/summary 脱敏截断。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-run-read-model.ts` | Panel tracking/transcript/read model 接收 visible output 和 tool totals 等安全投影，用于监督台展示模型/工具流。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-assets.ts` | 前端面板信息架构随 Desktop 工作台方向更新：任务输入、真实 AI 诊断、运行树、模型/工具状态、canvas 等。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/config-center.ts` | 本地配置中心继续通过 secret store 读取模型和 Tavily key；`createUndergroundAiEnvironment()` 不透传 process env 的 `OPENAI_API_KEY` / `TAVILY_API_KEY`，而使用本地配置中心 secret。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/domain/soil/task-soil.ts` | `TaskSoilContextRef` 增加 `readonlyPreview` 字段，Task Soil 可携带只读短预览。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/observation-read-model.md` | 规范要求 Desktop canvas 可展示 Task Soil goal summary/context refs/permission boundary refs/只读短 preview，但必须来自安全投影并禁止 raw body/secret/raw prompt/raw provider response/raw tool output。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/soil-store.md` | 规范同步 Task Soil / Global Soil 边界与 refs/preview 规则。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/tool-runtime.md` | 规范同步 ToolCenter/tool event 安全可见性边界。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/quality-guidelines.md` | 规范同步真实 AI/config boundary/no-leak/testing 质量要求。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/frontend/component-guidelines.md` | 规范同步面板工作台 UI 展示边界。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/frontend/quality-guidelines.md` | 规范同步前端不泄漏、安全投影和无横向溢出等质量要求。 |

### Code Patterns

#### 1) Task Soil workspace 输入从 goal-only 变成 refs + permission boundary + preview

`src/app/task-soil-workspace.ts:41-49` 允许请求体直接给 `contextRefs` / `permissionBoundaryRefs`，也兼容嵌套 `taskSoil.contextRefs` / `taskSoil.permissionBoundaryRefs`。

`src/app/task-soil-workspace.ts:52-75` 用 `createTaskSoilFromDesktopInput()` 创建 Task Soil：

- raw goal、goalId、traceId 进入 Task Soil；
- `contextRefs` 来自默认 goal/workspace refs 加用户 supplied refs；
- `permissionBoundaryRefs` 合并默认 read/write/execute 边界和输入边界；
- `globalSoilRefs` 从 soil store 的 capability/path-bias refs 派生；
- `runMaterialRefs` 包含 traceId。

`src/app/task-soil-workspace.ts:196-223` 限制 refs：

- web 只允许 `web:`、`http://`、`https://`；
- file 只允许 `file:` 或 `workspace:`；
- project 只允许 `project:` 或 `workspace:`；
- workspace 只允许 `workspace:`；
- permission refs 只允许 `read:`、`execute:`、`deny:`、`ask:`。

`src/app/task-soil-workspace.ts:226-238` 明确拒绝 secret/runtime/store/api_key/token/authorization 形状的 ref。

#### 2) Task Soil preview 是“短只读材料”，不是 raw workspace/file body

`src/domain/soil/task-soil.ts:8-17` 给 `TaskSoilContextRef` 增加：

```ts
readonly readonlyPreview?: {
  readonly title?: string;
  readonly text: string;
  readonly truncated: boolean;
};
```

`src/app/task-soil-workspace.ts:241-246` 对 preview text 走 `safeText()` 并设置 `truncated`；`MAX_PREVIEW_LENGTH = 640`。

`src/app/panel-canvas-read-model.ts:124-137` 在 canvas 中再次限制：summary 240、preview title 120、preview text 360，并继承/计算 truncated。

#### 3) Desktop Shell 默认转向真实 AI，但 fake 仍作为测试/兼容路径

`src/app/panel-server.ts:932-934`：

```ts
function defaultAiModeForRunKind(runKind: PanelRunKind, configuredDefault: UndergroundAiMode): UndergroundAiMode {
  return runKind === "desktop" ? "openai-compatible" : configuredDefault;
}
```

`src/app/panel-server.ts:741-743` 禁止 Desktop run 使用 `aiMode === "none"` 产生结果。

`src/app/panel-server.ts:745-757` Desktop run 从 `ConfigCenter` 创建 AI environment 和 configured ToolCenter，然后调用 `runMinimalLoop()`，传入 `taskSoilInput`、provider fetch、tool center、runtime/model delta 回调。

`src/app/real-ai-smoke.ts` 当前只负责 CLI 输出；真实 smoke 逻辑已下沉到 `src/app/real-ai-smoke-runner.ts`，显式使用 openai-compatible 运行 Cognitive Work Session，并输出 trace/taskSoil/artifact/report/child/synthesis/model/tool 摘要；配置缺失仍输出 `status: "skipped"`，强调 provider fetch 前配置边界。

#### 4) 安全投影成为贯穿模型、工具、canvas、transcript 的主线

`src/kernel/redaction.ts:1-9` 提供统一 `redactSensitiveText()`。

`src/kernel/intelligence/safe-visible-output.ts:14-84` 只在模型响应 `completed` 且 validation `passed` 时生成 visible output；否则返回 undefined。

`src/kernel/intelligence/safe-visible-output.ts:48-50` 从 `visibleOutput.fields` 或 `requiredStringFields` 取可见字段，并过滤敏感字段名；`src/kernel/intelligence/safe-visible-output.ts:154-165` 过滤 secret/apikey/token/prompt/reasoning/raw/error 等字段名。

`src/kernel/intelligence/tool-events.ts:24-89` 将工具调用转换为 `tool.requested`、`tool.completed`、`tool.failed` ArborMessage；`src/kernel/intelligence/tool-events.ts:99-120` 将任意值变成 JSON-safe 并按 key 脱敏；`src/kernel/intelligence/tool-events.ts:123-159` 对 string/array/object 做长度、数量、深度裁剪；`src/kernel/intelligence/tool-events.ts:170-192` 在 summary 模式省略 `rawOutput/providerResponse/fullText/html/body/prompt/messages` 等 verbose 输出及派生 title/summary。

#### 5) Panel 从 demo summary 转向“Desktop Agent 工作台”读模型

`src/app/panel-run-jobs.ts:31-50` job 现在保存 `runKind`、`goal`、`aiMode`、`taskSoilInput`、config、informationAccess、runtime、stream events、completed/failed payload。

`src/app/panel-server.ts:306-357` 同步 run 响应包含 observation、tracking、trace、transcript、workNotes、streamCursor、canvas。

`src/app/panel-server.ts:383-428` 异步 start/status 路径使用 runKind 区分 desktop/underground job。

`src/app/panel-canvas-read-model.ts:118-210` canvas 明确组织为 Task Soil -> Plan -> Aboveground -> Fruits -> explanation，不再只展示 EventLog JSON。

### Related Specs

| Spec Path | Related Rule / Direction |
|---|---|
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/guides/agentarbor-governance-guide.md` | 当前产品架构规则写明：`Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil`；当前优先级是 Desktop Shell 单入口闭环。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/observation-read-model.md` | Desktop canvas 可展示 Task Soil goal/context/permission/preview，但必须是安全投影；PanelRunStreamEvent/Transcript 不能展示 hidden reasoning、完整 prompt、provider raw response、API key/token、raw tool output、runtime/store refs。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/soil-store.md` | Task Soil 是当前任务级临时土壤，Global Soil 只能接收治理后长期事实；本轮未实现 Global Soil 写入。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/backend/tool-runtime.md` | ToolCenter / tool events 需要以安全摘要形式进入可见事件流，不能把 raw output 当用户可见主体。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/frontend/component-guidelines.md` | 面板首屏/监督台要服务 Desktop Shell 工作流，展示任务、运行、模型/工具、Plan、结果的可扫读结构。 |
| `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/frontend/quality-guidelines.md` | 前端层延续 no-leak、安全投影、可读性和无横向滚动约束。 |

### What These Changes Are Doing

1. **把 Desktop Shell 从测试 demo 推向真实 agent 工作台入口。** 任务 PRD 明确说“下一轮不是继续证明 demo 能跑，而是让真实 AI 在真实任务入口中跑起来，并让面板成为可用的 agent 工作台”。代码上表现为 Desktop run 默认 `openai-compatible`，新增 real-ai smoke，Panel API/Job/Canvas 全部按 desktop/underground 两类运行组织。

2. **把 Task Soil 提升为 Desktop 输入边界。** 新 helper 将 goal、workspace/file/project/web refs、只读短 preview、permission boundary、global soil refs、run material refs 组装成 Task Soil。Task Soil 不再只是 `runMinimalLoop()` 内部 goal 派生物，而成为 Desktop Shell -> Underground 的明确输入对象。

3. **用安全投影承接真实 AI 与真实上下文带来的泄漏风险。** 本轮新增 redaction、safe-visible-output、tool-events，并把 panel canvas/read model/test/spec 串起来，目标是允许展示“足够有用的模型/工具/上下文摘要”，但不展示 raw prompt、raw provider response、raw file body、raw tool output、secret 或 runtime/store refs。

4. **Panel 正在从结果查看器变为监督台 + main canvas。** `PanelRunCanvasReadModel` 组织 Task Soil、Plan、Aboveground、Fruits 的连续故事；`PanelRunTracking` / transcript / stream events 展示运行树、模型/工具流、失败边界和诊断。

5. **仍保持 Aboveground 最小执行和只读上下文。** PRD out-of-scope 明确不做真实 `.agentarbor/` 文件写入、不让 Aboveground 执行真实文件修改、不扩展完整 Governance/递归 Agent Fabric。代码中的 permission refs 也是声明/边界投影，真实写入仍需 ToolCenter/Aboveground 守卫。

### Whether This Indicates a New Mainline Migration

是，变更明确说明项目正在从 **“fake-AI Desktop demo 闭环”** 迁移到 **“真实 AI 驱动的 Desktop Shell 工作台主线”**。

证据：

- `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/tasks/05-07-task-soil-workspace-context-entry/prd.md:4-6` 明确说要把 Desktop Shell 从 fake-AI demo 推进为真实使用的桌面 Agent 工作流。
- `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/.trellis/spec/guides/agentarbor-governance-guide.md:24-34` 已把主架构固定为 Desktop Shell -> Task Soil -> Underground -> Plan -> Aboveground -> Fruits -> Governance -> Global Soil，并强调当前优先级是 Desktop Shell 单入口闭环。
- `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-server.ts:932-934` 将 Desktop run 默认 AI mode 改为 `openai-compatible`，地下兼容 run 才继续遵循配置默认值。
- `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/real-ai-smoke.ts:7-28` 新增真实 AI smoke，说明真实模型路径成为显式验收入口。
- `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90/src/app/panel-canvas-read-model.ts:118-210` 将面板投影重构为 Task Soil -> Plan -> Aboveground -> Fruits，而不是 demo summary。

这不是迁移到“完整治理/全局土壤写入/多层递归 Agent Fabric”；本轮主线更窄：**真实 Desktop Shell 输入、真实模型配置边界、Task Soil 安全上下文、Panel 可观察工作台**。

## Caveats / Not Found

1. **当前实际 git status 与任务描述存在时间差。** 会话开始快照中显示的未提交变更，在当前 `/z/AgentArbor/.claude/worktrees/agent-ac5f0d90` 已经是 HEAD commit `c8bad99`；`/z/AgentArbor` 当前只剩本研究任务目录未跟踪。因此本报告分析的是“用户点名的变更集合/最新提交内容”，而不是当前仍未提交的代码 diff。

2. **真实 AI smoke 已补成显式脚本。** `package.json` 当前新增 `pnpm smoke:real-ai`，该入口只在用户显式运行时触发 openai-compatible provider，默认测试仍只用 stubbed provider 覆盖真实 smoke contract。

3. **Task Soil 输入支持 refs/preview，但没有发现真实文件 picker、watcher、索引或文件正文装载。** PRD out-of-scope 也明确不引入文件 watcher、索引数据库或后台 daemon；当前路径接收的是 refs/短摘要/只读短 preview。

4. **permissionBoundaryRefs 是输入声明与投影，不等价于执行授权系统。** `task-soil-workspace.ts` 只校验 ref 文本形状；PRD 和错误信息均说明真实写入仍由 Aboveground 和 ToolCenter 守卫。

5. **redaction 是模式匹配式脱敏，不是完整秘密检测。** 当前可见逻辑覆盖常见 key/token/Authorization 形状；未发现熵检测、文件类型解析或 secret vault 反查。

6. **Desktop 默认 openai-compatible 增加配置边界依赖。** `panel-server.ts` 对 Desktop run 默认选择真实 AI；配置缺失时走 `UndergroundAiConfigurationError` 的 400/failed/skipped 路径。PRD 明确这是期望行为，但这意味着无本地模型配置时 Desktop product path 不再“伪成功”。

7. **没有发现 Global Soil 写入、真实 `.agentarbor/` 写入或真实 Aboveground 文件修改。** 这些均仍在 out-of-scope，与本轮“工作台入口/安全投影/真实 AI smoke”范围一致。

8. **Spec 与代码方向高度同步，但本报告未运行测试。** 本研究只使用 git/read/search；未执行 `pnpm build`、`pnpm test` 或 smoke。
