# AGENTS.md

## 根规则

局部的最优解往往不是全局的最优解，AgentArbor 的开发必须统领全局；任何计划、代码、文档、agent、skill、workflow 或平台适配变更，都不能为了眼前方便留下结构性技术债；所有的代码必须按照规范开发，不同的功能按照模块化进行开发，长期代码结构必须写好关键注释。

交付必须完整、清楚、可继承。不能只做“能用”的最小改动后留下索引不清、职责不明、边界不清、验证缺失或残留规则。

## 功能模块化开发原则

AgentArbor 的模块化首先是按功能闭环模块化，其次才是按技术层分层。`domain`、`app`、`kernel`、`adapters` 等横向层只能作为实现手段，不能取代功能所有权；每个长期功能模块都应尽量拥有自己的输入输出契约、运行过程、证据链、验证门、可观察投影和测试边界。

横向基础设施负责提供可复用能力，例如事件、消息、状态机、工具运行、模型运行、外部协议适配、配置和审计；纵向功能模块负责完成业务闭环，例如 Desktop Shell、Task Soil、Underground Cognitive Runtime、Plan、Aboveground Execution Runtime、Fruits、Governance Pipeline、Global Soil 和 Observation Panel。开发时必须优先判断当前变更属于哪个功能闭环，避免为了追随横向分层而把同一功能拆散到多个无主文件中。

大模型接入层必须作为独立功能模块演进，而不是被视为普通 provider adapter 的附属实现。模型运行时应独立承担模型接入、provider 选择、配置边界、流式输出、模型-工具-模型多轮运行、输出脱敏、结构化校验、可见输出投影、模型事件和失败归一化等职责。Underground、Aboveground、Verification、Governance、Panel 等模块只能通过模型运行时契约使用模型能力，不能直接绑定外部 LLM SDK、provider 私有字段或临时流式协议。

不同模块之间必须通过强契约互信：调用方应相信被调用模块会履行自己的契约，并按标准结果返回成功、失败、取消、预算耗尽或验证失败；调用方只处理本模块的业务决策，不能因为不信任其他模块而复制其职责、重建其内部规则或绕过其边界。确定性工程规则应保护 Agent 的权限、预算、证据、审计、验证和治理边界，不能替代 Agent 的目标理解、方案探索、工具选择、计划草案和反思能力。

禁止工程边界替 Agent 思考。schema、类型、状态机、validation、budget、permission、脱敏、fallback、关键词规则和文件边界只能说明“什么不能越界、如何记录、如何失败、如何交接”，不能承担“用户真正要什么、候选之间如何取舍、是否继续探索、该调用什么工具、风险如何权衡、方向如何综合”等 agent 语义职责。

禁止以“安全投影”“摘要化”“产品化文案”或“鲁棒性”为名削弱模型能力。模型明确返回给用户可见的正文、思考摘要、工具前说明、工具后综合、风险判断和不确定性表达，应尽量按原意、原结构和自然节奏呈现；工程层只能做最低必要的边界保护，例如密钥、token、raw prompt、raw provider response、raw tool output、stdout/stderr 和未经授权文件正文不能泄露。不得把正常模型输出吞掉、改写成空泛状态、折叠成伪摘要，或用固定规则替代模型自己的判断、表达和行动选择。

## 协作规则

用户主要负责方向调整、价值判断和边界确认；AI 开发者负责把方向转化为可落地的架构、文档、任务计划和实现路径。

用户输入是重要方向信号，但不是唯一标准。AI 开发者必须主动校验架构一致性、长期可维护性、目录边界、运行契约、验证证据和潜在技术债；当发现更优方向、局部最优风险、边界混乱、文档膨胀或实现风险时，必须主动提醒并给出理由和替代方案，不能把用户的临时想法直接固化为最终架构。

讨论中的想法只有在进入对应事实源后才成为项目事实：长期架构进入 ADR，当前开发口径进入开发指南，当前任务边界进入任务契约，运行行为进入代码实现。任务契约只约束当前任务，不能替代长期产品架构；未落入事实源的讨论只能作为上下文输入，不能替代正式文档和验证。

## 项目定位

AgentArbor 是桌面通用 Agent / 桌面任务工作台。用户从统一 Desktop Shell 输入任务和工作区上下文；当前默认普通 `agent` 先完成连续会话、模型工具循环、确认、安全投影、持久化和工作台结果展示；长期 deep / Agent 集群能力保留为显式深入模式，由 Underground Cognitive Runtime 做目标成形、动态派生 child/rootlet agent、多路探索、父层综合和裁决，形成 Plan，再由 Aboveground Execution Runtime 消费 Plan 执行交付，产出 Fruits；运行结果经过 Governance Pipeline 后，只有通过治理的经验才回流 Global Soil。

当前正式产品主线是：

```text
Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil
```

长期产品架构事实源是 `docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md`；当前活跃实现路线是 `docs/架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md`。当前阶段优先打磨默认普通 `agent`；deep / Agent 集群是长期能力边界，不是废弃方向，但当前不做默认入口、不自动触发、不主动扩展后端，除非用户重新明确启动 deep 工作。ADR-0018 只保留为历史概念树和植物语义来源。

Agent 口径必须区分产品架构和实现命名：保留 deep / Agent 集群长期架构，不等于把普通文件编辑、helper、adapter、状态更新或一次模型工具循环包装成 Underground、Plan、Handoff、atomic mutation 或其他超出实际职责的概念名。`atomic` 只能用于真正有全成功/全失败、回滚或一致性边界的场景；普通用户可见动作优先使用“编辑”“补丁”“变更集”等朴素名称。当前正式口径见 `docs/开发指南/01-基础/05-Agent口径与命名.md`。

开发前必须先读：

- `docs/README.md`
- `docs/开发指南/README.md`
- `docs/开发指南/00-总览.md`
- `docs/开发指南/01-基础/README.md`
- `docs/开发指南/01-基础/05-Agent口径与命名.md`
- `docs/开发指南/02-核心闭环/README.md`
- `docs/开发指南/03-系统架构/README.md`
- `docs/开发指南/04-模型与契约/README.md`

## 标准结构

```text
/
  AGENTS.md
  README.md
  docs/
  .trellis/
  .agents/
  .codex/
  .opencode/
  .claude/
  .agentarbor/
  src/
```

## 目录边界

- `docs/`：人类可读的正式开发指南、任务看板、研究资料和架构设计。
- `.trellis/`：历史 Trellis 工作流和规范材料。`.trellis/tasks/` 不再作为当前开发约束、任务源或上下文入口；开发者不能依据其中旧 PRD/任务状态覆盖当前产品方向。
- `.agents/`：官方 Agent Skills 兼容层，只放 `skills/` 和未来可选 `plugins/`。
- `.codex/`：Codex 开发适配层。
- `.opencode/`：OpenCode 开发适配层。
- `.claude/`：Claude Code 开发适配层。
- `.agentarbor/`：未来 Plan Package 的实现/存储形态或目录名，用于保存可持久化 Plan、引用、谱系、validation 和审计材料；不保存最终资产，不替代 Task Soil 或 Global Soil。只有契约稳定、有真实出生依据和显式写入授权时才增量创建。
- `src/`：AgentArbor TypeScript 实现代码。当前已有确定性最小运行内核作为状态、验证、审计和兜底基础；Underground Cognitive Runtime 重构必须在该基础上推进 AI 驱动的 agent 协作主线。

禁止把这些层混用。平台适配文件不是 AgentArbor 原生产品事实源，未来运行时资产也不能替代当前开发文档。

`.trellis/tasks/` 是历史任务材料，不再参与当前开发流程；`.trellis/spec/` 中仍有价值的工程规则只能作为参考，不能覆盖 `AGENTS.md`、`docs/开发指南/` 和当前用户指令。`.agents/`、`.codex/`、`.opencode/`、`.claude/` 和 `.agentarbor/` 默认仍作为本地开发态点目录被忽略，不等于当前产品源码基线的一部分。若其中某类模板、初始化说明或 AgentArbor 原生运行时资产需要成为团队共享契约，必须先明确目录职责、读写规则、验证方式和提交范围，再调整忽略规则并单独提交。

## 文档规则

`docs/` 必须保持开发前清爽，但“清爽”不等于删除有长期参考价值的研究和未来态材料。

- 顶级只保留 `README.md` 和必要中文目录。
- 目录名、文档名和正文默认使用简体中文，`README.md` 作为索引文件例外。
- `docs/开发指南/` 只保存当前稳定开发口径。
- `docs/任务看板/` 仅保留历史看板说明，不再作为当前开发入口或任务源。
- `docs/研究资料/` 保存研究报告、工程研究、外部参考研究和有长期参考价值的材料。
- `docs/架构设计/` 保存长期架构决策、协议边界、工作区结构和植物学融合架构。
- 历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不保留在 `docs/` 活跃知识面中。
- 阶段推进、任务续接、检查点和工作流状态不再由 `.trellis/tasks/` 管理；不新增根目录 `Plan/` 或 `Plans/` 作为第二套计划入口。新的开发计划应进入正式开发指南、ADR、任务契约文档或代码实现边界，而不是恢复 Trellis task 流程。
- 资料只有在具有明确架构或研究价值时才保留；对未来开发没有用的材料必须删除。
- 文档索引必须准确指向当前存在的文件。
- 文档内容必须能指导实现，不能只保留口号、历史过程或无主张材料。

此外，根目录必须长期维护 `CURRENT_RUNTIME_MODE.md`，用于说明“当前软件实际如何运行”。该文件是当前默认运行方式、默认入口、默认主执行引擎、普通 Agent 完成语义、前后端职责和默认产品边界的根级事实说明。未来默认运行方式或运行边界发生稳定变化时，必须先更新该文件，再更新代码与其他开发文档。后续开发者在理解当前软件运行方式时，应先阅读该文件，而不是先翻代码。

## 开发边界

- 当前仓库已进入运行时代码实现。根目录工具链使用 `pnpm + TypeScript + tsc + node:test`；确定性最小内核是工程守卫和 fallback，不是 agent 智能主线。
- 不引入新的包管理器、构建系统、运行时代码框架或测试框架，除非用户明确要求扩展实现阶段。
- 实现以 TypeScript 自研架构为主。
- 外部模型、工具、协议和平台通过 adapter 接入，不能反向污染核心领域模型。
- `.agentarbor/` 不提前填充占位 agent、workflow、memory 或 schema；Plan Package 也必须等契约稳定、真实任务出生和显式写入授权后再增量创建。
- 新增或修改 Codex skill 时，只改 `.agents/skills/`，并遵守 Agent Skills 标准。
- 新增 Codex custom subagent 使用 `.codex/agents/*.toml`。
- 新增 OpenCode 适配内容使用 `.opencode/`。
- 新增 Claude Code 适配内容使用 `.claude/`。
