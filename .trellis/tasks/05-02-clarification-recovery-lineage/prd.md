# feat: 完善澄清恢复与方向包谱系

## Goal

在确定性内存 runtime 内完成第二阶段提交范围：当 Underground 进入 `awaiting_user` 后，用户澄清回答可以被记录、恢复、重新收束，并生成同一 `directionId` 的新版 approved Direction Handoff Package；Observation 必须能暴露澄清响应、方向包修订和最终 approved handoff 的可读谱系。

## Requirements

* 扩展 `UserClarificationResponse` 使用路径，记录 `user_approval.received` 事件，payload 包含 request id、answers、answeredAt、evidence refs。
* Observation event refs 必须能捕捉相关 `user_clarification` refs 和 direction package refs，metadata 来源仍统一在 `src/domain/observation/event-metadata.ts`。
* 新增 Underground 澄清恢复流程 helper，输入 awaiting-user package、clarification request、clarification response，重新收束 blocking unknown，生成 approved convergence report。
* 恢复流程必须产出同一 `directionId` 的下一版本 approved Direction Handoff Package。
* 增加方向包谱系字段：`DirectionHandoffPackageRef`、`DirectionHandoffPackageLineage`。
* Lineage 记录 `current`、`previous`、`revisionReason`、`sourceRefs`、`createdAt`。
* 初始 package 使用 `revisionReason: "initial"`；用户回答后的新版 package 使用 `revisionReason: "user_clarification_answered"`。
* Package schema version 暂不改名；builder 统一填充 lineage；文件系统 canonical payload 继续是 `handoff.meta.json`。
* Package store API 保持 `save/load/listVersions/validate` 不变。
* 同一 direction 必须能保存 v1 `awaiting_user` 与 v2 `approved`，且 `listVersions(directionId)` 返回 `[1, 2]`。
* Aboveground 仍只能读取 approved package；v1 awaiting-user validation/planning 失败，v2 approved validation/planning 成功。
* Observation 事件 `user_approval.received`、`direction_handoff.revision_requested`、第二次 `convergence_review.completed`、最终 `direction_handoff.completed` 必须能派生正确 phase/stage/event refs。
* `pnpm demo` 继续输出原 happy path，不默认触发澄清恢复场景。
* 更新 `docs/任务看板/看板.md`：把 P1 修复从当前任务移入前置结果，将当前任务切到“核心边界清理 + 澄清恢复谱系”已完成/收尾状态。
* 更新 `.trellis/spec/backend` 中地下澄清、方向包谱系、observation metadata 规则。

## Acceptance Criteria

* [ ] Happy path 18-step EventLog 不变。
* [ ] Clarification-required 路径仍停在 `user_approval.requested`，不进入 Aboveground。
* [ ] Clarification recovery 路径生成 `user_approval.received`、新版 approved package 和 package lineage。
* [ ] v1 awaiting-user package validation / planning 失败，v2 approved package validation / planning 成功。
* [ ] Package store `listVersions(directionId)` 返回 `[1, 2]`。
* [ ] Snapshot JSON round-trip，且恢复路径暴露澄清响应和新版 handoff refs。
* [ ] `pnpm build` 通过。
* [ ] `pnpm test` 通过。
* [ ] `pnpm demo` 通过且保持原 happy path。
* [ ] `git diff --check` 通过。
* [ ] `git diff --cached --check` 通过。
* [ ] `.agentarbor/` 无 tracked/staged/diffed 运行资产。
* [ ] 根目录无 `Plan/` 或 `Plans/`。

## Out of Scope

* 不接 UI、HTTP、SSE、WebSocket、数据库、真实 LLM、MCP、A2A 或 AG-UI adapter。
* 不写 repo-root `.agentarbor/` 运行资产。
* 不实现 Nutrient Request、Growth Plan Revision 或真实地上补探。
* 不新增根目录 `Plan/` 或 `Plans/`。
* 不提交、不暂存、不重置、不回退用户改动。

## Technical Approach

延续第一阶段抽出的 `src/app/underground-runner.ts` 和 `src/domain/observation/event-metadata.ts`。澄清恢复逻辑放在 `src/app/clarification-flow.ts` 或 focused helper 中，避免把 orchestration 重新塞回领域模型。Direction Handoff Package builder 成为 lineage 的唯一填充入口，store API 不改签名，Aboveground approval gate 不放宽。

## Technical Notes

* 当前基线包含 `refactor: 清理核心模块边界`。
* 需要尊重 `src/app/underground-runner.ts` 与 `src/domain/observation/event-metadata.ts` 的新边界。
* `.trellis/` 可能是 ignored 本地工作流层，本任务只按需求更新 spec，不调整 `.gitignore` 或提交范围。
