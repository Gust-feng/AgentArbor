# AgentArbor 工作台重设计原型

本目录保存普通 Agent 工作台重设计的静态原型资产。

## 内容

- `agentarbor-ui-redesign.design`：原型页面清单与设计工具元数据。
- `colors_and_type.css`：原型使用的颜色与字体变量。
- `pages/empty-state.html`：空状态首页。
- `pages/chat-active.html`：对话进行中页面。
- `pages/settings.html`：设置面板。
- `pages/tool-display-preview.html`：工具展示预览页面。

## 集成边界

这些文件只作为界面方案参考，不是当前 Panel 的运行时代码。后续实现应在 `src/app/panel-ui/` 内按现有 read-model 契约落地，并补充对应结构测试或组件测试。
