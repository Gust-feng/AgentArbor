# 方向交接包契约

本文件记录 V0.2 已出生的 `.agentarbor` Direction Handoff Package 运行时契约，并补充用户澄清恢复后的 package 谱系规则。它是地下中枢向地上中枢交付方向的边界，不是 Growth Plan、最终资产库或 Soil 副本。

## Scenario: Direction Handoff Package

### 1. Scope / Trigger

- Trigger：修改 `DirectionHandoffPackage`、交接包 store、Aboveground planning 输入、`.agentarbor` 文件契约或相关测试。
- Scope：内存默认路径和显式根目录文件系统 store；不包含真实仓库根 `.agentarbor/` 生命周期、真实 LLM、数据库、UI 或外部 adapter。
- Phase boundary：Direction Handoff Package 是地下独立闭环的交付物。当前默认 runtime / demo 只使用内存 store 或测试显式传入的临时根目录；真实 repo-root `.agentarbor/` 写入必须另有显式输出根目录、任务出生依据和治理授权。

### 2. Signatures

- `DirectionHandoffPackage`：包含 `manifest`、`lineage`、`directionHandoff`、`convergenceReview`、`candidateReferenceIndex`、`files`、`validation`。
- `DirectionHandoffPackageRef`：可在 EventLog、Observation 和 lineage 中引用 package，包含 package id、direction id、version、status 和 schema version。
- `DirectionHandoffPackageLineage`：记录 `current`、可选 `previous`、`revisionReason`、`sourceRefs` 和 `createdAt`。
- `DirectionHandoffPackageValidationResult`：包含 `passed: boolean`、`checkedAt: string`、`errors: DirectionHandoffPackageValidationIssue[]`、`warnings: DirectionHandoffPackageValidationIssue[]`。
- `DirectionHandoffPackageStore` API 固定为 `save(pkg)`、`load(directionId, version)`、`listVersions(directionId)`、`validate(pkg)`。
- `candidateConstraintRefs`：地下端交接给后续链路的约束候选 refs，当前必须覆盖 `direction_handoff`、`growth_plan`、`task_assignment`、`tool_execution`、`verification`、`fruit_governance`、`soil_promotion` 七个 gate。
- 默认 runtime 使用 `InMemoryDirectionHandoffPackageStore`；`FileSystemDirectionHandoffPackageStore` 必须显式传入 root directory。
- `resolveDirectionHandoffPackageDirectory(rootDirectory, directionId, version)` 与 `resolveDirectionHandoffPackageMetaPath(rootDirectory, directionId, version)` 是文件系统 store 布局 helper；CLI、summary 和测试需要路径时必须复用它们，不得复制私有目录规则。
- `src/domain/agentarbor/direction-handoff-package.ts` 是兼容 barrel；真实职责拆到 `schema`、`contracts`、`builder`、`validation`、`serialization`、`in-memory-store`、`file-system-store` 和 `errors`。

### 3. Contracts

- 包文件清单固定为 `handoff.meta.json`、`direction.md`、`options.json`、`decision-record.md`、`constraints.json`、`soil-refs.json`、`evidence-index.md`、`risk-register.md`、`open-questions.md`、`escalation-rules.md`、`growth-entry.json`。
- `options.json`、`decision-record.md`、`risk-register.md` 的角色只能是 `direction_evidence`，不能承载 Growth Plan。
- `soilRefs` 只能保存字符串引用；不能内联 Soil asset 的 `content`、`body`、`copy` 或等价字段。
- Aboveground planning 只能通过 `directionId + version` 从 store 读取已批准并通过校验的 package，不能接收临时手拼的 `DirectionHandoff`。
- validation module 只负责校验和校验结果附着；serialization module 只负责渲染 package 文件视图；store module 只负责保存、加载、版本列表和按 Store API 委托校验。
- `handoff.meta.json` 是 V0.2 文件系统 store 的 canonical payload；其他 split files 是给人类和后续运行时读取的视图，不能反向成为第二事实源。
- package schema version 暂不因 lineage 增量改名，仍使用 `direction-handoff-package/v0.2`；lineage 是 canonical payload 的字段，必须由 builder 统一填充。
- 初始 package 的 `lineage.revisionReason` 必须是 `initial`，且不得有 previous。
- 用户澄清回答后的新版 package 必须保持同一 `directionId`、版本号递增、`lineage.revisionReason = "user_clarification_answered"`，并在 `previous` 指向 v1 awaiting-user package。
- `lineage.sourceRefs` 必须记录本次版本来源，例如 previous package、previous convergence review、clarification request、`user_approval.received` 和回答证据 refs。
- approved DirectionHandoffPackage 的创建 / 保存是当前地下独立闭环的完成标志；后续 Aboveground planning 只能接管它，不能把未批准 package、临时 handoff 材料或根须原始输出当作闭环完成。
- Direction Handoff 的 `clarifiedGoal`、`nonGoals`、`assumptions`、`risks`、`options` 和 `missingInformation` 必须由 GoalIntentProfile、CandidatePool 和 ConvergenceReport 派生；固定 minimal 文案只能作为没有 profile 的兼容 fallback。
- 文件系统 store 的 root directory 是调用方必须显式提供的运行边界。没有显式 root directory、任务出生依据和写入授权时，任何 demo、默认 runtime 或测试 helper 都不得写入仓库根 `.agentarbor/`。
- 文件系统 store 的 canonical payload 路径是 `<root>/directions/<encoded directionId>/v<version>/handoff.meta.json`；对外展示或断言该路径时必须通过导出的 resolver 获取。
- store API 固定保持 `save(pkg)`、`load(directionId, version)`、`listVersions(directionId)`、`validate(pkg)`；不得为了谱系增加平行读取接口。
- validation 不能只相信 `directionHandoff.status` 或 `manifest.status`；必须同时校验 `convergenceReview.outcome`、`userEscalationRequired`、`userClarificationRequest`、`handoffCandidateRefs` 与 source candidates 的一致性。
- approved package 不能残留 convergence-level 未解决澄清证据：`openQuestions[*].disposition === "request_user_clarification"`、`openQuestions[*].blockingLevel === "blocking"` 或 `stopReason === "requires_user_clarification"` 均必须校验失败；`unknownCandidateRefs` 可以保留非阻塞开放问题，但不得与 source candidates 或 `handoffCandidateRefs` 重叠。
- `awaiting_user` package 即使被篡改为 `approved` status，也必须因 convergence outcome / user escalation mismatch 校验失败，Aboveground planning 不得绕过。
- hard constraint 不能被 `nonGoals`、`assumptions`、`missingInformation`、`options[*].unknowns/whyNot/doNotChooseWhen`、`riskRegister` 或未来 Path Bias 文案弱化；若文本中把 hard constraint 描述成可忽略、可绕过、可覆盖、可豁免或可选，validation 必须失败。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| package schema version 不匹配 | `validation.passed === false` |
| manifest 与 handoff 的 id、version、status 或 sourceGoalId 不一致 | `validation.passed === false` |
| handoff 状态不是 `approved` | `DirectionHandoffPackageValidationError` 阻断 planning |
| `directionHandoff.status` 与 `convergenceReview.outcome` 不一致 | `validation.errors` 记录错误 |
| `convergenceReview.outcome === "awaiting_user"` 但缺少 `UserClarificationRequest` | `validation.errors` 记录错误 |
| `convergenceReview.outcome === "approved"` 但 openQuestions 或 stopReason 仍要求用户澄清 | `validation.errors` 记录错误 |
| `convergenceReview.outcome === "approved"` 但 unknownCandidateRefs 与 source / handoff candidates 重叠 | `validation.errors` 记录错误 |
| `awaiting_user` package 被篡改为 `approved` | `validation.passed === false` 且 Aboveground planning 抛 `DirectionHandoffPackageValidationError` |
| 缺少 package lineage 或 lineage current 与 manifest 不一致 | `validation.errors` 记录错误 |
| revision lineage 缺少 previous 或 previous direction/version 不合法 | `validation.errors` 记录错误 |
| 初始 package 带 previous | `validation.errors` 记录错误 |
| 同一 direction 保存 v1 awaiting_user 和 v2 approved | `listVersions(directionId)` 返回 `[1, 2]` |
| 缺少 `convergenceReviewRef` 或 source candidates | `validation.errors` 记录错误 |
| source candidate 未被 convergence review 收束 | `validation.errors` 记录错误 |
| package 中出现 Soil asset 正文或副本 | `validation.errors` 记录 `INLINE_SOIL_ASSET_CONTENT` |
| hard constraint 在 handoff 文本中被弱化 | `validation.errors` 记录 `HARD_CONSTRAINT_WEAKENED_IN_HANDOFF_TEXT` |
| Aboveground 传入 ad-hoc handoff 材料 | `StateGuardError` |

### 5. Good / Base / Bad Cases

- Good：Underground 生成 handoff 后组装 package 并保存到 in-memory store，Aboveground 只从 store 读取 approved package。
- Base：文件系统 store 只在测试或显式调用中使用临时目录 round-trip。
- Bad：demo 直接写仓库根 `.agentarbor/`，或把 split package 文件当作 Growth Plan 执行。

### 6. Tests Required

- approved package 可进入 planning。
- draft / awaiting_user package 被 planning 阻断。
- awaiting_user package 篡改为 approved 后仍被 validation 和 Aboveground planning 阻断。
- awaiting_user package 篡改为 approved 且清理 handoff 本体未决字段后，若 convergenceReview 仍残留 blocking / request_user_clarification openQuestions 或 requires_user_clarification stopReason，validation 仍必须失败。
- initial package 带 `lineage.revisionReason = "initial"`。
- user clarification recovery package 带 `lineage.revisionReason = "user_clarification_answered"`，previous 指向 v1，并且同一 direction 的 store versions 为 `[1, 2]`。
- approved package 可保留不属于 source / handoff candidates 的 non-blocking open question，但 unknownCandidateRefs 不能与 source / handoff candidates 重叠。
- 缺少 convergence review ref、缺少 source candidates、未收束 candidates 均校验失败。
- inline Soil asset content 被拒绝。
- handoff 文本弱化 hard constraint 被拒绝。
- 地下-only session 生成的 handoff 字段来自目标画像、候选和收束报告，而不是固定 minimal 文案。
- file-system store 在临时目录 save/load/list round-trip。
- explicit `outputDirectory` session 能通过 filesystem store round-trip 读取 `handoff.meta.json`。
- 默认 demo 不创建或修改仓库根 `.agentarbor/`。
- V0.1 13 步 EventLog 顺序保持不变。

### 7. Wrong vs Correct

#### Wrong

```ts
abovegroundPlanner.plan(directionHandoff, traceId, runtime);
```

#### Correct

```ts
abovegroundPlanner.plan(directionHandoff.id, directionHandoff.version, traceId, runtime);
```

地上中枢必须通过 store 加载和校验方向交接包；这样 package 校验、版本和 `.agentarbor` 边界不会被调用方绕过。
