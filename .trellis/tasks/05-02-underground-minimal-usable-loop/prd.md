# 实现地下组织最小使用闭环

## Goal

把地下组织从“最小可运行单环”推进到“最小可使用闭环”：用户输入目标后，地下组织能产出 `approved` / `awaiting_user` / `stopped`；当需要用户澄清时，可以通过 deterministic 自动回答恢复为 approved v2。方向包默认仍保存在内存中，只有显式传入输出目录时才写入文件系统。同步准备 Trellis 共享事实源进入 git working tree，并继续忽略本地运行态。

## Requirements

- 统一地下运行入口：
  - 扩展 `runUndergroundDirectionSession`，支持可选 `packageStore` 或 `outputDirectory`，默认继续使用 in-memory store。
  - 支持恢复 awaiting-user session：输入 awaiting-user session 与 clarification response 后，重新收束并保存 approved v2 package。
  - 三类终态固定为 `approved_package_created`、`awaiting_user`、`stopped`。
  - 恢复成功后仍映射为 `approved_package_created`，但 package version 必须为 `2`，lineage 指向 v1。
- 扩展地下-only demo：
  - `pnpm demo:underground -- "<goal>"` 保持默认内存运行。
  - 增加 `--auto-answer`：遇到 `awaiting_user` 时自动生成 deterministic response，并发布 `user_approval.received -> direction_handoff.revision_requested -> convergence_review.completed -> direction_handoff.completed`。
  - 增加 `--out <dir>`：显式输出 Direction Handoff Package 到指定目录。
  - 不传 `--out` 时不得写 repo-root `.agentarbor/`。
  - demo summary 增加 `recoveredPackage`、`lineage`、`versions`、`writtenPackagePath` 字段。
- 加强最小可用边界：
  - 文件系统输出只允许显式目录；不得默认选择 repo-root `.agentarbor/`。
  - awaiting_user v1 validation 仍失败；approved v2 validation 必须通过。
  - Aboveground 仍不进入地下-only demo；恢复后也只停在 handoff boundary。
  - stopped 场景不伪造 approved package。
- Trellis 入 git 准备：
  - 调整根 `.gitignore`，放开 `.trellis/spec/`、`.trellis/tasks/`、`.trellis/scripts/`、`.trellis/workflow.md`、`.trellis/config.yaml`、`.trellis/.version`、`.trellis/.gitignore`。
  - 继续忽略 `.trellis/.runtime/`、`.trellis/workspace/`、`.trellis/.developer`、`.trellis/.current-task`、`__pycache__/`、`*.pyc`、临时文件。
  - 本轮只准备到 git working tree，不提交。

## Acceptance Criteria

- [x] `pnpm build` passes.
- [x] `pnpm test` passes.
- [x] Happy path underground-only still produces approved v1 and does not enter Aboveground.
- [x] awaiting_user does not enter Aboveground and v1 validation fails.
- [x] `--auto-answer` or equivalent API can recover awaiting_user to approved v2, preserve the same `directionId`, and `listVersions` returns `[1, 2]`.
- [x] Recovery EventLog order contains clarification answer and second convergence events.
- [x] `--out <tempDir>` can round-trip read a written package file.
- [x] Without `--out`, repo-root `.agentarbor/` is unchanged.
- [x] stopped scenarios do not fabricate approved packages.
- [x] Trellis ignore rules include shared facts but continue excluding runtime / workspace / pycache.
- [x] Manual demo command passes: `pnpm demo:underground -- "构建任务管理平台，包含测试和监控，不接数据库"`.
- [x] Manual demo command passes: `pnpm demo:underground -- --auto-answer "Build the helper, but permission boundary and hard constraint are unknown and must be confirmed."`.
- [x] Manual demo command passes: `pnpm demo:underground -- --out <temp-dir> "构建任务管理平台，包含测试和监控，不接数据库"`.

## Definition of Done

- Code is modular and follows existing TypeScript runtime structure.
- Tests cover the new API, demo behavior, persistence behavior, and ignore-rule boundary.
- No default write to repo-root `.agentarbor/`.
- No Aboveground execution is introduced into underground-only flows.
- `.trellis/` shared facts are prepared for git without including local runtime state.
- No git commit is created by this task.

## Technical Approach

- Reuse existing underground session, direction handoff, event log, validation, and package store abstractions where possible.
- Add recovery as a first-class session behavior or option rather than duplicating demo-only logic.
- Keep deterministic auto-answer as a demo/test helper boundary, not a real user interaction model.
- Add explicit filesystem persistence only behind `outputDirectory`.
- Update `.gitignore` with narrowly scoped `.trellis/` unignore rules and retain local runtime ignores.

## Decision (ADR-lite)

**Context**: The current underground runtime can produce a minimal direction package, but cannot complete the smallest user-clarification recovery loop or explicitly persist handoff packages for inspection.

**Decision**: Implement the smallest usable underground loop in the existing runtime and demo boundary, keeping storage in memory by default and adding explicit output-directory persistence. Treat deterministic auto-answer as a recovery demonstration path only.

**Consequences**: The underground-only path becomes testable as a complete boundary without prematurely introducing Aboveground, real LLMs, UI, HTTP, database, MCP/A2A/AG-UI, or repo-root `.agentarbor/` asset birth semantics.

## Out of Scope

- Real LLM integration.
- UI, HTTP, database, MCP/A2A/AG-UI integration.
- Entering Aboveground from the underground-only demo.
- Default repo-root `.agentarbor/` writes.
- Final AgentArbor repo-root asset birth strategy.
- Git commit creation.

## Technical Notes

- User-provided plan is the task contract for this implementation.
- Current task pointer was empty at session start, so this task was created to provide a PRD and implement/check context before implementation.
