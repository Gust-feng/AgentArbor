# arbor.json 设计

`arbor.json` 是每个 AgentApp 的出生证明、身份档案和谱系记录。

## 示例

```json
{
  "schemaVersion": "0.1",
  "appId": "daily-report-agent",
  "name": "DailyReportAgent",
  "createdBy": "AgentArbor",
  "createdAt": "2026-04-27T00:00:00Z",
  "rootGoal": "Generate daily reports from computer activity data.",
  "currentGoal": "Generate daily and weekly productivity reports.",
  "status": "maintained",
  "lineage": {
    "parent": null,
    "branch": "main",
    "generation": 1,
    "rebornFrom": null
  },
  "capabilities": [
    "file.read",
    "markdown.export",
    "report.generate"
  ],
  "agents": [
    "ParserAgent",
    "SummaryAgent",
    "InsightAgent",
    "ReviewAgent"
  ],
  "acceptance": [
    "Can parse activity records",
    "Can generate structured markdown report",
    "Can detect low-productivity patterns"
  ],
  "governanceProfile": "standard-agentapp-v1"
}
```

## 字段解释

- `schemaVersion`：元信息格式版本。
- `appId`：唯一 ID。
- `rootGoal`：最初目标。
- `currentGoal`：当前目标，可随 Redirect 更新。
- `lineage`：谱系信息。
- `capabilities`：声明能力。
- `agents`：当前 Agent 组织。
- `acceptance`：验收标准。
- `governanceProfile`：治理策略。

## 设计原则

`arbor.json` 不应该塞入所有细节。它是入口索引，详细内容放在 docs、agents、skills、workflows、execution 中。
