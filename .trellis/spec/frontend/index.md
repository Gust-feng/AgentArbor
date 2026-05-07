# 前端规范索引

AgentArbor 当前出生了本地 Desktop Shell / Observation Panel 原型。它是未来工作台的最小可用读写面，不是正式前端工作台，也不引入 React、Vite、Next、Tailwind、组件库、状态管理框架或前端测试框架。面板默认使用简体中文，并以 canvas / summary / Observation Snapshot / sanitized config 派生主画布和运行追踪展示。

当前 UI 代码以 Node 内置 HTTP server + 静态 HTML/CSS/JS 字符串存在于 `src/app/`。未来只有在正式前端代码、目录边界和工具链出生后，才能把 hook、状态管理、类型安全等延后规范改写为可执行规范。

| 指南 | 用途 | 当前状态 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | 本地 panel 代码目录和 UI 模块组织。 | 生效：本地 panel 原型 |
| [组件规范](./component-guidelines.md) | 本地 panel 表单、状态、摘要和可访问性边界。 | 生效：本地 panel 原型 |
| [Hook 规范](./hook-guidelines.md) | 自定义 hook 职责和状态副作用模式。 | 延后：等待真实代码 |
| [状态管理](./state-management.md) | 状态归属、缓存、表单和跨组件数据流。 | 延后：等待真实代码 |
| [类型安全](./type-safety.md) | 类型契约和运行时校验要求。 | 延后：等待真实代码 |
| [质量规范](./quality-guidelines.md) | 本地 panel smoke、测试和视觉可读性要求。 | 生效：本地 panel 原型 |
