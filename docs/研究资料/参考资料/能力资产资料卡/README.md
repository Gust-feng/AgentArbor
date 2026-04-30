# 能力资产沉淀

本目录保存能力资产的人类可读沉淀。

这里的文档不是官方资料全文，也不是最终实现规格，而是把 `assets/capability-registry/` 中的种子资产转成可讨论、可审查、可继续拆分的资料卡。

## 分层原则

AgentArbor 的能力资产分三层：

```text
Source URL
  -> Source Note
  -> Asset Spec
```

* `Source URL` 负责可追溯。
* `Source Note` 负责人类理解和风险判断。
* `Asset Spec` 负责让代码读取、选择、授权和快照。

## 当前文档

```text
模型供应商资料卡.md
MCP与协议适配资料卡.md
沙箱运行环境资料卡.md
工具技能评测资料卡.md
权限安全资料卡.md
```

## 当前机器可读资产

机器可读草案放在项目根目录：

```text
assets/
  capability-registry/
  providers/
  protocols/
  tools/
  runtime-profiles/
  skills/
  evaluators/
  policies/
```

## 重要边界

当前资产状态是 `seed` 或 `draft`。

这些资产可以指导第一版原型开发，但在进入稳定实现前，每个外部资产都还需要完成：

* 官方来源核验。
* 版本号或访问日期记录。
* 关键字段确认。
* 权限和密钥边界确认。
* Mock / Replay / Live 测试策略。
* 失败模式记录。
* 许可证和使用条款记录。

未经核验的外部资产不得直接进入默认自动执行链路。
