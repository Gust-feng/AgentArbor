# AGENTS.md

## 根规则

局部的最优解往往不是全局的最优解，AgentArbor 的开发必须统领全局；任何计划、代码、文档、agent、skill、workflow 或平台适配变更，都不能为了眼前方便留下结构性技术债；所有的代码必须按照规范开发，不同的功能按照模块化进行开发，长期代码结构必须写好关键注释。

交付必须完整、清楚、可继承。不能只做“能用”的最小改动后留下索引不清、职责不明、边界不清、验证缺失或残留规则。

## 协作规则

用户主要负责方向调整、价值判断和边界确认；AI 开发者负责把方向转化为可落地的架构、文档、任务计划和实现路径。

用户输入是重要方向信号，但不是唯一标准。AI 开发者必须主动校验架构一致性、长期可维护性、目录边界、运行契约、验证证据和潜在技术债；当发现更优方向、局部最优风险、边界混乱、文档膨胀或实现风险时，必须主动提醒并给出理由和替代方案，不能把用户的临时想法直接固化为最终架构。

讨论中的想法只有在进入对应事实源后才成为项目事实：长期架构进入 ADR，当前开发口径进入开发指南，当前任务边界进入任务契约，运行行为进入代码实现。任务契约只约束当前任务，不能替代长期产品架构；未落入事实源的讨论只能作为上下文输入，不能替代正式文档和验证。

## 项目定位

AgentArbor 是目标驱动的 Agent / AgentApp 孕育与演化平台。它围绕用户想象、受治理土壤、地下中枢、`.agentarbor` 方向交接包、地上中枢、地上生长、果实、治理回流、验证证据、Run Memory、Path Bias、Capability Asset、谱系记录和可控导出构建，不是聊天机器人、提示词集合、外部平台配置仓库、一次性脚手架或短期演示工程。

当前正式树形语义是：

```text
Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil
```

当前产品架构事实源是 `docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md`；活跃开发指南必须承接该 ADR 的稳定结论。

地下中枢负责把用户想象转为可判断目标、约束、证据和方向，并在授权边界不清、目标冲突或关键事实不足时询问用户。`.agentarbor` 是地下中枢交给地上中枢的方向交接包，不是最终资产仓库，也不是 Soil 的副本。地上中枢负责把方向交接包转为 Growth Plan、Workflow IR、上下文拓扑、执行组织、验证门和修订机制。Fruits 只是交付物、AgentApp、能力包或经验候选；只有经过 Governance 的果实才能以 Capability Asset、Path Bias、长期约束或验证证据形式进入 Soil。

约束工程贯穿 Soil、Underground Center、`.agentarbor`、Aboveground Center、Fruits、Governance 和回流后的 Soil。目标、非目标、权限、成本、技术边界、安全要求、人工确认、验收门和资产治理不能停留在自然语言备注中；它们必须能通过 Constraint / ConstraintRef 被引用、分发、执行、验证和沉淀。Path Bias 只能影响 preference 和方案排序，不能覆盖 hard constraint。

开发前必须先读：

- `docs/README.md`
- `docs/开发指南/README.md`
- `docs/开发指南/00-总览.md`
- `docs/开发指南/01-基础/README.md`
- `docs/开发指南/02-核心闭环/README.md`
- `docs/开发指南/03-系统架构/README.md`
- `docs/开发指南/04-模型与契约/README.md`
- `docs/任务看板/README.md`
- `docs/任务看板/看板.md`

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
- `.trellis/`：当前 AI 开发工作流、任务上下文和项目规范。
- `.agents/`：官方 Agent Skills 兼容层，只放 `skills/` 和未来可选 `plugins/`。
- `.codex/`：Codex 开发适配层。
- `.opencode/`：OpenCode 开发适配层。
- `.claude/`：Claude Code 开发适配层。
- `.agentarbor/`：未来 AgentArbor 原生方向交接包目录，负责从地下中枢向地上中枢传递方向、约束、证据和 Growth Entry；不保存最终资产，不替代 Soil。只有契约稳定、有真实出生依据时才增量创建。
- `src/`：AgentArbor TypeScript 实现代码。当前第一阶段只包含确定性最小运行内核、内存版闭环、事件、状态、产物、验证和治理回流。

禁止把这些层混用。平台适配文件不是 AgentArbor 原生产品事实源，未来运行时资产也不能替代当前开发文档。

当前 `.trellis/spec/`、`.trellis/tasks/`、`.trellis/scripts/`、`.trellis/workflow.md`、`.trellis/config.yaml`、`.trellis/.version` 和 `.trellis/.gitignore` 是共享 Trellis 事实源；`.trellis/.runtime/`、`.trellis/workspace/`、`.trellis/.developer` 和 `.trellis/.current-task` 继续作为本地运行态忽略。`.agents/`、`.codex/`、`.opencode/`、`.claude/` 和 `.agentarbor/` 默认仍作为本地开发态点目录被忽略，不等于当前产品源码基线的一部分。若其中某类模板、初始化说明或 AgentArbor 原生运行时资产需要成为团队共享契约，必须先明确目录职责、读写规则、验证方式和提交范围，再调整忽略规则并单独提交。

## 文档规则

`docs/` 必须保持开发前清爽，但“清爽”不等于删除有长期参考价值的研究和未来态材料。

- 顶级只保留 `README.md` 和必要中文目录。
- 目录名、文档名和正文默认使用简体中文，`README.md` 作为索引文件例外。
- `docs/开发指南/` 只保存当前稳定开发口径。
- `docs/任务看板/` 只保存从 `.trellis/tasks/` 派生的人类态势看板资产，用于展示前置任务、当前任务和未来方向，不保存计划源数据。
- `docs/研究资料/` 保存研究报告、工程研究、外部参考研究和有长期参考价值的材料。
- `docs/架构设计/` 保存长期架构决策、协议边界、工作区结构和植物学融合架构。
- 历史经验、推进记录、阶段计划、会话沉淀、草案包和准备包不保留在 `docs/` 活跃知识面中。
- 阶段推进、任务续接、检查点和工作流状态由 `.trellis/` 管理；不新增根目录 `Plan/` 或 `Plans/` 作为第二套计划入口。每次 Trellis 阶段推进、任务切换、完成或归档后，应使用 repo-local skill `trellis-task-board` 刷新 `docs/任务看板/看板.md`，并在看板结构或规则变化时同步检查 `docs/任务看板/README.md` 与 `docs/任务看板/规则.md`。
- 资料只有在具有明确架构或研究价值时才保留；对未来开发没有用的材料必须删除。
- 文档索引必须准确指向当前存在的文件。
- 文档内容必须能指导实现，不能只保留口号、历史过程或无主张材料。

## 开发边界

- 当前仓库已进入第一阶段运行时代码实现。根目录工具链使用 `pnpm + TypeScript + tsc + node:test`，当前代码范围限制为确定性最小运行内核。
- 不引入新的包管理器、构建系统、运行时代码框架或测试框架，除非用户明确要求扩展实现阶段。
- 实现以 TypeScript 自研架构为主。
- 外部模型、工具、协议和平台通过 adapter 接入，不能反向污染核心领域模型。
- `.agentarbor/` 不提前填充占位 agent、workflow、memory 或 schema；方向交接包也必须等契约稳定和真实任务出生后再增量创建。
- 新增或修改 Codex skill 时，只改 `.agents/skills/`，并遵守 Agent Skills 标准。
- 新增 Codex custom subagent 使用 `.codex/agents/*.toml`。
- 新增 OpenCode 适配内容使用 `.opencode/`。
- 新增 Claude Code 适配内容使用 `.claude/`。

## 能力治理硬规则

- 临时执行能力只属于当前任务工作区。
- Run Memory 是单次运行后的经验摘要，不能直接等同长期资产。
- Experience Candidate 是可复用经验候选，必须经过验证、去重、归因和治理。
- Capability Asset 是进入土壤的正式能力资产，必须有来源、输入输出契约、权限边界、版本、评估和退役路径。
- Path Bias 只能牵引下一次相似任务，不得机械复刻历史流程。
- Path Bias 不能覆盖 hard constraint；soft constraint 的偏离必须记录理由和证据，preference 只能影响默认选择或方案排序。
- Ring Memory 只能作为 EventLog、Run Memory 和 Experience Candidate 的聚合视图，不能成为新的平行事实源。
- 地下中枢方向材料不是长期资产，也不是 Growth Plan。
- Nutrient Request 是地上组织向地下中枢请求养料的运行期机制，不是推倒重来，也不是地上自建方向探索集群；它必须产出 Nutrient Patch、新的方向交接包版本或明确无需补充的证据。
- Growth Plan Revision 必须引用具体方向交接包版本或 Nutrient Patch，并记录继续、回退、分叉或停止的依据。
- 成熟子 agent 是能力资产的一种，可以成为果实，但脱离母体运行时必须经过显式治理。
- 脱离子 agent 默认不继承母体运行时权限、密钥、资产图、历史任务或注册表写权限。
- Codex、OpenCode 或其他平台 agent 文件只是适配输出，不是 AgentArbor 原生 agent 事实源。

## 收尾协议

完成任何非琐碎变更前，必须确认：

1. 用户目标已被当前变更满足。
2. 相关索引指向真实存在的文件。
3. `docs/` 没有重新出现过程残留、历史流水、经验库或演示资产。
4. JSON、YAML、TOML、Markdown 链接和 skill frontmatter 已按影响范围验证。
5. 没有把平台适配层写成 AgentArbor 产品源数据。
6. 没有提前创建无契约、无权限、无验证依据的未来运行时资产。

除非用户明确要求，不把开发流水或经验记录放进当前开发入口；但对 AgentArbor 未来态有参考价值的研究材料必须进入资料库，而不是被删除。

## 禁止事项

- 不把 AgentArbor 自定义 registry、workflow、memory 或 schema 伪装成 Codex、OpenCode 或 Agent Skills 官方协议。
- 不在 `.agents/` 下放除 `skills/` 和可选 `plugins/` 之外的内容。
- 不把 AgentArbor 原生 agent 放入 `.codex/agents/` 或 `.opencode/agents/`。
- 不用平台适配文件替代 AgentArbor 原生产品语义。
- 不让临时 prompt 代替正式 agent、skill 或能力契约。
- 不记录隐藏思维链、密钥、凭证或用户未授权的隐私数据。
