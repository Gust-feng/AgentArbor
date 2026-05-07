# ADR-0011: AgentArbor 未来产品形态 - 融合架构

## Status

Accepted as historical architecture material, amended by [ADR-0022](ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md).

本 ADR 记录 Agent 集群、动态发育、分层通信和能力治理的结构原则；当前产品全景以 ADR-0022 的桌面通用 Agent 与双运行时架构为准。

## Context

AgentArbor 需要一个既能保证稳定性又能提供无限扩展能力的架构。经过多轮讨论，我们确定了两个核心架构方向：

1. **深度研究报告中的固定架构**：10个固定Agent（Canopy/Trunk/Root三层），状态机，演化系统
2. **动态发育架构**：母Agent→子Agent→代理Agent机制，动态Agent生成，混合通信模式

这两个架构各有优势：
- 固定架构：结构清晰，易于理解，稳定可靠
- 动态架构：无限扩展，上下文隔离，持续进化

最优解是融合两种架构的优点。

## Decision

AgentArbor 采用**固定骨架 + 动态发育 + 分层通信**的融合架构。这个判断由当前树形语义承接：Underground Center、`.agentarbor`、Aboveground Center、Aboveground Growth、Verification、Fruits、Run Memory、Path Bias、Governance 和 Soil 共同构成完整系统。

### 旧融合架构局部图

下图主要描述地上任务执行组织如何分派、拆解和收敛结果；它必须与 Soil、Underground Center、`.agentarbor`、Fruits、Governance、Run Memory、Path Bias 和约束工程共同使用。

```
AgentArbor 未来形态
│
├── 骨架层（Skeleton Layer）- 固定，不可变
│   ├── Canopy集群（决策）
│   │   ├── GoalSteward（目标守护）
│   │   ├── EvolutionJudge（演化裁决）
│   │   └── GovernanceSentinel（治理哨兵）
│   │
│   └── 核心服务（Infrastructure）
│       ├── AgentFactory（Agent工厂）
│       ├── ClusterOrchestrator（集群编排）
│       └── EventBus（事件总线）
│
├── 发育层（Growth Layer）- 动态生成
│   ├── 母Agent（Mother Agent）
│   │   ├── 接收复杂任务
│   │   ├── 分析任务复杂度
│   │   ├── 决定委派策略
│   │   └── 接收结果与证据摘要
│   │
│   ├── 代理Agent（Proxy Agent）
│   │   ├── 接收母Agent任务
│   │   ├── 分解为子任务
│   │   ├── 分化Agent集群
│   │   └── 协调集群工作
│   │
│   └── 子Agent（Child Agent）
│       ├── 专心执行任务
│       ├── 不裁决全局
│       └── 输出简洁结果
│
└── 能力层（Capability Layer）- 动态加载
    ├── MCP能力
    ├── Skills
    ├── Plugins
    ├── Function Tools
    └── 原生能力（Git、Shell、Test等）
```

当前映射如下：

| 旧概念 | 当前处理 |
| --- | --- |
| Canopy 集群 | 拆入 Underground Center、Aboveground Center、Verification 和 Governance，不再作为唯一决策中枢 |
| 母 Agent | 作为 Aboveground Center / Branch 协调职责的早期雏形，不等同于当前地上固定核心 |
| 代理 Agent | 映射到 Branch Agent / Branch Cluster，负责局部分支协调 |
| 子 Agent | 映射到 Leaf Agent，负责具体执行任务 |
| 能力层 | 能力资产进入 Soil，运行期能力通过 Capability Asset 和权限治理引用 |

执行个体可以不承担全局裁决，但必须接收与任务相关的约束切片，提交证据，报告偏离，并在信息不足、验证失败、Path Bias 失效或权限/成本前提变化时触发 Nutrient Request。

### 骨架层设计

#### 1. Canopy集群（历史决策层）

Canopy 集群不再作为当前唯一决策层。其目标守护、演化裁决和治理哨兵思想被拆入当前的 Underground Center、Aboveground Center、Verification、Governance Gate 和约束工程。

- **GoalSteward（目标守护）**
  - 职责：维护北极星目标、约束、停止条件
  - 特点：始终存在，不执行具体任务
  - 输入：arbor_state, verification_summary, debt_summary
  - 输出：decision（continue/pause/redirect/branch/rebirth）
  - 约束：不得直接编写业务代码

- **EvolutionJudge（演化裁决）**
  - 职责：Patch/Refactor/Redirect/Branch/Rebirth裁决
  - 特点：始终存在，基于证据决策
  - 输入：verification report, debt ledger, trace data
  - 输出：evolution decision, proposal file
  - 约束：必须基于证据决策

- **GovernanceSentinel（治理哨兵）**
  - 职责：危险命令拦截、审批、用户暂停/恢复
  - 特点：始终存在，记录所有决策
  - 输入：待执行动作、风险标签、用户指令
  - 输出：approval result, interrupt state
  - 约束：必须记录所有决策

#### 2. 核心服务

- **AgentFactory（Agent工厂）**
  - 职责：动态生成Agent
  - 特点：始终存在，是动态Agent的源头
  - 功能：
    - 管理Agent模板库
    - 根据任务需求创建Agent
    - 评估Agent表现
    - 保留/淘汰Agent

- **ClusterOrchestrator（集群编排）**
  - 职责：管理集群生命周期
  - 特点：始终存在，协调集群工作
  - 功能：
    - 组建集群
    - 分配任务给集群
    - 监控集群状态
    - 解散集群

- **EventBus（事件总线）**
  - 职责：Agent间通信
  - 特点：始终存在，是通信基础设施
  - 功能：
    - 接收和分发事件
    - 记录所有通信
    - 支持发布-订阅模式
    - 支持点对点通信

### 发育层设计

#### 1. 母Agent（Mother Agent，历史名称）

- **职责**：接收复杂任务，分析任务复杂度，决定委派策略，接收结果与证据摘要
- **特点**：
  - 不直接执行具体任务
  - 关心决策、证据、约束满足情况和结果
  - 避免上下文污染
- **功能**：
  - 分析任务复杂度
  - 决定创建子Agent或代理Agent
  - 接收结果、证据和偏离报告，并在必要时触发 Nutrient Request 或计划修订

#### 2. 代理Agent（Proxy Agent）

- **职责**：接收母Agent任务，分解为子任务，分化Agent集群，协调集群工作
- **特点**：
  - 可以进一步分化
  - 管理子集群
  - 递归分化能力
- **功能**：
  - 分解任务为子任务
  - 分化Agent集群
  - 协调集群工作
  - 合并结果

#### 3. 子Agent（Child Agent，历史名称）

- **职责**：专心执行任务，不裁决全局，输出结果与证据
- **特点**：
  - 只知道自己的任务
  - 不裁决其他 Agent 的工作
  - 专注于具体工作
- **功能**：
  - 执行具体任务
  - 输出结果、证据、约束满足情况和异常信号

### 通信机制设计

#### 1. 混合通信模式

- **关键指令** → MessageBus 请求响应（确保可靠性）
  - 创建Agent
  - 分配任务
  - 取消任务
  - 请求结果

- **状态更新** → 事件总线（解耦灵活）
  - 状态变更
  - 进度更新
  - 错误发生

- **结果返回** → MessageBus 响应消息（确保完整性）
  - 结果返回
  - 结果失败
  - 部分结果

- **异常通知** → MessageBus 错误消息（及时处理）
  - Agent失败
  - 任务超时
  - 资源错误

#### 2. 通信流程

```
母Agent执行任务的通信流程：

Step 1: 母Agent接收任务
├── 来源：用户或上层Agent
└── 方式：MessageBus 请求响应

Step 2: 母Agent分析任务
├── 动作：分析复杂度
└── 决策：创建子Agent或代理Agent

Step 3: 母Agent创建Agent
├── 动作：调用AgentFactory
└── 方式：MessageBus 请求响应

Step 4: 母Agent分配任务
├── 动作：发送任务给子Agent/代理Agent
└── 方式：MessageBus 请求响应

Step 5: 子Agent/代理Agent接收任务
├── 动作：确认接收
└── 方式：MessageBus 请求响应

Step 6: 子Agent/代理Agent执行任务
├── 动作：执行具体工作
├── 状态更新：发布到事件总线
└── 方式：事件总线

Step 7: 子Agent/代理Agent返回结果
├── 动作：返回执行结果
└── 方式：MessageBus 请求响应

Step 8: 母Agent接收结果与证据
├── 动作：确认接收
└── 方式：MessageBus 请求响应

Step 9: 记录到事件总线
├── 动作：记录任务完成
└── 方式：事件总线
```

### 生命周期管理

#### 1. 骨架Agent生命周期

```
骨架Agent生命周期：
创建 → 初始化 → 运行 → 销毁
 │        │       │       │
 └────────┴───────┴───────┘
     永久存在，直到系统关闭
```

#### 2. 发育层Agent生命周期

```
发育层Agent生命周期：
│
├── 1. 设计阶段
│   ├── 分析任务需求
│   ├── 选择模板
│   └── 配置参数
│
├── 2. 生成阶段
│   ├── 实例化Agent
│   ├── 加载工具和技能
│   └── 应用护栏
│
├── 3. 执行阶段
│   ├── 接收任务
│   ├── 执行任务
│   └── 输出结果
│
├── 4. 评估阶段
│   ├── 评估表现
│   ├── 记录经验
│   └── 决定保留/淘汰
│
└── 5. 归档阶段
    ├── 优秀Agent → 保留到Agent池
    ├── 一般Agent → 归档到历史
    └── 差Agent → 丢弃或用于反面教材
```

### 与深度研究报告的兼容性

#### 兼容点

- 吸收了 Canopy / Trunk / Root 研究中的目标驱动、治理、验证和演化思想。
- 吸收了固定核心与动态执行并存的组织方式。
- 吸收了状态机、验收矩阵、债务账本、谱系管理和 Git 集成思想。
- 吸收了动态 Agent 生成、上下文隔离和执行集群生命周期管理思想。

#### 扩展点

- 引入了动态Agent生成
- 引入了母Agent→子Agent→代理Agent机制，并在当前架构中收敛为 Core Control / Branch / Leaf 组织模型
- 引入了混合通信模式
- 引入了上下文隔离
- 引入了Agent生命周期管理
- 引入了Agent知识积累

### 核心创新点

| 创新点 | 说明 |
|--------|------|
| **骨架+动态** | 固定骨架保证稳定性，动态发育提供扩展性 |
| **Agent发育** | 历史母 Agent 可以分化子 Agent 和代理 Agent；当前映射为 Branch / Leaf 动态任务集群 |
| **上下文隔离** | 主干保留全局证据与约束，分支保留局部上下文，叶层只接收任务相关切片 |
| **统一消息通信** | MessageBus 请求响应保证可靠性，事件流提供灵活性 |
| **优胜劣汰** | Agent可以被评估、保留或淘汰，持续进化 |
| **递归分化** | 代理Agent可以进一步分化，形成递归结构 |

## Consequences

### 优势

1. **稳定性**：骨架Agent固定，系统行为可预测
2. **扩展性**：动态Agent生成，能力无限扩展
3. **灵活性**：混合通信模式，适应不同场景
4. **可维护性**：上下文隔离，避免信息过载
5. **可进化性**：优胜劣汰，持续优化

### 挑战

1. **复杂度**：动态系统比固定系统更难理解
2. **调试困难**：动态Agent比固定Agent更难调试
3. **资源消耗**：动态生成Agent需要更多资源
4. **稳定性风险**：动态系统可能不如固定系统稳定

### 缓解措施

1. **分阶段实现**：先实现骨架，再实现动态能力
2. **完善监控**：建立完善的监控和日志系统
3. **资源管理**：实现资源池和资源限制
4. **测试覆盖**：建立完善的测试体系

## Related

- [深度研究报告](../../研究资料/深度研究报告.md)
- [ADR-0018: AgentArbor 原生概念树架构](ADR-0018-AgentArbor原生概念树架构.md)
- [ADR-0017: 约束工程与可执行约束模型](ADR-0017-约束工程与可执行约束模型.md)
- [ADR-0010: 产品运行层与开发工具层分离](../协议边界/ADR-0010-产品层与开发工具层.md)
- [ADR-0003: AgentArbor 原生 Agent 不存放在 `.codex`](../协议边界/ADR-0003-AgentArbor原生智能体.md)
