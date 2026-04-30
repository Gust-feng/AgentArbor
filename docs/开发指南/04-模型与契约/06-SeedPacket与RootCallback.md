# SeedPacket 与 RootCallback

## SeedPacket

SeedPacket 是 Seed Cluster 的输出，也是 Root System 的正式输入。它建议以文件夹形态保存：

```text
seed-packet/
  00-用户原始想象.md
  01-目标成像.md
  02-非目标与边界.md
  03-假设与缺失信息.md
  04-最小化搜索.md
  05-反驳与风险.md
  06-可选方向.md
  07-用户决策记录.md
  08-启动建议.md
  handoff-to-root.md
  seed.meta.json
```

## seed.meta.json

`seed.meta.json` 至少包含：

- `seedId`。
- `status`：`draft`、`awaiting_user`、`approved`、`rejected`、`superseded`。
- `sourceImagination`。
- `createdAt`。
- `approvedAt`。
- `riskLevel`。
- `requiredUserDecisions`。
- `handoffPath`。

## RootCallback

RootCallback 是运行期补探机制。

最小字段：

- `callbackId`。
- `triggeredBy`：Core Control Cluster、Branch Agent 或 Flower Cluster。
- `reason`。
- `growthPlanVersion`。
- `relatedTaskId`。
- `relatedVerificationId`。
- `recommendedMode`：`lateral` 或 `deep`。
- `expectedOutput`：新 Root Brief 版本或无需重探证据。
- `status`：`requested`、`running`、`completed`、`rejected`。

## Handoff

Root System 只能读取已通过 User Approval Gate 的 Seed Packet。`handoff-to-root.md` 必须说明：

- 要探索的问题。
- 已确认边界。
- 不应再询问用户的问题。
- 仍允许回问用户的问题。
- 不可越过的权限和风险边界。

## 禁止事项

- SeedPacket 不能替代 GrowthPlan。
- RootCallback 不能绕过 Verification。
- Deep Rooting 不能静默改写目标。
- GrowthPlan Revision 不能缺少用户可追踪记录。
