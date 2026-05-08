# Research: quality tooling

- **Query**: 分析 AgentArbor 测试、脚本、质量门禁和实际可运行性；回答当前质量信号是否可信、测试是否验证用户价值闭环还是内部结构、哪些质量/工具链问题容易阻碍快速 MVP。
- **Scope**: internal
- **Date**: 2026-05-08

## Findings

### Files Found

| File Path | Description |
|---|---|
| `package.json` | 项目脚本入口：`build`、`test`、demo、panel、Electron smoke。 |
| `tsconfig.json` | TypeScript 编译配置；`strict: true`，NodeNext，编译 `src/**/*.ts` 到 `dist/`。 |
| `.trellis/spec/backend/quality-guidelines.md` | 后端/运行时质量门禁；定义 `pnpm build`、`pnpm test`、demo、panel smoke、真实 AI smoke、禁用 lint/formatter 引入等规则。 |
| `.trellis/spec/frontend/quality-guidelines.md` | 当前前端质量边界；说明没有正式前端测试框架、构建链或 lint，依赖 TypeScript、node:test、panel smoke 和人工/轻量浏览器检查。 |
| `.trellis/spec/backend/index.md` | 后端规范索引与 Quality Check：要求 `pnpm build`、`pnpm test`，panel/config 改动需 `pnpm panel:smoke`。 |
| `src/app/minimal-loop.test.ts` | 覆盖 fake-AI desktop agent 的端到端内存链路：Task Soil、Plan Package、artifact、verification、RunMemory、ExperienceCandidate、PathBias、Observation Snapshot。 |
| `src/app/panel-server.test.ts` | 大型 panel/API/desktop 测试文件；覆盖配置 API、fake/openai-compatible run、Desktop canvas、async run、SSE、脱敏、真实 AI 契约失败诊断、工具配置。 |
| `src/app/task-soil-workspace.test.ts` | 覆盖 Desktop Task Soil 输入、context refs、permission refs、只读 preview 截断、secret/redaction 边界。 |
| `src/app/underground-demo-cli.test.ts` | 通过 `node dist/app/underground-demo.js` 验证 CLI 默认 fake AI、openai-compatible 配置失败、密钥不泄漏。 |
| `src/app/real-ai-smoke.test.ts` | 通过 CLI 验证缺配置时真实 AI smoke 返回 skipped/configuration boundary；通过 stubbed openai-compatible provider 验证 Cognitive Work Session smoke contract 且不泄漏 secret。 |
| `src/app/panel-desktop-launcher.test.ts` | 覆盖 Electron shell 安全默认值、smoke 不创建窗口、server 启停、失败清理。 |
| `src/kernel/state-machine/task-state-machine.test.ts` | 典型内部守卫测试：未批准 handoff、缺 GrowthPlan、hard constraint block/ask_user/governance review。 |
| `src/app/underground-intelligence.test.ts` | 覆盖地下 AI 主线、候选池、Convergence Judge、ToolCenter search/read、fallback、密钥/输出脱敏。 |
| `src/app/tool-center/tool-center.test.ts` | 覆盖 ToolCenter 注册、执行、allowedTools、maxCallsPerRun。 |
| `src/app/trellis-gitignore.test.ts` | 使用 `git check-ignore` 验证 Trellis 文件忽略规则。 |

### Code Patterns

#### 1. 脚本与门禁形态

`package.json:7-14` 定义的实际脚本为：

```json
"build": "tsc -p tsconfig.json",
"test": "pnpm build && node --test \"dist/**/*.test.js\"",
"demo": "pnpm build && node dist/app/demo.js",
"demo:underground": "pnpm build && node dist/app/underground-demo.js",
"panel": "pnpm build && node dist/app/panel.js",
"panel:smoke": "pnpm build && node dist/app/panel.js --port 0 --smoke",
"panel:desktop": "pnpm build && pnpm exec electron dist/app/panel-desktop.js",
"panel:desktop:smoke": "pnpm build && pnpm exec electron dist/app/panel-desktop.js --port 0 --smoke"
```

`tsconfig.json:1-15` 开启 `strict: true`，并将 `src/**/*.ts` 编译进 `dist`。这意味着测试源码也随业务源码一起编译，然后由 Node test runner 执行 `dist/**/*.test.js`。

后端质量规范与脚本一致：`.trellis/spec/backend/quality-guidelines.md:11-19` 明确 `pnpm build`、`pnpm test`、demo、panel smoke、desktop smoke、真实 AI smoke 的含义；`.trellis/spec/backend/quality-guidelines.md:35-38` 明确当前不引入 Vitest/Jest/ESLint/Prettier，且不能用 demo 代替单元测试。

#### 2. 实际测试运行信号

在仓库根路径 `/z/AgentArbor` 执行：

```bash
cd "/z/AgentArbor" && pnpm test
```

结果：通过。

- `pnpm build` 通过。
- Node test runner 统计：`tests 265`、`pass 265`、`fail 0`、`skipped 0`、`duration_ms 2637.4021`。

同一命令在当前 agent worktree 路径 `/z/AgentArbor/.claude/worktrees/agent-aeeafcfb` 失败：`tsc is not recognized`，并提示 `Local package.json exists, but node_modules missing`。这说明质量信号在主仓库路径可信，但当前 Claude worktree 本身没有可用依赖环境；从 worktree 直接跑同一脚本会得到工具链失败，而不是代码质量失败。

#### 3. 测试覆盖的用户价值闭环

存在多处接近用户价值闭环的测试：

- `src/app/minimal-loop.test.ts:20-71` 验证 minimal loop 返回 Task Soil、approved Plan Package、artifact、verification、RunMemory、ExperienceCandidate、PathBias 等完整结果；`src/app/minimal-loop.test.ts:73-109` 验证 Observation Snapshot 可序列化并反映地下状态；`src/app/minimal-loop.test.ts:213-221` 验证默认 demo path 不写 repo-root `.agentarbor`。
- `src/app/panel-server.test.ts:336-379` 验证 Desktop async fake run 生成主画布所需的 Task Soil、approved Plan、Aboveground artifact、Fruit、tracking、transcript final result。
- `src/app/panel-server.test.ts:381-414` 和 `src/app/panel-server.test.ts:416-449` 验证 Desktop 默认走 openai-compatible 配置边界而不是 fake fallback。
- `src/app/panel-server.test.ts:679-724` 验证 Desktop canvas/tracking/transcript/SSE 不泄漏模型或工具内部材料。
- `src/app/underground-demo-cli.test.ts:8-22` 验证 CLI 默认 fake AI happy path 创建 approved package；`src/app/underground-demo-cli.test.ts:67-81` 验证缺 API key 时在模型事件前失败。
- `src/app/real-ai-smoke.test.ts` 验证真实 AI smoke 缺配置时 skipped/configuration boundary 且退出码 0，并用 stubbed provider 覆盖 `use_tools -> spawn_children -> synthesize -> produce_artifact` 的 Cognitive Work Session smoke path。

这些测试覆盖了“用户输入目标 → Task Soil → 地下 Plan/Package → Aboveground artifact → Fruit/记忆摘要 → panel/stream 可见投影”的本地 fake/stub 闭环；真实 provider 只覆盖配置边界和 stubbed openai-compatible 路径，默认测试不触发真实网络。

#### 4. 测试覆盖的内部结构/守卫

大量测试验证内部结构、边界和事件契约：

- `src/kernel/state-machine/task-state-machine.test.ts:13-116` 断言状态机和 hard constraint 守卫。
- `src/app/underground-intelligence.test.ts:19-67` 验证 AI 输出进入候选池后必须等待 convergence 才能 handoff；`src/app/underground-intelligence.test.ts:69-146` 验证 Convergence AI 不能推荐缺失或非 handoff candidate；`src/app/underground-intelligence.test.ts:447-461` 验证无 AgentTurnRuntime 时停止且不批准。
- `src/app/tool-center/tool-center.test.ts:5-55` 验证工具注册、权限和预算。
- `src/app/panel-desktop-launcher.test.ts:10-30` 验证 Electron window 安全默认值。
- `src/app/trellis-gitignore.test.ts:5-26` 验证 repo 文件管理规则。

内部结构断言较多，包括 EventLog 顺序、candidate refs、rootlet kinds、agent run tree、guarded statuses、redaction、provider boundary、package validation 等。它们是当前 `pnpm test` 通过的主要组成部分之一。

#### 5. 当前质量信号可信度

当前质量信号在“可编译、默认测试稳定、fake/stub runtime 边界、panel HTTP/SSE JSON 安全投影、本地 demo/CLI 配置边界”这些维度较可信，原因：

- `pnpm test` 实际先 build 后跑所有 `dist/**/*.test.js`，没有落入 `.trellis/spec/backend/quality-guidelines.md:91-98` 警告的 `node --test dist` 目录级误跑问题。
- 实际跑出 265 个测试，覆盖脚本、CLI、HTTP server、SSE、Electron shell dependency-injection smoke、provider stub、tool stub、redaction、状态守卫、package validation。
- `src/app/panel-server.test.ts` 中多处通过注入 `PanelProviderFetch` 验证 “缺配置不调用 fetch”、“stub provider response”、“invalid provider response 不泄漏 raw output”。

当前质量信号在以下维度不等同于真实用户可运行性证明：

- 默认 `pnpm test` 不运行 `pnpm panel:smoke` 或 `pnpm panel:desktop:smoke` 脚本本身；相关能力主要通过单元/集成测试中的 server/window 依赖注入和 HTTP helpers 间接覆盖。
- 默认 `pnpm test` 不触发真实 provider 网络；`src/app/real-ai-smoke.test.ts` 用 stubbed provider 验证真实 smoke 的 contract path，真实 provider 成功仍需要显式 `pnpm smoke:real-ai`。
- 前端质量规范 `.trellis/spec/frontend/quality-guidelines.md:2-17` 明确没有正式前端测试框架、浏览器验证命令、可访问性工具或 CI 门禁，panel HTML 的许多 UI 断言是字符串包含/排除，例如 `src/app/panel-server.test.ts:10-81`。
- 测试运行依赖仓库根目录已有 `node_modules`；当前 agent worktree 路径没有依赖时 `pnpm test` 会因 `tsc` 不可用失败。

#### 6. 测试更偏用户价值闭环还是内部结构

结论：两类都有，但总体偏“内部结构 + 安全/边界契约”，同时已存在一条 fake/stub 的用户价值闭环。

用户价值闭环证据：

- `src/app/minimal-loop.test.ts:20-71` 和 `src/app/panel-server.test.ts:336-379` 直接断言 Desktop Shell 的可见产物：Task Soil、Plan、Aboveground artifact、Fruit、transcript final result。
- `src/app/panel-server.test.ts:381-414` 验证默认真实 AI 推荐入口的配置边界，避免用户误以为 fake fallback 是真实成功。
- `src/app/panel-server.test.ts:451-502`、`src/app/task-soil-workspace.test.ts:28-65` 验证用户传入 context refs/permission refs/readonly previews 可以进入 Task Soil canvas。

内部结构证据：

- 很多测试断言 EventLog exact/in-order sequence、candidate pool counts、rootlet kind、agent loop phase、guard source refs、validation status、package lineage、model request count、specific contract ids。
- `.trellis/spec/backend/quality-guidelines.md:74-88` 的 Tests Required 也主要列出状态守卫、DirectionHandoff、hard constraints、MessageBus、地下 AI agent `reason()`/`act()`/`guard()` 分工、secret 边界等内部契约。

因此当前测试能证明“本地 fake/stub 产品路径可跑通并且内部边界严密”，但对“真实用户在 Desktop Shell 中用真实模型完成有价值任务”的证明范围较窄。

#### 7. 容易阻碍快速 MVP 的质量/工具链问题（描述性发现）

以下为现状中会增加快速 MVP 验证成本的质量/工具链因素：

1. **默认质量门禁很宽且偏完整回归**：`pnpm test` 每次先 `tsc` 再运行全部 265 个测试；测试虽然约 2.6 秒通过，但语义覆盖面包含地下 agent、panel、Electron shell、Trellis gitignore、工具运行时、package validation 等大量内部契约。对小的产品验证改动，失败定位可能横跨多层。
2. **没有 lint/formatter/coverage/CI 信号**：后端规范 `.trellis/spec/backend/quality-guidelines.md:35-38` 明确不引入 Vitest/Jest/ESLint/Prettier；前端规范 `.trellis/spec/frontend/quality-guidelines.md:2-17` 明确没有正式前端测试框架、构建链、lint、浏览器验证命令或可访问性工具。当前质量信号主要是 TypeScript + node:test + smoke/人工检查。
3. **panel 测试文件承担过多产品与边界覆盖**：`src/app/panel-server.test.ts` 单文件超过 1400 行，覆盖 config、tools、fake/openai、Desktop runs、SSE、visible output、redaction、stub provider、helpers。快速定位 panel 行为问题时需要在同一文件内穿过大量场景。
4. **真实 AI 成功路径不属于默认信号**：规范 `.trellis/spec/backend/quality-guidelines.md:19-20` 将真实 AI smoke 放在独立命令；默认测试证明缺配置 skipped 与 stubbed provider contract，不代表真实 provider 端到端质量。
5. **测试环境路径差异会造成假失败**：在 agent worktree `/z/AgentArbor/.claude/worktrees/agent-aeeafcfb` 跑 `pnpm test` 失败，因该 worktree 没有 `node_modules`/`tsc`；在 `/z/AgentArbor` 跑同一命令通过。这会影响自动化子代理或临时 worktree 的可运行性判断。
6. **部分测试使用真实进程/系统命令或时间轮询**：如 `src/app/underground-demo-cli.test.ts:116-120`、`src/app/real-ai-smoke.test.ts:41-45` 通过 `execFile` 跑 `dist` 脚本；`src/app/trellis-gitignore.test.ts:28-40` 调用 `git check-ignore`；`src/app/panel-server.test.ts:1333-1349` 用 25ms polling 等待 async run。这些提高了对本地 shell、git、dist build、计时的依赖。

### External References

未使用外部搜索；本次任务只需分析仓库内测试、脚本、规范和实际命令结果。

### Related Specs

- `.trellis/spec/backend/quality-guidelines.md` — 当前后端/运行时质量门禁、脚本签名、Validation & Error Matrix、Tests Required。
- `.trellis/spec/frontend/quality-guidelines.md` — 当前 Desktop Shell / Observation Panel 前端质量边界和无正式前端工具链说明。
- `.trellis/spec/backend/index.md` — Quality Check 索引，列出 build/test/demo/panel smoke 触发条件。
- `.trellis/spec/backend/intelligence-channel.md` — 智能通道、provider adapter、secret、fake/stub、真实模型边界相关测试要求。
- `.trellis/spec/backend/tool-runtime.md` — ToolCenter/ResearchRuntime 工具质量要求；其中列出 `pnpm test`、`pnpm panel:smoke` 和 `git diff --check`。
- `.trellis/spec/backend/observation-read-model.md` — Observation Snapshot、EventLog、安全投影、panel HTTP/SSE 脱敏相关失败条件。

## Caveats / Not Found

- 未修改业务代码或规范文件；只写入本 research 文件。
- 未运行 `pnpm panel:smoke`、`pnpm panel:desktop:smoke`、`pnpm demo`、真实 provider 成功 smoke；只运行了默认 `pnpm test`。
- `pnpm test` 在 `/z/AgentArbor` 通过，但在当前 agent worktree 路径因缺少依赖失败；这不是测试断言失败，而是依赖安装位置/工作目录问题。
- 未发现 coverage、lint、formatter、正式浏览器 UI 自动化或 CI 配置作为当前默认质量门禁的一部分。
