# P1: 地下信息获取运行时 ResearchRuntime MVP

## Goal

把地下组织的信息获取能力从“逐个暴露工具”升级为统一 ResearchRuntime。地下 agent 面向 `search` / `read` 两个稳定信息动作，底层由 ResearchRuntime 分发到 web、网页读取、代码库、文档/包/GitHub stub、Soil / RunMemory stub 等信息源；工具输出只能作为候选材料和 evidence/source refs，不能绕过 CandidatePool、Convergence Judge、Direction Handoff validation 或后续治理门。

## Requirements

- 新增 ResearchRuntime / InformationAccess 契约，表达 `InformationQuery`、`InformationSource`、`SearchResultRef`、`ReadResultRef` 和 `ResearchTrace`。
- 模型可见工具收敛为 `search` / `read`，不再把 `web_search` / `page_reader` 作为地下 prompt 的主入口。
- 第一版 source adapter 覆盖：
  - `web`：复用 Tavily-backed web search；无 key / 无 fetch 时降级为 no-provider。
  - `page`：读取 `http/https` 页面，清洗正文并截断；不做浏览器渲染、登录、Cookie、SPA。
  - `codebase`：repo 内文本搜索 MVP。
  - `soil` / `run_memory`：先用现有只读 Soil 或 stub 建立接口边界。
  - `docs` / `packages` / `github`：本轮建立 stub / no-provider 输出，不接真实 provider。
- ToolCenter 保持 app 层集成中心，注册 `search` / `read` 两个 ResearchRuntime-backed tools；底层 source adapter 不污染 domain / kernel。
- 地下 rootlet prompt 改成围绕 7 类信息需求：真实世界案例、实现方式、项目现状、技术文档、现成库、已知问题、历史类似任务。
- 面板配置只暴露“信息源配置”；第一版支持 Tavily key 存入 secret store，HTTP JSON 和 panel 不回显 raw key。
- 地下运行启用 AI 时使用 configured ToolCenter；无 Tavily key 时继续运行并产生降级结果，不报错。
- EventLog / Observation / panel 只展示 query、source、ref、status、短摘要和调用链，不展示 API key、raw provider response、完整页面正文或完整 prompt。

## Acceptance Criteria

- [ ] ResearchRuntime 覆盖 source 分发、source 偏好、无 provider 降级、search refs、read refs 和 trace 串联。
- [ ] ToolCenter 注册 `search` / `read`，模型可通过 `search -> read -> final output` 形成候选。
- [ ] web / page / codebase / soil-run-memory / docs-packages-github stub source adapter 有 focused tests。
- [ ] rootlet AI 使用统一 `search` / `read` 信息工具；candidate source/evidence refs 指向 `research:*` refs，不包含 raw output。
- [ ] ConfigCenter 支持 Tavily 信息源配置，raw key 只进入 secret store。
- [ ] Panel API / HTML 支持信息源配置，并证明不泄漏 secret。
- [ ] Summary / panel tracking 展示 research/tool trace 安全摘要。
- [ ] no-AI deterministic 路径不变，无 Tavily key 不报错。
- [ ] `pnpm build`、`pnpm test`、`pnpm panel:smoke`、`git diff --check` 或当前环境等价命令通过。

## Definition of Done

- 代码实现、测试、spec、任务看板同步完成。
- 不引入新包管理器、测试框架、外部 LLM SDK、MCP SDK、浏览器自动化依赖或真实包/GitHub provider。
- 不创建 repo-root `.agentarbor/` 运行资产。
- 不自动提交，不自动归档；提交和归档由用户另行确认。

## Technical Approach

- 在 `src/domain/research/` 放统一信息获取领域契约；`domain` 不依赖 fetch、ToolCenter 或 app。
- 在 `src/app/research/` 放 ResearchRuntime、source adapters 和 configured ToolCenter helper；app 组合根负责读取配置、注册 source 和暴露 tools。
- 保留 `src/app/tool-center/` concrete registry；ResearchRuntime-backed `search` / `read` 是 ToolExecutor。
- 扩展 ConfigCenter v2 以保存 information source settings 和 Tavily secret metadata；v1 settings 必须兼容读取。
- 地下 session / panel run 使用 configured ToolCenter factory 注入 AgentTurnRuntime。
- 更新 `src/app/underground/intelligence-prompts.ts`，将 prompt 从具体工具名转为信息需求和 `search` / `read` 动作。
- 更新 `.trellis/spec/backend/tool-runtime.md`，并新增或扩展 information access 契约说明。

## Decision (ADR-lite)

**Context**：上一轮已经实现 ToolCenter、web_search、tool loop 和 AgentTurnRuntime。如果继续按 `web_search`、`page_reader`、`codebase_search`、`doc_lookup` 逐个暴露工具，模型会面对不断膨胀的工具清单，信息链路也无法统一审计。

**Decision**：本轮引入 ResearchRuntime，把地下组织需要的信息获取抽象为 `search` / `read`，底层 source adapters 承接 web、page、codebase、docs、packages、github、Soil / RunMemory。

**Consequences**：第一版会保留部分 source stub，以换取稳定抽象和端到端链路；后续接 GitHub、包注册表和文档 provider 时，不改变模型可见工具入口。

## Out of Scope

- 不实现完整 MCP client/server。
- 不实现工具市场 UI。
- 不实现浏览器渲染、Cookie、登录态、表单交互或 SPA 支持。
- 不实现真实 GitHub token、npm registry、社区讨论、Context7 等 provider 集成。
- 不改造地上组织，不实现 Nutrient Request / Growth Plan Revision。
- 不把 research raw output 直接写入 Direction Handoff、Growth Plan、Fruit、Run Memory、Experience Candidate、Capability Asset 或 Soil。

## Technical Notes

- Relevant specs: `.trellis/spec/backend/directory-structure.md`, `intelligence-channel.md`, `tool-runtime.md`, `underground-radial-growth.md`, `observation-read-model.md`, `quality-guidelines.md`.
- Existing foundations: `src/domain/tools/`, `src/app/tool-center/`, `src/kernel/intelligence/agent-turn-runtime.ts`, `src/app/underground/intelligence-prompts.ts`, `src/app/config-center.ts`, `src/app/panel-server.ts`.
