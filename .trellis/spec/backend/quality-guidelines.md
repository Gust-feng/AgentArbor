# 后端质量规范

当前阶段已建立第一阶段运行时工具链：`pnpm + TypeScript + tsc + node:test`。这里的“后端质量”指内存 runtime kernel 质量，不包含 HTTP 服务、数据库或 UI。

## Scope / Trigger

- Trigger：修改 `package.json`、`tsconfig.json`、`src/**`、`tests/**` 或 demo 行为。
- Scope：最小运行内核构建、测试和 demo 验收。

## Signatures

- `pnpm build`：执行 `tsc -p tsconfig.json`。
- `pnpm test`：先 build，再执行 `node --test "dist/**/*.test.js"`。
- `pnpm demo`：先 build，再执行 `node dist/app/demo.js`。
- `pnpm demo:underground`：先 build，再执行 `node dist/app/underground-demo.js`；可通过 `-- "<goal>"` 传入自定义目标，可通过 `-- --auto-answer "<goal>"` 演示 awaiting_user 恢复，可通过 `-- --out <dir> "<goal>"` 显式写出 Direction Handoff Package；可通过 `-- --ai fake "<goal>"` 显式验证 fake AI rootlet 候选接入；`-- --ai openai-compatible "<goal>"` 只有配置完整时才允许真实网络路径。

## Contracts

- TypeScript 必须保持 `strict: true`。
- 测试源码可以放在 `src/**/*.test.ts`，编译后由 Node test runner 执行。
- 完整 demo 必须打印完整 EventLog 顺序和最终 Fruit / RunMemory / ExperienceCandidate / PathBias 摘要。
- 地下-only demo 必须只打印到 `.agentarbor` Direction Handoff Package 边界为止，摘要包含 terminal status、package id/version/status/validation、地下 rootlet / budget / candidate / convergence 信息、可选用户升级信息、AI rootlet kind 状态 / candidate count / fallback count 和 observation layer status。
- 地下-only demo summary 在恢复路径必须包含 `recoveredPackage`、`lineage`、`versions` 和可选 `writtenPackagePath`；不传 `--out` 时 `writtenPackagePath` 应为空，且 repo-root `.agentarbor/` 不得变化。
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
| 默认地下-only demo 发布 `model.*` 事件或创建 provider | `pnpm test` 或 `pnpm demo:underground` 验收失败 |
| `--ai openai-compatible` 缺少 key / model 时仍尝试网络或泄漏密钥 | `pnpm test` 或边界检查失败 |

## Good / Base / Bad Cases

- Good：新守卫加失败测试，新事件改动更新顺序断言。
- Good：新增 demo 命令时同步测试 summary 纯函数，并运行对应 demo 命令。
- Good：新增 AI demo 开关时同时覆盖默认 no-AI、fake AI、OpenAI-compatible 配置失败和密钥不泄漏。
- Good：新增 rootlet AI 输出契约时同时覆盖 6 种 kind 的 contract / prompt / parser、fake AI 复杂目标、AI 失败 fallback 和默认 deterministic no-AI。
- Base：纯类型补充仍运行 `pnpm build` 和 `pnpm test`。
- Bad：只运行 `pnpm demo` 或 `pnpm demo:underground` 后宣称测试通过。

## Tests Required

- 固定事件顺序。
- 状态守卫：approved DirectionHandoff、GrowthPlan required。
- DirectionHandoff 收束守卫。
- hard constraint block / ask_user。
- artifact 产出和 verification passed。
- RunMemory / ExperienceCandidate / PathBias 生成。
- MessageBus 禁止内部私聊。

## Wrong vs Correct

### Wrong

脚本写成 `node --test dist`，实际只跑到目录级 1 个测试。

### Correct

脚本写成 `node --test "dist/**/*.test.js"`，并在输出中确认每个测试用例被执行。
