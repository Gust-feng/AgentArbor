# 后端质量规范

当前阶段已建立第一阶段运行时工具链：`pnpm + TypeScript + tsc + node:test`。这里的“后端质量”指内存 runtime kernel、本地配置中心和本地 Underground panel 原型质量，不包含数据库或正式 backend 服务。

## Scope / Trigger

- Trigger：修改 `package.json`、`tsconfig.json`、`src/**`、`tests/**`、demo、panel 或配置中心行为。
- Scope：最小运行内核构建、测试、demo、panel smoke 和密钥边界验收。

## Signatures

- `pnpm build`：执行 `tsc -p tsconfig.json`。
- `pnpm test`：先 build，再执行 `node --test "dist/**/*.test.js"`。
- `pnpm demo`：先 build，再执行 `node dist/app/demo.js`。
- `pnpm demo:underground`：先 build，再执行 `node dist/app/underground-demo.js`；可通过 `-- "<goal>"` 传入自定义目标，可通过 `-- --auto-answer "<goal>"` 演示 awaiting_user 恢复，可通过 `-- --out <dir> "<goal>"` 显式写出 Plan Package 兼容文件；可通过 `-- --ai fake "<goal>"` 显式验证 fake AI rootlet 候选接入；`-- --ai openai-compatible "<goal>"` 只有配置完整时才允许真实网络路径。
- `pnpm panel`：先 build，再执行 `node dist/app/panel.js`，启动本地 Node HTTP panel 并打印 URL；默认监听 `127.0.0.1:9090`，作为手动浏览器调试入口；默认配置目录使用 `AGENTARBOR_CONFIG_DIR` 或用户本地配置目录。
- `pnpm panel:smoke`：先 build，再执行 `node dist/app/panel.js --port 0 --smoke`，证明 panel 命令可启动并退出。
- `pnpm panel:desktop`：先 build，再执行 Electron 桌面入口 `dist/app/panel-desktop.js`，默认请求动态端口 `0` 后创建桌面窗口并加载本地 panel server URL；只有用户显式传入 `--port` 时才使用固定端口。
- `pnpm panel:desktop:smoke`：先 build，再执行 Electron 桌面入口的 smoke 模式，证明桌面宿主能启动本地 server、关闭 server 并退出，且不创建窗口。

## Contracts

- TypeScript 必须保持 `strict: true`。
- 测试源码可以放在 `src/**/*.test.ts`，编译后由 Node test runner 执行。
- 完整 demo 必须打印完整 EventLog 顺序和最终 Fruit / RunMemory / ExperienceCandidate / PathBias 摘要。
- 地下-only demo 必须只打印到 Plan Package 边界为止，摘要包含 terminal status、package id/version/status/validation、地下 rootlet / budget / candidate / convergence 信息、可选用户升级信息、AI rootlet kind 状态 / candidate count / fallback count、Convergence Judge `source` / confidence / safe reasoning refs 和 observation layer status。
- 地下-only demo summary 在恢复路径必须包含 `recoveredPackage`、`lineage`、`versions` 和可选 `writtenPackagePath`；不传 `--out` 时 `writtenPackagePath` 应为空，且 repo-root `.agentarbor/` 不得变化。
- 配置中心必须区分普通 settings store 和 local-dev secret store；默认目录不得落在仓库内，测试必须使用临时目录。
- panel HTTP JSON / SSE 只能返回脱敏 provider config、地下 demo summary、Observation Snapshot 子集、Desktop canvas、trace、stream transcript、model visible output 安全投影和由这些输入派生的 tracking read model；可见输出必须来自通过 `outputContract` validation 与 `visibleOutput.fieldTypes` 展示策略的 `ModelResponse.structuredOutput` / `textOutput` 投影或其生成的 rootlet outputs / candidates。不得包含 raw API key、token、完整 prompt、provider raw response、hidden reasoning、provider 原始敏感错误、raw tool output、未校验模型输出、rootlet parser 会拒绝的候选字段或 runtime/store 引用。
- panel 桌面宿主只能是薄 Electron shell：窗口生命周期、`startLocalPanelServer()` 启停和本地 URL 加载。`BrowserWindow` 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，不得新增 raw EventLog、完整 prompt、provider raw response、工具 raw output 或 secret 暴露面。
- `dist/`、`node_modules/` 和 coverage 输出必须保持忽略。

## 生效规则

- 不引入 Vitest/Jest/ESLint/Prettier，除非新任务明确要求并补齐规范。
- 不把 `node --test dist` 作为测试脚本；它在本仓库环境中只报告目录级测试，必须显式匹配 `dist/**/*.test.js`。
- 不用 demo 代替单元测试；demo 是可读链路证明，测试是断言证明。
- 不提交或依赖 `dist/` 输出。

## Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| TypeScript 类型错误 | `pnpm build` 失败 |
| 任一 runtime 守卫回归 | `pnpm test` 失败 |
| EventLog 顺序变化 | `pnpm test` 失败，必要时同步更新 PRD/文档 |
| demo 无法打印完整链路 | `pnpm demo` 失败或人工检查失败 |
| 地下-only demo 进入 Aboveground 或写入 repo-root `.agentarbor/` | `pnpm test` 或 `pnpm demo:underground` 验收失败 |
| Desktop Shell API 缺少 Task Soil、approved Plan、Aboveground artifact 或 Fruit canvas 摘要 | `pnpm test` 验收失败 |
| 默认地下-only demo 未经 fake AI / AgentTurnRuntime 发布 `model.*` 事件，或 `aiMode=none` 禁用边界产出 approved package | `pnpm test` 或 `pnpm demo:underground` 验收失败 |
| fake AI happy path 没有触发 Intent Core、Growth Governor、Rootlet Explorer、Autonomy Reviewer、Convergence Judge 和 Handoff Steward 的模型请求，或 Convergence Judge 仍使用 `ai_advisory` 旁路当主线，或 Handoff Steward 仍用模板叙事创建 approved package | `pnpm test` 验收失败 |
| Convergence Judge 无 AI / fallback 路径产出 approved package，或 fallback confidence 不是低置信 | `pnpm test` 验收失败 |
| `--ai openai-compatible` 缺少 key / model 时仍尝试网络或泄漏密钥 | `pnpm test` 或边界检查失败 |
| panel `openai-compatible` 缺少 key 时仍调用 provider fetch | `pnpm test` 失败 |
| settings store、EventLog、Snapshot、summary、trace、transcript、SSE、HTTP JSON 或测试快照出现 raw API key / token / 完整 prompt / provider raw response / hidden reasoning / raw tool output / 未校验模型输出 / rootlet parser 会拒绝的候选字段 | `pnpm test` 或安全检查失败 |
| `pnpm panel` 不能启动并打印 URL | panel smoke 失败 |
| `pnpm panel:desktop:smoke` 不能启动后退出，或 smoke 创建真实窗口 | desktop smoke 失败 |

## Good / Base / Bad Cases

- Good：新守卫加失败测试，新事件改动更新顺序断言。
- Good：新增 demo 命令时同步测试 summary 纯函数，并运行对应 demo 命令。
- Good：新增 AI demo 开关时同时覆盖默认 fake AI、OpenAI-compatible 配置失败、AI 禁用边界和密钥不泄漏。
- Good：新增 rootlet AI 输出契约时同时覆盖 6 种 kind 的 contract / prompt / parser、fake AI 复杂目标、AI 失败 fallback、AI 禁用边界和缺少 `AgentTurnRuntime` stopped 边界。
- Good：新增上层地下 agent AI 主线时同时覆盖 focused agent `reason()` fake runtime、no-runtime fallback、integration model purpose 顺序、fallback 不 approved 和 safe reasoning trace 脱敏。
- Good：新增本地 panel 时同时覆盖配置更新、AI 禁用模式拒绝、fake AI run、openai-compatible 缺 key / 缺 model、Desktop Shell canvas、async run job、partial / final polling、SSE stream、cursor 续传、stream 断开不影响后台 run、HTTP / SSE 响应脱敏、中文 UI、tracking / transcript / model visible output read model 和 panel command smoke。
- Good：新增桌面宿主时复用现有 panel server，单元测试注入 window/server 依赖覆盖安全默认值、smoke 不创建窗口、关闭幂等和启动失败清理。
- Base：纯类型补充仍运行 `pnpm build` 和 `pnpm test`。
- Bad：只运行 `pnpm demo` 或 `pnpm demo:underground` 后宣称测试通过。

## Tests Required

- 固定事件顺序。
- 状态守卫：approved Plan Package、Aboveground 执行计划 required。
- DirectionHandoff 收束守卫。
- hard constraint block / ask_user。
- artifact 产出和 verification passed。
- RunMemory / ExperienceCandidate / PathBias 生成。
- MessageBus 禁止内部私聊。
- Underground AI 主线测试必须覆盖 Intent Core / Growth Governor / Rootlet Explorer / Convergence Judge / Handoff Steward 的 fake `AgentTurnRuntime` 模型路径，断言 `reason()` 触发模型、`act()` 不做语义决策、`guard()` 不替代目标理解/候选排序/继续探索/方向综合。
- no-AI underground integration 必须断言 stopped / configuration boundary，不得 approved；Convergence fallback 必须 `source = deterministic_fallback` 且低置信。
- 配置中心 raw secret 不进入普通 settings store；panel HTTP JSON 不回显 raw secret；transcript 可以展示通过 validation 和 field type policy 的 visible output 安全投影，但不包含完整 prompt、provider raw response、hidden reasoning、未校验模型输出或 rootlet parser 会拒绝的候选字段。
- openai-compatible 缺 key 在 provider fetch 前失败。
- 桌面 launcher 覆盖安全 `BrowserWindow` defaults、smoke 启停、窗口关闭时 server 清理和 Electron 启动失败清理。

## Wrong vs Correct

### Wrong

脚本写成 `node --test dist`，实际只跑到目录级 1 个测试。

### Correct

脚本写成 `node --test "dist/**/*.test.js"`，并在输出中确认每个测试用例被执行。
