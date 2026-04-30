# Skill Manifest 设计

Skill 是可复用能力包。

## 示例

```yaml
id: react-workbench-ui-skill
name: React Workbench UI Skill
version: 0.1.0
purpose: Build IDE-like workbench UI components using React and TypeScript.

inputs:
  - name: layoutSpec
    type: markdown
  - name: stateModel
    type: json

outputs:
  - name: components
    type: files
  - name: tests
    type: files

requiresCapabilities:
  - file.write
  - typescript.generate
  - react.generate

recommendedAgents:
  - BuilderAgent
  - UIAgent

examples:
  - Build a resizable workbench layout.
  - Build a Git timeline panel.
  - Build an execution feed component.

failureModes:
  - Component state becomes coupled with backend logic.
  - UI invents workflow instead of rendering backend events.

verification:
  - TypeScript typecheck passes.
  - Component tests pass.
  - UI reads state from event model rather than hardcoded steps.
```

## Skill 必须包含失败模式

这是非常重要的。Skill 不仅要知道如何成功，也要知道如何失败。

## Skill 与 Plugin 的区别

- Skill 是 Agent 可调用的能力。
- Plugin 是扩展 AgentArbor 平台本体的模块。

## Skill 与 `.agent` 的区别

- `.agent` 定义“谁”。
- Skill 定义“会什么”。

## 设计目的

通过 Skill，AgentArbor 可以把成功经验沉淀为能力资产，避免每次从零生成。
