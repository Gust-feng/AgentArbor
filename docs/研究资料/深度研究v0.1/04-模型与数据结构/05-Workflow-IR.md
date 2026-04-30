# Workflow IR：动态任务图设计

Workflow IR 是 AgentArbor 把计划转成可执行任务图的中间表示。

## 示例

```json
{
  "workflowId": "wf-core-runtime-v1",
  "goal": "Implement AgentArbor Core Runtime",
  "phase": "core-runtime",
  "status": "active",
  "nodes": [
    {
      "id": "t1",
      "type": "task",
      "title": "Implement EventBus",
      "assignedRole": "BuilderAgent",
      "acceptance": [
        "EventBus can publish and subscribe events",
        "Events are persisted for replay"
      ]
    },
    {
      "id": "t2",
      "type": "task",
      "title": "Implement AgentRuntime",
      "assignedRole": "BuilderAgent",
      "dependsOn": ["t1"],
      "acceptance": [
        "AgentRuntime can execute a structured task",
        "AgentRuntime emits lifecycle events"
      ]
    },
    {
      "id": "v1",
      "type": "verification",
      "title": "Run core tests",
      "dependsOn": ["t2"],
      "acceptance": [
        "pnpm test passes for packages/core"
      ]
    }
  ],
  "edges": [
    { "from": "t1", "to": "t2", "kind": "depends_on" },
    { "from": "t2", "to": "v1", "kind": "must_verify" }
  ]
}
```

## 节点类型

- task；
- verification；
- user_confirmation；
- capability_acquisition；
- documentation_update；
- git_checkpoint；
- reflection；
- evolution_decision。

## 状态

- draft；
- active；
- blocked；
- failed；
- completed；
- superseded。

## 关键原则

Workflow IR 是动态的。它可以被修改，但修改必须事件化，并留下原因。
