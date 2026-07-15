# Skills 官方兼容加载

## 目的

本文说明 AgentArbor 当前如何消费官方 Agent Skills 兼容包。它只约束默认普通 `agent` 的 Skills 能力底座，不新增 deep、Plan、RAG、Governance 或业务编排承诺。

Skills 是能力包：它提供可复用说明、参考资料、脚本和资产，帮助模型在被选中后更好地完成某类任务。Skills 不是任务生命周期、Plan 交接对象、RAG 索引、长期记忆或 Governance 回流层。

## 目录口径

当前默认发现两类兼容包：

- 用户级：`$HOME/.agents/skills`，适合个人跨项目复用。
- 项目级：`$CWD/.agents/skills`，适合当前仓库/工作目录共享；与用户级同 id/name 冲突时，项目级 precedence 更高。

宿主可以通过 `PanelServerOptions.additionalSkillRoots` 显式追加 `admin`、`plugin` 或其他受管来源；追加 root 会保留默认用户级/项目级发现，并把 `sourceKind/sourceRootId/sourcePrecedence` 写入 frozen catalog。它只是显式受管来源接入，不是 marketplace、installer、自动更新或回滚机制。`PanelServerOptions.skillRoots` 仍是完整覆盖入口，主要用于测试或自定义宿主。

项目级兼容包放在：

```text
.agents/
  skills/
    <skill-name>/
      SKILL.md
      references/
      scripts/
      assets/
      evals/
      agents/openai.yaml
```

要求：

- `<skill-name>` 必须和 `SKILL.md` frontmatter 的 `name` 完全一致。
- `SKILL.md` frontmatter 必须包含 `name` 和 `description`。
- `when_to_use` 可补充自动选择上下文；它进入 frozen skill catalog 的安全 metadata。当前默认确定性选择只按 id/name/description/triggers 匹配，`when_to_use` 主要供显式 opt-in 的模型路由或后续策略使用。
- `disable-model-invocation: true` 表示普通 agent 不应自动选择该 skill；显式 `$skill` 仍可调用。
- `user-invocable: false` 表示不接受用户显式 `$skill` 调用；它仍可被自动选择策略考虑。
- `version` 和 `provenance` 用于记录本地包版本、来源、插件名、registry、revision 等分发事实；它们会进入 frozen skill catalog 的安全投影，但敏感 key（如 path/source/resource/secret/token/key）会被过滤。
- `sourceKind`、`sourceRootId`、`sourcePrecedence` 由加载器根据发现 root 生成，并进入 frozen skill catalog / run capability 投影；显式 opt-in 的模型路由只接收这些安全来源字段，不接收 `sourcePath`。
- `stateKey` 是 skill 启停与 `markUsed` 的 source-qualified 状态键；旧 `skillId` 状态只在没有多来源同 id 歧义时作为兼容回退。
- `license`、`compatibility`、`metadata` 等兼容元数据只作为包级说明，不能变成 AgentArbor 产品事实源。
- `allowed-tools` 是 skill 级工具意图声明：它不能扩张本轮工具边界，也不能替代普通 `agent` 的工具选择。AgentArbor 当前只冻结和审计该声明，不把它当作全 run 工具白名单，也不把它当作 Claude Code 风格免确认授权；未来若实现免确认能力，必须新增 per-tool grant 契约，不能复用全局 `full_access`。
- `agents/openai.yaml` 是平台 UI 元数据；普通 agent runtime 不应依赖它做任务决策。

`.agents/skills` 属于官方 Agent Skills 兼容层，不是 AgentArbor 原生产品语义目录。若某个 skill 的经验要变成长期产品事实，必须进入正式开发指南、ADR 或代码契约，而不是只留在 skill body 中。

## 加载口径

当前采用渐进加载：

1. metadata 常驻：发现阶段只读取安全元数据，例如 `name`、`description`、启停状态和摘要。run snapshot 可以冻结这些安全元数据。
2. 来源、precedence 与状态：默认 root 为用户级 `$HOME/.agents/skills` 和项目级 `$CWD/.agents/skills`；项目级 precedence 高于用户级。当前同 id/name skill 不 merge，选择前会按 precedence 排序并记录 duplicate omitted reason。启停和 `markUsed` 写入 source-qualified `stateKey`，避免用户级和项目级同 id skill 互相串状态。
3. 默认选择：普通 agent 在 runtime / trace 出生后，基于本轮 frozen skill catalog 做确定性 progressive disclosure；显式 `$skill` 直接选择，关键词/触发器命中才加载正文。默认不调用 `skill_routing`，也不把全量 skill 候选发给模型。设置页“基础能力 -> Skills 触发方式”可显式切为语义路由；只有新 run 冻结 `skillTrigger.mode = "model"` 后，`skill_routing` 才作为普通路径的 opt-in 前置路由使用。内部评测仍可显式使用该 router。
4. body 选中后加载：只有本轮普通 agent 选中某个 skill 后，才读取 `SKILL.md` 正文并注入当前用户模型消息。
5. `allowed-tools` 声明审计：若选中的 loaded skill 声明了 `allowed-tools`，普通 agent 只记录和校验这些工具是否存在于本轮 capability / tool / profile / permission / executable 边界内；声明不能让不可见工具变可见，也不能把普通 agent 原本可见的工具隐藏掉。当前不提供 skill 级免确认授权。
6. `references/` 按需读取：只有本轮已选中且成功加载的 skill，才允许模型通过普通只读工具 `read_skill_resource` 读取其 indexed `references/*`。读取结果作为 tool result 回到模型，不在初始模型消息中预注入。
7. `scripts/` 元数据按需读取但不执行：`read_skill_resource` 只返回脚本 hash、大小和“必须经 ToolCenter/确认边界执行”的事实；loader、resolver 和资源工具都不能自动执行脚本。
8. `assets/` 按需使用：资产是输出模板、样例或素材，不默认进入模型上下文；`read_skill_resource` 对 asset 只返回 hash、大小等事实，不返回 raw asset body。
9. `evals/` 本地质量 artifact：loader/doctor 可以索引 `evals/*`、校验、统计并提示缺失，但 `evals/` 不属于运行时资源，不进入 frozen runtime resource index 或模型输入，也不能通过 `read_skill_resource` 读取。

`SKILL.md` frontmatter 使用标准 YAML parser 解析，支持多行字符串、flow mapping、锚点/alias 和 merge。非法 YAML 不应导致发现流程崩溃，而应通过现有校验路径形成 disabled diagnostic。

当前可以宣称：metadata、version、provenance 和本轮可选集合来自 run 创建时冻结的 skill catalog；被选中 skill 的正文加载会校验冻结 hash，hash 不一致时 fail closed 且不注入正文；本轮已选 loaded skill 的 indexed references/assets/scripts 可以通过 `read_skill_resource` 按需读取，并校验 run 创建时冻结的资源 hash，hash 不一致时 fail closed；`evals/` 只用于 loader/doctor 本地质量门校验统计，显式传入模型通道时可复用 `skill_routing` 跑 routing eval；quality/regression case 可以声明 `qualityBaseline`，由 doctor 做 with/without skill 记录完整性、分数差和字面量质量检查。不能宣称 evals 进入 frozen runtime resource index、模型输入或 `read_skill_resource`，不能宣称 references/assets/scripts 会自动进入上下文或自动执行，也不能宣称当前会自动生成 with/without 输出、调用 LLM judge 或评估运行时真实回答质量。

## 当前不做

- 不做 RAG ingest、chunk、embedding、vector store 或 retrieval policy。
- 不用关键词、文件数量或任务复杂度把普通请求自动升级为 deep。
- 不让 skill 脚本在发现、快照或触发阶段自动执行。
- 不让 `read_skill_resource` 读取未选中、未成功加载、omitted、未索引或 hash 不匹配的 skill resource。
- 不让 `read_skill_resource` 读取 `evals/`；eval artifacts 只服务本地质量门和后续评估体系。
- 不让 `allowed-tools` 扩张工具能力，也不让它作为全局白名单削弱普通 agent 的工具可见集合；当前只做冻结、展示、审计和不可用声明 warning。
- 不为 skill body、工具结果或文件正文建立第二套副本；模型实际消费的内容按原样进入 Ordinary `canonicalMessages`，provider 原始 HTTP 响应、secret 与附件字节不持久化。
- 不把 Skills 作为 Plan、Handoff、Governance 或任务编排层。
- 不让 `.agents/skills` 反向定义 AgentArbor 产品语义。
- 不自动扫描 Claude `.claude/skills`、Codex plugin marketplace、enterprise managed skills 或 admin skills；admin/plugin root 只能由宿主显式传入。当前新增或计划中的 local installer 只是本地分发治理原语，不等于 marketplace；远程 registry、自动更新、回滚和 enterprise managed skill 分发仍是后续能力。

## 作者检查清单

新增或修改 skill 包时检查：

- 目录名与 `name` 对齐，使用小写字母、数字和连字符。
- `description` 说明 skill 做什么，以及哪些请求会触发它。
- body 保持简洁，写清楚执行步骤和边界。
- 详细规则进入 `references/`，正文只说明何时读取。
- 可重复、确定性的辅助逻辑进入 `scripts/`，并在正文说明脚本不会自动执行。
- 输出模板、示例素材或可复制资源进入 `assets/`。
- 可重复 workflow 建议补 `evals/` 样例输入、期望断言或验收说明；这只是质量 artifact，不要在正文里要求运行时读取它。
- 不在 skill 中写入 deep、Plan、RAG、Governance 的当前实现承诺。

`evals/*.json` 的当前最小格式是：

```json
{
  "cases": [
    {
      "id": "select-review",
      "kind": "routing",
      "goal": "Please review this change.",
      "expected": { "selected": true }
    },
    {
      "id": "review-quality",
      "kind": "quality",
      "goal": "Review a patch with a subtle boundary regression.",
      "expected": {
        "contains": ["boundary"],
        "notContains": ["auto-execute scripts"],
        "minScore": 0.75,
        "rubric": "The answer should identify material boundary drift."
      },
      "qualityBaseline": {
        "withoutSkill": {
          "score": 2,
          "summary": "Generic review misses the Skills runtime boundary.",
          "outputSample": "Looks generally fine."
        },
        "withSkill": {
          "score": 4,
          "summary": "Flags boundary drift and avoids overclaiming script execution.",
          "outputSample": "This crosses the Skills boundary and must not auto-execute scripts."
        },
        "minDelta": 1
      },
      "qualityChecks": {
        "withSkill": {
          "mustInclude": ["Skills boundary"],
          "mustNotInclude": ["current runtime auto-executes scripts"]
        }
      }
    }
  ]
}
```

`kind` 当前只接受 `routing`、`quality` 或 `regression`。`routing` case 应设置 `expected.selected: true|false`，用于验证 skill 是否应被选择；doctor 默认只做结构和断言存在性检查，显式传入模型通道时可以通过 `skill_routing` 执行 routing eval。`quality` / `regression` case 应设置 `qualityBaseline.withSkill`、`qualityBaseline.withoutSkill`、`score`、`summary` 和可选 `minDelta`，用于记录人工或离线生成的 with/without skill 基线；`qualityChecks.withSkill.mustInclude/mustNotInclude` 只做字面量检查。doctor 不生成两份真实回答，不执行脚本，不调用 LLM judge，也不把 `outputSample` 原文投影到报告中。

## 验收说明

文档或样例变更完成后至少检查：

```powershell
git diff --check
pnpm build:node
node --test dist/app/skills/skill-doctor.test.js dist/app/skills/skill-loader.test.js dist/app/skills/skill-router.test.js dist/app/skills/skill-resource-resolver.test.js dist/app/capability-center.test.js dist/app/capability-policy.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\skills\agentarbor-skill-package-check\scripts\validate-agentarbor-skills.ps1
```

若本地 Python 环境已安装 `PyYAML`，再运行官方 skill 快速校验：

```powershell
$QuickValidate = Join-Path $env:USERPROFILE ".codex\skills\.system\skill-creator\scripts\quick_validate.py"
python $QuickValidate .agents\skills\<skill-name>
```

如果 `.agents/` 仍被 `.gitignore` 忽略，样例 skill 默认只是本地开发态文件。主线程若要共享这些样例，应显式决定是 `git add -f .agents/skills/...`，还是在单独提交中调整忽略策略。

`runSkillDoctor` 是当前最小质量门：它做本地确定性诊断，检查 invalid 包、缺少路由提示、不可调用组合、缺失 declared resources、缺少或格式错误的 `evals/` artifact、过大正文、缺失/非法 `qualityBaseline`、baseline delta 不达标和字面量质量检查失败。传入 `intelligenceChannel` 时，它还会用正式 `skill_routing` 路径执行 routing eval cases。它不自动生成 with/without 输出，不调用 LLM judge，也不替代后续真实回答质量回归体系。

## 当前样例

本工作树提供两个项目级样例：

- `.agents/skills/agentarbor-boundary-review`：用于审查 AgentArbor 默认普通 agent、命名和平台适配边界。
- `.agents/skills/agentarbor-skill-package-check`：用于验收 `.agents/skills` 包结构、加载口径和交付说明。
