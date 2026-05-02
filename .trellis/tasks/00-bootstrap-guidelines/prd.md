# AgentArbor 启动规范基线

## 目标

建立当前阶段可用的 Trellis 规范入口，让未来 agent 在进入 AgentArbor 开发前能读到真实边界，而不是从模板中推导出不存在的后端、前端或运行时代码约定。

## 当前事实

- AgentArbor 当前仍处于文档规划、架构契约和工作流塑形阶段。
- `src/` 还没有真实运行时代码。
- 后端、前端、数据库、组件、状态管理、测试框架等实现规范尚未出生。
- 当前有效规范集中在 `AGENTS.md`、`docs/`、`.trellis/spec/guides/agentarbor-governance-guide.md` 和 repo-local Trellis skills。

## 要求

- `.trellis/spec/guides/agentarbor-governance-guide.md` 作为当前治理规范入口。
- `.trellis/spec/backend/` 和 `.trellis/spec/frontend/` 必须明确标注为“实现阶段延后”，不能保留英文空模板。
- 不创建不存在的代码示例、框架约定、目录约定或测试约定。
- 不再引用已经取消的旧计划入口。
- 人类可读的任务状态通过 `docs/任务看板/` 查看，Trellis 任务目录继续作为工作流源数据。

## 验收标准

- [x] Trellis 治理指南能说明 AgentArbor 当前开发边界。
- [x] 后端规范目录不再用空模板暗示已经存在后端实现约定。
- [x] 前端规范目录不再用空模板暗示已经存在前端实现约定。
- [x] Trellis 任务相关文件指向真实存在的入口和规范。
