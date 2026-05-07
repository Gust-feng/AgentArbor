# Soil Store 只读接口

本文件记录当前已出生的最小 Soil Store 运行时契约。它只服务地下独立闭环读取长期约束、Capability Asset 引用、Path Bias 引用和历史运行引用；当前阶段不实现数据库、文件持久化、写入治理或真实资产沉淀。

## Scope / Trigger

- Trigger：修改 `src/domain/soil/**`、地下目标理解、rootlet 选择、Evidence Ledger 或 Plan material 的 Soil 引用来源。
- Scope：确定性内存只读 Soil Store；不包含 repo-root `.agentarbor/` 写入、数据库、HTTP、UI、真实 LLM 或 Governance 入土写路径。

## Signatures

- `ReadonlySoilStore`：只读接口，提供 `listConstraints()`、`listCapabilityAssetRefs()`、`listPathBiasRefs()`、`listHistoricalRunRefs()`。
- `InMemoryReadonlySoilStore`：内存实现，构造时接收 constraints、capability asset refs、path bias refs 和 historical run refs。
- `createMinimalReadonlySoilStore(constraints)`：最小地下运行使用的确定性 store factory。
- `createMinimalSoilConstraints()`：当前测试和 demo 的最小 Soil constraint fixture。

## Contracts

- Soil Store 当前只能返回引用和约束对象，不能返回 Capability Asset 正文、复制内容或可写句柄。
- 地下 rootlet 可以读取 Soil Store 中的约束和资产引用，用于目标画像、证据账本和 handoff refs。
- `.agentarbor` 作为 Plan Package 存储形态时只能保存 Soil 引用，不得内联 Soil asset content、body、copy 或等价字段。
- `PathBias` 只能影响 preference 或方案排序，不得覆盖 hard constraint。
- Soil Store 只读接口不是 Governance 入土流程；任何长期资产沉淀必须等 Governance 路径实现后再增加写接口。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Plan Package 中出现 inline Soil content/body/copy | validation 失败，错误码 `INLINE_SOIL_ASSET_CONTENT` |
| 地下方向包只引用 Soil refs | validation 可通过，后续地上环可按 ref 接管 |
| 需要把候选资产沉淀到 Soil | 当前超出接口范围，应走后续 Governance / Soil promotion 任务 |
| Path Bias 与 hard constraint 冲突 | hard constraint 优先，Path Bias 不得放行 |

## Good / Base / Bad Cases

- Good：rootlet 输出 `soilAssetFitRefs: ["soil:minimal-constraints"]`，handoff `soilRefs` 只保存 ref。
- Base：测试中用 `createMinimalReadonlySoilStore(createMinimalSoilConstraints())` 提供确定性输入。
- Bad：为了方便前端或 demo，把 Soil asset 正文塞进 `directionHandoff.soilRefs` 或 package 附加字段。

## Tests Required

- Soil 引用只能是引用，inline Soil asset content 被 package validation 拒绝。
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
