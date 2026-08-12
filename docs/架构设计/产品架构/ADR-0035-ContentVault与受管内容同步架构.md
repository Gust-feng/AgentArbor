# ADR-0035：Content Vault 与受管内容同步架构

## 状态

已接受。第一阶段在本地完成服务端仓储、HTTP 契约、桌面同步引擎和移动缓存；公网部署与真机联调仍属于后续验证阶段。

本 ADR 部分取代 ADR-0034 中“Space、笔记、资产和受管文件只经 WSS 在线转发、官方服务不保存任何内容”的决定。ADR-0034 对 Conversation、run、确认、命令和 Relay 零内容持久化的约束继续有效。

## 背景

用户需要手机和桌面在任一端创建、删除和编辑 AgentArbor 自己维护的 Space、知识笔记、Workbench Assets 和受管文本文件，并希望首次登录或设备暂时离线时仍能加载这些内容。对话与 Agent 执行仍由桌面 Ordinary 权威维护，官方服务不能长期保存对话正文、AI 输出、命令或确认。

把内容表直接加入 Relay 会让传输层成为 Space、知识库和文件的第二业务 owner；继续只做在线快照又无法提供可靠备份、删除同步和离线收敛。因此需要同一远程服务中的独立 Content Vault。

## 决策

### 1. 服务端是一个部署单元、三个功能边界

```text
AgentArbor Remote Service
  ├─ Remote Identity：账户、邀请码、设备、配对、撤销
  ├─ Remote Relay：socket、presence、在线投递与 receipt
  └─ Content Vault：受管资源版本、change cursor、墓碑与配额
```

- 三个功能可由同一 Linux 进程和同一域名装配，但不能共享业务表或互相读取内部状态。
- Remote Identity 通过窄 `DeviceAuthenticator` query port 给 Relay 与 Vault 提供账户和设备事实。
- Relay 不导入 Vault repository，不保存或重放消息正文；进程退出后在线投递状态清空。
- Content Vault 不运行模型、工具或 Ordinary，不理解 Conversation、run、确认和命令。
- 官方部署与未来自托管使用同一套组合根和协议。自托管只替换配置、存储位置和运维方式，不产生第二套业务实现。

### 2. 数据权威

- Conversation、run、工具事实、确认 continuation 和 Agent 输出仍由桌面 Ordinary 权威维护，只经 `remote-collaboration/v1` 在线转发。
- Space、Personal Knowledge、Workbench Assets、Agent Notes 和受管文件的业务语义仍归各自本地 feature。
- Content Vault 只拥有跨设备共享版本事实：资源 `revision`、`contentHash`、`changeCursor`、`mutationId`、墓碑和配额。
- 桌面与手机都保存本地缓存、同步 cursor 和 durable outbox。Vault 缓存不能恢复 Ordinary runtime，也不能绕过 owning feature 直接修改其 store。

### 3. V1 资源边界

`content-vault/v1` 允许以下逻辑资源：

- `space`、`space_reference`；
- `personal_note`、`knowledge_page`、`knowledge_link`、`knowledge_theme`、`knowledge_assignment`；
- `workbench_asset`；
- `managed_root`、`managed_file`；
- `agent_notebook`，V1 仅同步不依赖本地路径的全局 Agent 笔记。

本地显示顺序可以作为独立资源保存；`recentlyOpened` 保持设备本地。
`knowledge_page` 只有在其引用的 Personal Note 或 Markdown/code Workbench Asset 正文同时可同步时才进入 Vault；引用目录导入或二进制材料的 page、link 和 assignment 保持桌面本地，不能上传不可恢复的空壳元数据。

禁止进入 Vault：

- Conversation、run、AI 输出、命令、确认、工具结果和 Pi Session；
- `local_file`、`workspace_folder`、`web_page` 的外部正文及任何绝对路径；
- `workspaceRoot`、API Key、provider 配置、Skills、MCP、命令环境和 runtime 数据库；
- 未先转换成 AgentArbor 受管资产的外部文件。

Space 投影只使用逻辑资源 ID。`managed_folder.path` 只存在于本地 owner，不进入 Vault；对应 `managed_root` 直接使用 Space reference item ID 作为跨设备稳定身份。工作区 Agent 笔记当前以 `workspaceRoot` 作为本地身份；在产品拥有可跨设备恢复的逻辑工作区 ID 前保持设备本地，不能把绝对路径或不可恢复的路径哈希上传到 Vault。

### 4. 写入、CAS 与删除

每个设备生成稳定 `mutationId`。一次 mutation 包含：

- `kind` 与 `resourceId`；
- `baseRevision`，新建为 `0`；
- `operation: upsert | delete`；
- `payloadSchemaVersion` 与完整 payload；
- 客户端计算的 `contentHash`。

Vault 在单个 SQLite 事务中完成校验、CAS、revision 递增、current resource 更新、change 追加和 quota 更新。同一 `mutationId` 与相同内容返回原结果；同一 ID 携带不同内容明确拒绝。

删除生成 `revision + 1` 墓碑，不物理删除资源身份。旧设备不能用 `baseRevision: 0` 复活墓碑；恢复必须基于当前墓碑 revision 显式重提内容。第一阶段不做 LWW、CRDT 或自动文本合并。

CAS 冲突必须返回当前 revision、hash 和可读取的当前资源。同步继续处理其他资源，不让单一冲突阻塞整个账户。用户解决冲突时可以接受远端、基于当前 revision 重提本地版本，或另存为新资源。

### 5. 拉取、应用与实时节奏

- `POST /v1/vault/mutations` 提交有界 mutation 批次。
- `GET /v1/vault/changes?after=<cursor>&limit=<n>` 拉取增量。
- `GET /v1/vault/snapshot` 用于首次加载或 cursor 失效后的恢复；首个响应固定 `changeCursor`，后续使用资源身份键集分页，避免并发增删导致 `OFFSET` 位移和漏同步。
- `GET /v1/vault/resources/:kind/:id` 读取一个资源。
- `GET /v1/vault/usage` 返回配额事实。

cursor 只有在 owning feature 应用资源与本地同步元数据都成功持久化后才能推进。崩溃发生在中间时依靠 mutationId/revision 幂等重放。

如果当前桌面构建没有装配某个资源 kind 的 contributor，该资源必须形成持久 `remote_apply_failed` 冲突并保留远端 current resource，不能静默推进后假装已经应用。手机只能对 owning feature 已支持删除的资源显示删除操作；当前支持 Personal Note、全局 Agent Note 与受管文本文件删除，Space 和 Workbench Asset 不暴露远端删除。

桌面 feature event 用于低延迟唤醒同步；启动和周期 reconciliation 用 contributor fingerprint 补齐进程异常造成的空隙。Vault mutation 成功后，Remote Service 通过既有 WebSocket 向同账户其他在线设备发送只含 change cursor 的 `vault.changed` 通知；通知不携带正文，设备仍通过 HTTPS 拉取 change。通知丢失时由 10 秒周期 reconciliation 兜底。文本编辑沿用桌面当前 `500ms` autosave 节奏：业务保存成功后进入同步 outbox，同一资源尚未发送的连续修改只保留最新完整版本；已经发送但未确认的版本不能被伪装成已同步。

### 6. 配额和隐私

第一阶段官方默认配额：

- 每账户 active content 总量 `150 MiB`；
- 每个 inline 文本资源最大 `5 MiB`；
- 每批最多 `100` 个 mutation 且 JSON body 最大 `4 MiB`；
- 每账户最多 `50,000` 个 active resource；
- Agent Note 继续受本地 `20,000` 字符限制。

超限返回 `resource_too_large`、`batch_too_large` 或 `vault_quota_exceeded`，不截断、不静默淘汰。首阶段只同步受管文本和现有可编辑文本资产；二进制文件必须在后续设计独立 blob 生命周期后才能进入，不允许 base64 塞入 inline payload。

当前没有端到端加密，必须明确官方服务可读取 Vault 内容。TLS、token hash、按账户查询隔离、正文不进入日志、独立 Vault 表和可验证备份是最低边界。设备撤销后 Relay 与 Vault 立即拒绝该 token。

### 7. 移动端与桌面端边界

- 移动端 Relay client 与 Vault client 分离；IndexedDB 中 realtime cache/outbox 与 vault resource/cursor/outbox 分离。
- 手机可以在电脑离线时读取 Vault 内容并提交受管内容 mutation；它不能在电脑离线时启动 Ordinary 或批准已失效的 confirmation。
- 桌面通过每个 owning feature 的 contributor port 导出、应用和监听可同步资源；同步引擎不能读取 feature 私有 SQLite。
- 从手机增加、删除或修改文件后，桌面 applying 必须走与本地 UI 相同的 feature command 和文件写入边界；桌面本地变化也通过同一资源 revision 上传。

## 不采用

- 给 Relay store 直接增加内容表：会混淆实时传输和持久内容所有权。
- 把各 feature SQLite 或整个 runtime 上传：泄漏本地事实并破坏模块契约。
- 只在设备同时在线时传快照：不能提供备份、离线浏览和可靠删除。
- 自动 LWW 或 CRDT：单用户两设备的冲突应明确、可见、可恢复。
- 为尚未发布的开发协议维护 V1/V2 双读双写：当前直接收敛为 V1，只有真实发布后才讨论兼容升级。
- 首阶段同步任意二进制和本地磁盘：超出当前产品边界和容量模型。

## 后果

- 官方服务器会持久保存用户明确允许同步的 AgentArbor 自有内容，隐私说明必须与零对话持久化同时成立。
- Relay 的性能和隐私边界保持简单；内容容量、备份、删除和冲突由 Vault 独立承担。
- 桌面与手机需要新增同步元数据、outbox、cursor 和冲突投影，但不需要复制业务 feature 或建立第二个 Agent runtime。
- 自托管可以复用同一实现，后续只需补充部署配置、备份与恢复指南。
