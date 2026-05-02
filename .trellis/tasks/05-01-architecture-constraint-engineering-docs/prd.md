# 全景架构与约束工程文档优化

## Goal

修正 AgentArbor 当前文档中的两个结构性缺口：旧 ADR-0011 的“架构全景图”只能作为历史局部图保留，不能继续代表当前全貌；约束工程需要成为横向契约，让约束从 Seed 到 Soil 可提取、可传递、可执行、可验证、可沉淀。

## What I Already Know

- 当前正式树形运行架构以 ADR-0016 为准。
- ADR-0011 仍位于产品架构 ADR 目录，其标题和“架构全景图”容易被误读为当前全貌。
- 开发指南已经定义 Seed Cluster、Root System、Core Control Cluster、Branch / Leaf / Flower、Fruit、Run Memory、Path Bias 和 Soil。
- `最小运行契约` 中仍有 `constraints: string[]`，这不足以支撑可执行约束。
- 本轮只改文档与普通入口，不改源码，不处理 `.codex`、`.opencode`、`.agentarbor` 等点目录；Trellis 任务源是实施要求的例外。

## Requirements

- 保留 ADR-0011 的历史价值，但明确它不是当前架构全貌。
- 新增 ADR-0017，定义约束工程与可执行约束模型。
- 新增开发指南 `约束工程` 章节，并更新模型与契约索引。
- 将活跃契约中的 `constraints: string[]` 改为 `constraintRefs: string[]`，并说明自然语言约束说明不等同于可执行约束源。
- 更新系统总览和 Agent 集群运行结构，补入真正全景主线与约束切片责任。
- 完成后刷新 `docs/任务看板/看板.md`。

## Acceptance Criteria

- [ ] ADR-0011 明确标注旧图为历史局部参考，并给出到当前树形架构的映射。
- [ ] ADR-0017 存在，并清楚区分约束工程与治理系统。
- [ ] 开发指南中存在 `07-约束工程.md`，定义 `Constraint`、`ConstraintRef`、硬约束、软约束、偏好约束和冲突处理。
- [ ] 活跃契约不再以 `constraints: string[]` 作为可执行约束字段。
- [ ] 入口索引和任务看板与本次变化一致。
- [ ] Markdown 链接、diff whitespace 和关键术语检索通过。

## Out Of Scope

- 不实现 TypeScript 运行时代码。
- 不创建 `.agentarbor/` 机器可读资产。
- 不改 `.codex/`、`.opencode/`、`.claude/` 平台适配。
- 不把约束工程扩张成新的运行时模块。

## Technical Notes

- 适用规范：`.trellis/spec/guides/agentarbor-governance-guide.md`。
- 主要文档入口：`docs/README.md`、`docs/开发指南/README.md`、`docs/开发指南/00-总览.md`。
- 主要架构入口：`docs/架构设计/产品架构/README.md`。
