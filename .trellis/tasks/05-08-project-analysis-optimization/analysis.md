# 项目问题分析与优化方向

## 结论

当前项目不是“跑不起来”的问题：`pnpm build`、`pnpm test`、`pnpm panel:smoke`、`pnpm demo` 均通过，`pnpm test` 当前 265 个用例全绿。真正的问题是：项目已经拥有完整架构词汇、规格、事件链和观察面，但用户可见的交付价值仍主要停留在本地内存闭环和固定 artifact。换句话说，项目的问题是“架构证明强，产品证明弱”。

## 当前最有价值的闭环

当前最能证明价值的路径是：

```text
Desktop Shell
  -> Task Soil
  -> Underground Cognitive Runtime
  -> Plan Package
  -> Aboveground minimal consumer
  -> Artifact
  -> Verification
  -> Fruit / Run Memory / Experience Candidate / Path Bias
  -> Observation Panel / Main Canvas
```

关键入口是 `src/app/minimal-loop.ts` 的 `runMinimalLoop()`。它能把地下 AI/fake-AI 方向成形、Plan Package、Task Soil、安全观察投影、最小 Aboveground、治理候选串起来。

但这条闭环目前更像“产品骨架验收”，不是“用户会觉得有用的任务交付”。`WorkerAgent` 产出的 artifact 是固定内存文本，`VerificationReport` 基本是结构性通过，Governance / Soil Return 仍是候选或 stub。

## 主要问题（按优先级）

### P0：项目事实源和叙事入口不一致

根 `README.md` 仍以 ADR-0018 / 原生概念树 / 第一阶段确定性最小内核为主线；`docs/README.md`、`AGENTS.md`、ADR-0022、Trellis spec 已经转向 Desktop Shell / Task Soil / 双运行时。

影响：新贡献者会从入口读到旧方向，误以为项目仍在做 AgentApp 孕育平台或 `.agentarbor` 概念树，而不是桌面通用 Agent MVP。

建议：优先统一 `README.md`、`.agentarbor/README.md`、`package.json.description`、任务看板摘要，只保留 ADR-0022 作为当前产品事实源。

### P0：完整链路已命名，但用户可见产物太弱

项目已经有 Task Soil、Underground、Plan、Aboveground、Fruits、Governance、Path Bias、Observation Panel，但真正的用户成果仍是最小内存 artifact。

影响：演示时能展示“agent 怎么跑”，但很难证明“系统替用户完成了一个有价值的任务”。

建议：不要先扩展更多架构节点；先选一个可见交付类型，例如“基于项目/网页/文件 refs 生成一份可验证报告或执行计划”，让 Aboveground 消费 Plan 和 Task Soil，产出真实内容 artifact。

### P1：复杂度集中在地下 runtime 和 panel，超过当前 MVP 产出

当前 `src/app` 约 104 个 TS 文件 / 29k 行，是最大复杂度区域。热点包括：

- `src/app/panel-assets.ts`：约 2552 行静态 HTML/CSS/JS。
- `src/app/panel-server.ts`：HTTP 路由、配置、同步/异步 run、SSE、错误映射、job 调度都在一个集成面。
- `src/app/panel-run-read-model.ts`：tracking / trace / transcript / stream read model 体量较大。
- `src/app/underground/orchestrator.ts`：固定串起多类地下 agent，实际拓扑仍是硬编码。

影响：每次改产品体验都容易穿过多层内部读模型和事件契约，迭代成本高。

建议：不做大重写。先按“产品路径”拆：Desktop run API、run job/SSE、canvas read model、observation read model、static assets 各自保持单一职责。地下层暂时只保留一条主入口，其他 dispatcher/legacy 入口降为兼容 adapter。

### P1：兼容命名债增加理解成本

`DirectionHandoffPackage`、`PlanPackage`、`direction_handoff.*`、`underground-agent-cluster-runtime`、`UndergroundAgentOrchestrator` 等新旧概念并存。代码里多处说明“legacy wire shape / compatibility class name retained”。

影响：读者需要同时理解历史名字和当前产品语义，容易把旧概念继续扩张。

建议：应用层只暴露产品名 `PlanPackage` / `Plan`；legacy `DirectionHandoff*` 留在内部兼容层或 barrel alias，不再作为新代码的首选 import 和新规格语言。

### P1：AI-first 叙事强，但真实 AI 成功路径不是默认质量信号

默认测试主要验证 fake/stub AI、配置边界、provider adapter stub。真实 provider smoke 是独立命令路径；本轮已补上 `pnpm smoke:real-ai` 包脚本，并把该入口切到 Cognitive Work Session 主线。

影响：测试全绿不等于真实用户能跑出有价值结果；演示前仍需要手动验证真实 provider。

建议：继续保持 `pnpm smoke:real-ai` 只在显式运行时触发真实 provider；用项目分析 golden goal 验收真实 AI 能产出 artifact、evidence refs 和安全 canvas，而不是只验证缺配置 skip。

### P2：Soil / Governance / Path Bias 现在主要是术语闭环，不是有效学习闭环

当前 Soil 是只读 refs，Governance 产出 RunMemory / ExperienceCandidate / PathBias 但没有真正进入下一轮可用的长期学习循环。

影响：“越用越聪明”是产品承诺，但当前只能证明对象被生成，不能证明下一次任务真的因此更好。

建议：MVP 中诚实降级为“候选沉淀和可观察记录”。不要做完整 Global Soil 写入；只做一个可验证的小回路：下一次相似任务能读取上一轮 PathBias ref，并在 canvas 中解释它如何影响方案排序。

### P2：测试强但偏内部契约，用户价值验收不足

265 个测试全过，质量信号在类型、状态机、事件、脱敏、panel JSON/SSE、provider boundary 上可信。但测试大量断言内部事件顺序、candidate refs、rootlet kinds、guard 状态等。

影响：内部稳定性强，但产品效果回归不一定被快速捕捉。

建议：增加少数产品级 smoke/golden 测试：输入任务 + context refs -> approved Plan -> meaningful artifact -> verification evidence -> canvas final result。内部契约测试保留，但新功能先补产品验收。

## 根因判断

项目当前最大根因是：长期平台愿景和比赛/MVP桌面产品目标叠在一起，导致很多架构名词提前“出生”。每个节点都有 spec、事件、read model、测试，但真正让用户感知价值的 Aboveground 产物、真实上下文消费、真实 AI 成功路径还没同等成熟。

## 推荐优化原则

1. **冻结新概念扩张**：不是 Desktop 单入口闭环必须用到的概念，暂不新增。
2. **先做一个真实交付物**：让 Aboveground 产出用户能读、能保存、能验证的 artifact。
3. **架构词汇降噪**：当前主线只讲 Desktop Shell、Task Soil、Plan、Artifact、Observation；Governance/Soil 先讲候选，不讲完整平台。
4. **真实 AI 变成显式验收**：保留 fake/stub 默认测试，但必须有一条真实 provider smoke 证明产品路径。
5. **重构只沿热点切薄，不大迁移**：优先拆 panel-server / panel-assets / Plan naming facade，不碰地下核心算法大改。
6. **测试从“内部全覆盖”补到“产品黄金路径”**：每个后续优化都问：这是否让用户任务闭环更有价值？

## 建议下一批任务

### 任务 1：统一当前事实源入口

目标：把根 README、`.agentarbor/README.md`、package description、看板当前摘要统一到 ADR-0022。

验收：新读者从根入口只会理解为 Desktop 通用 Agent MVP，不再读到 ADR-0018 作为当前事实源。

### 任务 2：做一个真实 Aboveground artifact

目标：Aboveground 不再只写固定字符串，而是消费 Plan + Task Soil refs/preview，生成一份可验证的用户成果。

建议成果类型：任务分析报告 / 项目上下文摘要 / 网页调研简报 / 执行计划。先选一个。

验收：panel canvas 能展示 artifact 摘要、来源 refs、验证证据和失败诊断。

### 任务 3：真实 AI smoke 产品化

目标：用已新增的显式脚本和 golden case，证明 openai-compatible 配置完整时可以跑完整 Cognitive Work Session path。

验收：缺配置安全 skip；配置完整时完成 Work Session artifact + canvas；不泄漏 key、raw prompt、raw provider response。

### 任务 4：降低 panel 复杂度

目标：不换 UI 框架，只按职责切分 panel 代码。

建议边界：route handlers、run job/SSE、config routes、desktop run response、static asset chunks。

验收：行为不变，测试仍通过；后续改 canvas 或 stream 不需要穿过整个 `panel-server.ts`。

### 任务 5：Plan Package 命名收敛

目标：新增代码只使用产品语义 Plan/PlanPackage；DirectionHandoff 仅保留兼容层。

验收：app 层核心路径的 import 和类型名减少历史概念暴露，spec 明确 legacy 名称不再扩张。
