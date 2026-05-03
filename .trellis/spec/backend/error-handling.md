# 后端错误处理

当前阶段已有本地 panel HTTP JSON 边界，但没有通用 backend API、RPC 或外部服务响应契约。错误处理必须服务状态守卫、约束门、消息边界、注册、路由失败和本地 panel 配置失败，不把错误吞掉或降级成无证据的自然语言备注。

## Scope / Trigger

- Trigger：新增或修改 `src/kernel/**`、`src/domain/**`、`src/app/**` 中的守卫、路由、消息或 artifact 行为。
- Scope：内存 runtime 错误与本地 panel JSON error envelope；不包含通用 HTTP backend、RPC error shape 或外部 adapter 错误映射。

## Signatures

- `StateGuardError(code: string, message: string)`：状态机和层级边界失败。
- `ConstraintBlockedError(message: string)`：hard constraint 阻断。
- `UserConfirmationRequiredError(message: string)`：hard constraint 需要用户确认。
- `MessageBusPolicyError(message: string)`：内部消息策略失败。
- `AgentRegistryError(message: string)`：agent 注册/查询失败。
- `RoutingError(message: string)`：能力路由失败。
- `ArtifactStoreError(message: string)`：artifact 读取失败。
- `DirectionHandoffConvergenceError(message: string)`：方向交接包未完成收束。
- Panel JSON error envelope：`{ ok: false, status: "failed", error: { code, message } }`；只能用于本地 panel API，不能替代 runtime/domain 错误类型。

## Contracts

- 错误必须在拥有规则的 kernel/domain 边界抛出。
- app 编排可以让错误冒泡到测试或调用方，不能静默吞掉。
- hard constraint 的 `block` 与 `ask_user` 必须区分为不同错误类型。
- hard constraint 只有 `active` 或 `approved` 才能通过对应 enforcement gate；`proposed`、`waived`、`retired`、`violated` 或缺失状态不能因 `aboveground_center_decides`、`verification_reviews`、`governance_review` 等 policy 默认放行。
- `ask_user` policy 在未满足时抛 `UserConfirmationRequiredError`；其他未满足 hard policy 抛 `ConstraintBlockedError` 或更明确的守卫错误，不能继续进入 Assigned。
- fake agents 的失败不能写入 Soil 或 `.agentarbor/` 作为长期事实。
- `openai-compatible` provider 配置缺失时，app 组合根必须在创建 provider / 发起 fetch 前失败；panel 映射为 400 JSON error，错误正文只包含配置问题代码和中文脱敏消息。
- panel 未知异常只能返回通用失败消息，不得把 stack、raw provider error、API key、token 或完整 prompt 写入 HTTP JSON。

## 生效规则

- 不新增通用 HTTP 响应结构或日志链路；本地 panel JSON envelope 只服务未来工作台原型。
- 不用 broad catch 隐藏状态守卫或约束门失败。
- 不把测试为了通过而弱化错误契约。
- 新增守卫必须有对应测试覆盖。
- 不在 HTTP 响应中回显请求里的 `apiKey`、provider token 或 provider 原始敏感错误。

## Validation & Error Matrix

| 条件 | 错误 |
| --- | --- |
| Planning 前 DirectionHandoff 未 approved | `StateGuardError` |
| Assigned 前没有 GrowthPlan | `StateGuardError` |
| DirectionHandoff 保存 candidate/unknown/rejected 候选 | `DirectionHandoffConvergenceError` |
| hard constraint 为 violated 或不可执行 | `ConstraintBlockedError` |
| hard constraint 需要人工确认 | `UserConfirmationRequiredError` |
| hard constraint 为 proposed 且 conflictPolicy 为 governance_review / verification_reviews / aboveground_center_decides | `ConstraintBlockedError` |
| 内部 agent 对内部 agent 使用 `to.id` | `MessageBusPolicyError` |
| panel `openai-compatible` 缺少 API key | HTTP 400 + `missing_api_key`，不访问网络 |
| panel `openai-compatible` 缺少 model | HTTP 400 + `missing_model_name`，不泄漏已保存 secret |
| panel 未知异常 | HTTP 500 + `panel_internal_error`，返回中文通用失败消息，不暴露 stack 或 raw secret |

## Good / Base / Bad Cases

- Good：测试直接断言具体错误类型。
- Base：demo 正常路径不触发错误，但保留守卫。
- Bad：返回 `false` 或字符串错误后继续执行下一个状态。

## Tests Required

- 每个新增守卫至少有一个失败用例。
- 约束门至少覆盖 block 和 ask_user。
- hard constraint guard 覆盖 proposed + governance_review，并确认非 ask_user policy 不会默认进入 Assigned。
- MessageBus 策略至少覆盖内部私聊失败。
- panel provider config failure 至少覆盖缺 key 不访问网络、缺 model 不泄漏已配置 key。

## Wrong vs Correct

### Wrong

`try/catch` 捕获 `ConstraintBlockedError` 后继续产出 artifact。

### Correct

让错误冒泡，任务停在 assignment 前，EventLog 不出现 `task.assigned`。
