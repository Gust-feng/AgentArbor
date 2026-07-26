# Multi-Agent 源码归档边界

Multi-Agent 实现已从 `src/app/deep/` 迁至 `src/deferred/deep/`，并移出主干构建与 `pnpm test`。本文说明归档动机、边界、验证方式与恢复条件。

## 为什么归档

ADR-0025 保留 Multi-Agent 内部闭环，ADR-0028 明确当前生产主线只有 Ordinary Agent。归档前的实际状态是：

- `panel-server/runtime.ts`（唯一生产 Composition Root）对 deep 的引用数为 **0**。
- `request-handler.ts` 把 `/api/deep/*` 固定为 `410 multi_agent_deferred`。
- 但这些源码仍在主干 `tsconfig` 内编译、仍被 `pnpm test` 发现并执行。

即：约 3 万行代码既不被装配、也不可达，却要付全额成本。

| 项 | 规模 |
| --- | --- |
| `deep/` 生产源码 | 46 文件 / 17,249 行 |
| `deep/` 测试源码 | 25 文件 / 11,638 行 |
| `panel-server/deep-routes.ts` 等外围 | 3 文件 / 约 2,500 行 |
| 合计 | 74 文件 / 31,418 行 |

占全仓 227,144 行的约 13.8%。实测这些测试在主干 `pnpm test` 中耗时 **41.4 秒**，占 Node 测试总时长的近一半。

**保留架构决策不等于保留一份随主干持续漂移的活代码。** 归档把"保留实现快照"与"参与日常开发成本"这两件事分开。

## 归档范围

只归档**后端**实现。移动清单：

| 原路径 | 新路径 |
| --- | --- |
| `src/app/deep/` | `src/deferred/deep/` |
| `src/app/panel-server/deep-routes.ts` | `src/deferred/deep-routes.ts` |
| `src/app/panel-server/multi-agent-run-resources.ts` | `src/deferred/multi-agent-run-resources.ts` |
| `src/app/panel-server/integration-tests/panel-server-deep-routes.test.ts` | `src/deferred/panel-server-deep-routes.test.ts` |

移动前已确认这些文件在生产侧的引用数为 0：`deep-routes.ts` 与 `multi-agent-run-resources.ts` 仅被其自身的测试引用。全部使用 `git mv`，保留文件历史。

### Panel 前端不在本次归档范围

`panel-ui` 中的 deep 前端（`app-deep-task-controller.ts`、`deep-view.tsx`、`contracts/deep.ts` 等）**保持原位**，原因是它与现役代码深度交织：`app-state.ts` 的 `agentMode`、`sidebar.tsx`、`app-workbench-runtime.ts` 都直接持有 deep 字段，拆分需要改动现役状态模型。

当前前端 deep 入口由 `agentClusterEnabled` 控制——一个默认 `false` 的 localStorage 偏好（`app-shell-state.ts:109`）。用户手动开启后界面可渲染，但所有 API 调用都会收到 410。这是归档前既有的行为，本次未改变。

前端归档应作为独立任务，先解耦 `app-state` 中的 deep 字段。

## 边界约束

归档要成立，必须同时守住两个方向，二者都有可执行测试保障（`source-deferred-archive-structure.test.ts`）：

**一、生产代码不得依赖归档区。** 否则归档只是换了个目录名。守卫扫描 `src/app`、`src/adapters`、`src/domain`、`src/kernel`，禁止任何指向 `src/deferred/` 的 import。

**二、归档区不得静默腐烂。** 归档不是删除。如果它无法编译、无测试覆盖，等到未来恢复时才会发现不可用。守卫断言 `src/deferred/` 存在、非空、保留可执行测试，且 `build:deferred` / `test:deferred` 入口仍在。

同时断言 `pnpm test` 不包含 `test:deferred`——否则归档节省的时间会被重新消耗。

既有的 Multi-Agent 架构边界测试（`source-dependency-structure.test.ts` 中的依赖方向、facade 封装、`deep-routes` 薄适配器等）**继续对归档源码生效**，只是路径改为指向 `src/deferred/deep/`。这些断言没有被削弱或删除。

## 构建与验证

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 主干构建，`tsconfig.json` 排除 `src/deferred` |
| `pnpm test` | 主干测试，不含归档 |
| `pnpm build:deferred` | 用 `tsconfig.deferred.json` 把归档连同其依赖的现役模块编译到 `dist-deferred/` |
| `pnpm test:deferred` | 构建后运行归档测试 |

`tsconfig.deferred.json` 继承主配置但取消 `src/deferred` 排除。这意味着**任何对现役模块的改动若破坏了归档模块的编译，`pnpm test:deferred` 会立刻暴露**，而不是等到恢复时。

建议在改动 `model-runtime`、`tool-center`、`capability`、`task-soil`、`context-maintenance` 等被归档区依赖的中性模块后，顺带跑一次 `pnpm test:deferred`。

### 归档内部仍不可运行的用例

`src/deferred/panel-server-deep-routes.test.ts`（22 个用例）被 `run-deferred-tests.mjs` 排除。它是历史 HTTP 套件，断言 `/api/deep/*` 返回真实业务响应，而生产已固定为 410。

这**不是归档造成的回归**：归档前它同样被 `run-node-tests.mjs` 的 `deferredTestKeys` 排除。恢复 Multi-Agent 时需连同这套 HTTP 契约一起重新设计，届时从排除名单移除。

其余 25 个归档测试文件 / 206 个用例全部通过。

## 效果

| 指标 | 归档前 | 归档后 |
| --- | --- | --- |
| `pnpm test` 测试文件数 | 232 | 218 |
| Node 测试耗时 | 约 90 秒 | 约 54 秒 |
| 主干最大源文件 | `multi-agent-feature.ts` 2,733 行 | `agent-session-loop.ts` 2,449 行 |

## 恢复条件

恢复 Multi-Agent 需要一次显式决策，不能靠"把目录搬回去"完成：

1. 先更新 ADR，说明 Multi-Agent 在新产品架构中的定位与边界。
2. 重新设计 `/api/deep/*` 的 HTTP 契约，替换当前的 410。
3. 把 `src/deferred/deep/` 移回 `src/app/deep/`，恢复路径引用。
4. 从 `tsconfig.json` 的 exclude 中移除 `src/deferred`，删除 `tsconfig.deferred.json` 与两个 deferred 脚本。
5. 更新 `source-deferred-archive-structure.test.ts`（届时应被删除）与 `source-dependency-structure.test.ts` 的路径常量。
6. 恢复 `panel-server-deep-routes.test.ts` 并让它对新契约通过。

在此之前，`src/deferred/` 是只读参考实现：可以读、可以编译验证，但不应在其中继续开发新功能。
