# AgentArbor Tool Fact Sources

Read this file only when the target repository is AgentArbor. The Skill is an Agent Skills adapter and must not become a competing product fact source.

## Authority order

1. Read the repository [AGENTS.md](../../../../AGENTS.md) for ownership, model-judgment, directory, and verification rules.
2. Read [CURRENT_RUNTIME_MODE.md](../../../../CURRENT_RUNTIME_MODE.md) for the software's current production path and actual tool exposure/execution boundary.
3. Read [Tool System V3 Stable Guidance](../../../../docs/开发指南/06-工程实现/14-工具系统V3稳定口径.md) for current implementation rules and [Feature Boundaries and Composition Root](../../../../docs/开发指南/06-工程实现/11-功能模块边界与组合根.md) for ownership.
4. Read the accepted ADRs that own the changed contract:
   - [ADR-0031](../../../../docs/架构设计/产品架构/ADR-0031-工具定义保真与渐进曝光边界.md): definition fidelity, frozen catalog, visibility, authorization, confirmation, active-set recovery, and MCP cost gating.
   - [ADR-0027](../../../../docs/架构设计/产品架构/ADR-0027-工具执行事实与单向消费架构.md): `ToolCallResult`, single-direction projections, continuation, MCP results, and attachments.
   - [ADR-0029](../../../../docs/架构设计/产品架构/ADR-0029-工具结果交付与Ordinary有序执行调度.md): complete delivery, evidence, and metrics. Its scheduling section is superseded by ADR-0030.
   - [ADR-0030](../../../../docs/架构设计/产品架构/ADR-0030-AgentArbor-Pi原生底层架构.md): Pi/AgentArbor ownership, AgentTool execution, Session, confirmation, and scheduling boundaries.
5. Use code and tests as implementation evidence, not as permission to silently redefine an accepted boundary.

Research reports provide background only. `.trellis/tasks/`, this Skill, platform manifests, and optional prose metadata do not override the sources above. If code contradicts `CURRENT_RUNTIME_MODE.md` or an accepted implementation rule, update the owning fact source first when authorized; otherwise report the drift.

## Contract locations

- Definitions, metadata, execution facts, confirmation, and broker ports: `src/domain/tools/contracts.ts`
- Schema fidelity and JSON-safe detachment: `src/domain/tools/schema.ts`
- Provider-visible descriptions and executable contract validation: `src/domain/tools/model-contract.ts`
- Frozen execution boundary and definition/executor matching: `src/app/capability/run-tool-boundary.ts`
- MCP progressive visibility policy: `src/app/capability/run-tool-visibility-policy.ts`
- Real definition cost gate: `src/app/model-runtime/tool-definition-visibility-cost.ts`
- Provider-neutral loop and visibility-plan contracts: `src/app/model-runtime/agent-loop.ts`
- Canonical model projection for one factual tool result: `src/app/model-runtime/tool-result-message.ts`
- Pi active-set, search/load, execution, and recovery adapter: `src/adapters/intelligence/agent-session-loop.ts`
- Execution normalization and delivery: `src/app/tool-center/tool-center.ts`
- Model result projection: `src/kernel/intelligence/tool-call-result-model-view.ts`

Inspect the implementation and its adjacent tests before changing a contract. Do not copy path-specific details into a new shared abstraction unless at least two stable consumers need the same mechanical semantics.

## Focused verification

Build Node output before invoking compiled tests:

```powershell
pnpm build:node
```

Choose the smallest group that covers the changed boundary. Definition, schema, and visibility changes commonly use:

```powershell
node --test dist/domain/tools/schema.test.js dist/domain/tools/model-contract.test.js dist/app/capability/run-tool-boundary.test.js dist/app/capability/run-tool-visibility-policy.test.js dist/app/model-runtime/tool-definition-visibility-cost.test.js
```

Pi active-set, cross-run reset/reconciliation, or model-delivery changes commonly use:

```powershell
node --test dist/adapters/intelligence/agent-session-loop.test.js dist/adapters/intelligence/file-system-agent-session-repository.test.js
```

Execution, evidence, or MCP result changes commonly use:

```powershell
node --test dist/app/tool-center/tool-center.test.js dist/app/tool-center/tool-output-store.test.js dist/adapters/runtime-storage/file-system-tool-output-store.test.js dist/adapters/mcp/mcp-client.test.js
```

Finish with:

```powershell
git diff --check
```

Add broader tests only when the change crosses these groups, changes a shared domain contract, or affects multiple feature consumers. Do not default to the full suite for a documentation- or Skill-only change.
