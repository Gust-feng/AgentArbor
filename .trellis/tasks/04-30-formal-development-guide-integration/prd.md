# 正式开发指南整合

## 目标

将 AgentArbor 的架构讨论、研究资料和开发指南整理成当前可继承的正式文档体系。整理后的基线不再使用版本式路线命名口径，而以持续生长的树形运行架构为当前正式方向。

## 当前方向

当前正式主线是：

```text
Imagination
  -> Seed Cluster
  -> Seed Packet
  -> User Approval Gate
  -> Soil
  -> Initial Rooting
  -> Root Brief
  -> Core Control Cluster
  -> Growth Plan
  -> Workflow IR
  -> Branch / Leaf / Flower / Fruit
  -> Root Callback / Re-rooting
  -> Run Memory / Ring Memory / Soil
```

其中 Root System 是持续运行的地下探索与吸收系统，不是一次性前置调研层；Core Control Cluster 负责基于 Root Brief 制定和修订 Growth Plan 与 Workflow IR。

## 要求

- 保留有价值的研究资料，并与当前开发指南分层。
- 删除、合并或归档对未来开发没有帮助的经验残留和临时 prompt。
- 活跃开发指南不能保留讨论态、路线图态或旧版本命名口径。
- `docs/` 下的文件夹命名、文件命名和文档内容使用简体中文。
- `.agentarbor/` 是未来 runtime 启动资产种子，不是当前开发工作区。
- 当前开发文档、计划、进展、经验和人类可读看板从 `docs/` 进入并分层沉淀。
- Trellis 是当前 AI 工作流源头；`docs/任务看板/` 只是从 Trellis 任务源派生的人类可读资产。

## 输出

- 清爽的 `docs/开发指南/` 正式开发指南。
- 清楚的 `docs/架构设计/` 产品架构和 ADR 入口。
- 保留并索引的 `docs/研究资料/`。
- 人类可读的 `docs/任务看板/`。
- 与当前文档边界一致的 `.trellis/spec/`、任务记录和治理指南。

## 验收标准

- [x] `README.md`、`AGENTS.md`、`docs/README.md` 和开发指南索引指向同一当前架构方向。
- [x] 临时 prompt 和旧压缩包类资料已被吸收或移除。
- [x] 有价值的研究报告仍能从研究资料索引访问。
- [x] 活跃文档不再把旧 Root 执行层语义当作当前事实。
- [x] 新 agent 能从文档索引与任务看板进入，而不需要阅读归档草稿。
