# AgentArbor

AgentArbor 是一个面向本地工作区的桌面通用 Agent 项目。它把任务输入、文件上下文、工具调用、命令确认和结果展示放在同一个桌面工作台里处理，让用户不必反复组织上下文，也不必把简单动作拆成零散流程。

当前默认运行方式仍是普通桌面 `agent`：会话、工具、确认、事件和持久化先闭环；显式 `deep` / Agent 集群作为独立入口保留，内部仍可使用 `deep`、`DeepRuntime` 和 `/api/deep/*`。

## 当前状态

- 默认入口：`Desktop Shell / Panel`
- 默认模式：`agent`
- 默认主线：`用户消息 -> Task Soil -> 普通 Agent 主循环 -> 工具调用/命令确认 -> 结果投影`
- 显式 `deep` / Agent 集群：设置启用后从侧栏进入
- 默认请求不会自动升级为 deep

## 主要能力

- 连续会话
- 模型工具循环
- 命令确认
- 运行事件记录
- 工作区、文件和网页上下文处理
- 结果展示与会话持久化

## 项目结构

```text
/
  AGENTS.md
  README.md
  CURRENT_RUNTIME_MODE.md
  docs/
  .trellis/
  .agents/
  .codex/
  .opencode/
  .claude/
  .agentarbor/
  src/
```

## 目录职责

- `docs/`：正式文档、研究资料和架构设计。
- `src/`：TypeScript 实现代码。
- `.agents/`：Agent Skills 兼容层。
- `.codex/`：Codex 适配层。
- `.opencode/`：OpenCode 适配层。
- `.claude/`：Claude Code 适配层。
- `.agentarbor/`：未来 Plan Package 的实现/存储形态。
- `.trellis/`：历史材料，不再作为当前开发入口。

## 运行方式

### 安装

```bash
pnpm install
```

### 构建

```bash
pnpm build
```

### 测试

```bash
pnpm test
```

### 启动桌面面板

```bash
pnpm panel:desktop
```

### 开发模式

```bash
pnpm panel:dev
```

## 文档入口

1. [CURRENT_RUNTIME_MODE.md](CURRENT_RUNTIME_MODE.md)
2. [docs/README.md](docs/README.md)
3. [开发指南](docs/开发指南/README.md)
4. [开发指南总览](docs/开发指南/00-总览.md)
5. [基础](docs/开发指南/01-基础/README.md)
6. [Agent 口径与命名](docs/开发指南/01-基础/05-Agent口径与命名.md)
7. [核心闭环](docs/开发指南/02-核心闭环/README.md)
8. [系统架构](docs/开发指南/03-系统架构/README.md)
9. [模型与契约](docs/开发指南/04-模型与契约/README.md)
10. [架构设计](docs/架构设计/README.md)

## 当前原则

- 普通路径先可用、可审阅、可恢复。
- 默认请求不自动升级为 deep。
- helper、adapter、formatter、文件编辑动作不应被包装成 agent。
- `Plan` 不是普通回答，也不是临时摘要。
- `atomic` 只用于真实事务边界。

## 相关说明

如果你想先看当前软件实际怎么跑，先读 [CURRENT_RUNTIME_MODE.md](CURRENT_RUNTIME_MODE.md)。
