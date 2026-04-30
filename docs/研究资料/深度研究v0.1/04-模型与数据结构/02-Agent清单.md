# `.agent` 文件设计

`.agent` 是 AgentArbor 中 Agent 的定义文件。

## 示例

```yaml
id: review-agent
name: ReviewAgent
role: reviewer
responsibility: >
  Review code changes, architecture consistency, documentation alignment,
  and potential technical debt before a phase can be committed.

modelPolicy:
  preferred: strong-reasoning
  fallback: standard

memoryScope:
  read:
    - docs/**
    - src/**
    - tests/**
    - execution/current-run.json
  write:
    - docs/reviews/**

allowedCapabilities:
  - file.read
  - diff.read
  - test.result.read
  - architecture.check

forbiddenActions:
  - file.delete
  - git.commit
  - shell.execute

inputSchema:
  type: object
  required:
    - diff
    - phaseGoal
    - acceptanceCriteria

outputSchema:
  type: object
  required:
    - verdict
    - issues
    - recommendations

successCriteria:
  - Review identifies architecture drift if present.
  - Review produces actionable recommendations.
  - Review never modifies source code directly.
```

## 原则

Agent 不能只有 prompt。它必须有角色、权限、能力、输入输出和成功标准。

## 关键字段

- `role`：角色。
- `responsibility`：职责。
- `modelPolicy`：模型策略。
- `memoryScope`：可读写范围。
- `allowedCapabilities`：可用能力。
- `forbiddenActions`：禁止动作。
- `inputSchema` / `outputSchema`：结构化接口。
- `successCriteria`：成功标准。

## 设计目的

让 Agent 可审查、可替换、可组合、可治理。
