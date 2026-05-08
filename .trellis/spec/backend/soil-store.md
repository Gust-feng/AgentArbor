# Soil Store 只读接口

本文件记录当前已出生的最小 Soil Store / Task Soil 运行时契约。Soil Store 只服务运行时读取长期约束、Capability Asset 引用、Path Bias 引用和历史运行引用；Task Soil 是 Desktop Shell 本轮任务输入形成的临时土壤，承载 goal、context refs、permission boundary refs、只读短 preview 和本轮材料 refs。当前阶段不实现数据库、文件持久化、写入治理或真实资产沉淀。

## Scope / Trigger

- Trigger：修改 `src/domain/soil/**`、`src/app/task-soil-workspace.ts`、Desktop Shell Task Soil 输入、地下目标理解、rootlet 选择、Evidence Ledger 或 Plan material 的 Soil 引用来源。
- Scope：确定性内存只读 Soil Store、Desktop Task Soil 输入契约和 safe context projection；不包含 repo-root `.agentarbor/` 写入、数据库、真实长期 Soil 写入或 Governance 入土路径。

## Signatures

- `ReadonlySoilStore`：只读接口，提供 `listConstraints()`、`listCapabilityAssetRefs()`、`listPathBiasRefs()`、`listHistoricalRunRefs()`。
- `InMemoryReadonlySoilStore`：内存实现，构造时接收 constraints、capability asset refs、path bias refs 和 historical run refs。
- `createMinimalReadonlySoilStore(constraints)`：最小地下运行使用的确定性 store factory。
- `createMinimalSoilConstraints()`：当前测试和 demo 的最小 Soil constraint fixture。
- `TaskSoil`：当前任务级临时土壤，包含 `rawGoal`、`contextRefs`、`constraints`、`permissionBoundaryRefs`、`globalSoilRefs` 和 `runMaterialRefs`。
- `DesktopTaskSoilInput`：Desktop Shell 请求体中的可选输入，允许 `contextRefs` 和 `permissionBoundaryRefs`；旧 goal-only 请求必须继续兼容。
- `TaskSoilContextRef.readonlyPreview`：用户显式提供的短预览，只能作为只读摘要进入 Task Soil / canvas；必须截断并脱敏。
- `createTaskSoilFromDesktopInput()`：Desktop Shell 入口的 Task Soil 组装 helper，负责 goal refs、workspace refs、用户 context refs、权限 refs、Global Soil refs 和 run material refs。

## Contracts

- Soil Store 当前只能返回引用和约束对象，不能返回 Capability Asset 正文、复制内容或可写句柄。
- Task Soil 只能接收本轮任务 refs、短摘要和只读短 preview；不得接收 runtime/store 引用、secret 引用、API key/token/authorization 形态、未授权正文或可写本地文件句柄。
- Desktop context refs 只允许 `workspace`、`file`、`project`、`web` 类型。`web` ref 必须是 `web:` / `http://` / `https://`；`file` 和 `project` 必须是 `file:` / `project:` / `workspace:` 等引用形态，不读取未授权文件正文。
- Desktop `permissionBoundaryRefs` 只能声明 `read:`、`execute:`、`deny:`、`ask:` 前缀，并且同样不得包含 `secret`、`runtime`、`store`、`api_key`、`apikey`、`token` 或 `authorization`。真实写入权限仍由 Aboveground、ToolCenter 和 Guard 执行，不由前端声明直接放行。
- Task Soil 组装时可以加入内部 `write:memory://artifacts` 这类运行期内存输出边界；用户输入不得声明任意 `write:` refs。
- 只读 preview、summary、goal summary 和 canvas 投影必须经过共享脱敏规则，覆盖 `sk-*`、`tvly-*`、`Bearer`、`Authorization`、`api_key` / `apikey`、`token`、`secret` 和 `password` 常见形态。
- 地下 rootlet 可以读取 Soil Store 中的约束和资产引用，用于目标画像、证据账本和 handoff refs。
- `.agentarbor` 作为 Plan Package 存储形态时只能保存 Soil 引用，不得内联 Soil asset content、body、copy 或等价字段。
- `PathBias` 只能影响 preference 或方案排序，不得覆盖 hard constraint。
- Soil Store 只读接口不是 Governance 入土流程；任何长期资产沉淀必须等 Governance 路径实现后再增加写接口。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Plan Package 中出现 inline Soil content/body/copy | validation 失败，错误码 `INLINE_SOIL_ASSET_CONTENT` |
| Desktop Task Soil 输入包含 `runtime:`、`store:`、`secret:` 或 token/API key/Authorization refs | HTTP 400 / Task Soil validation error，不创建 approved Plan |
| Desktop Task Soil 输入包含 `write:` permission ref | HTTP 400 / Task Soil validation error；用户输入不得声明写权限 |
| 只读 preview 含常见 secret/token 形态 | 输出进入 Task Soil / canvas 前被脱敏并截断 |
| 地下方向包只引用 Soil refs | validation 可通过，后续地上环可按 ref 接管 |
| 需要把候选资产沉淀到 Soil | 当前超出接口范围，应走后续 Governance / Soil promotion 任务 |
| Path Bias 与 hard constraint 冲突 | hard constraint 优先，Path Bias 不得放行 |

## Good / Base / Bad Cases

- Good：rootlet 输出 `soilAssetFitRefs: ["soil:minimal-constraints"]`，handoff `soilRefs` 只保存 ref。
- Base：测试中用 `createMinimalReadonlySoilStore(createMinimalSoilConstraints())` 提供确定性输入。
- Bad：为了方便前端或 demo，把 Soil asset 正文塞进 `directionHandoff.soilRefs` 或 package 附加字段。
- Bad：为了让面板“更真实”，把用户本地文件正文、API key、runtime store ref 或未清洗网页正文直接塞进 Task Soil。

## Tests Required

- Soil 引用只能是引用，inline Soil asset content 被 package validation 拒绝。
- Desktop Task Soil 输入覆盖 goal-only 兼容、context refs、permission refs、只读 preview 截断、secret/token/API key 脱敏，以及 runtime/store/secret/write refs 拒绝。
- 地下-only session 和默认 demo 不写 repo-root `.agentarbor/`。
- Plan material 的 hard constraint 不能被 nonGoal、assumption、option 或 Path Bias 文案弱化。

## Wrong vs Correct

### Wrong

```ts
directionHandoff.soilRefs = [{ ref: "soil:minimal-constraints", content: "...asset body..." }];
```

### Correct

```ts
directionHandoff.soilRefs = ["soil:minimal-constraints"];
```

Soil Store 在当前阶段只提供 refs 和 constraints；资产正文必须留在未来受治理 Soil 存储中。
