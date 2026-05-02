# AgentArbor Governance Guide

Use this guide whenever work touches AgentArbor repository structure, docs, skills, agents, Trellis configuration, `.agentarbor/`, `.codex/`, `.opencode/`, or root-level project instructions.

## Source Of Truth

- `AGENTS.md` is the hard execution rule for AI contributors.
- `docs/README.md` is the human-readable documentation entry.
- `docs/开发指南/` is the formal chaptered product and development guide.
- `docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md` is the current product architecture fact source.
- `docs/架构设计/产品架构/ADR-0019-地下辐射生长模型.md` defines the accepted Underground Center radial-growth model.
- `docs/架构设计/产品架构/ADR-0020-智能通道与模型接入边界.md` defines the accepted model access boundary.
- `.trellis/` is the current workflow harness and contextual spec layer.
- `.agents/skills/` is the shared Agent Skills layer.
- `.codex/` is Codex development adapter configuration.
- `.opencode/` is OpenCode development adapter configuration.
- `.agentarbor/` is the future AgentArbor-native direction handoff package from Underground Center to Aboveground Center, not the final asset store, not a Soil copy, and not the current documentation workspace.

## Native Concept Tree Rule

The active architecture is:

```text
Soil -> Underground Center -> .agentarbor -> Aboveground Center -> Fruits -> Governance -> Soil
```

- Soil owns governed long-term assets, constraints, capability assets, path bias, evidence, and lineage.
- Underground Center turns user imagination into a judged direction through requirement shaping, contradiction, evidence, asset fit, necessary user clarification, and runtime nutrient supply.
- `.agentarbor` carries task authorization, direction basis, constraint references, evidence references, asset references, risks, and Growth Entry fields from Underground Center to Aboveground Center.
- Aboveground Center turns the handoff package into Growth Plan, Workflow IR, context topology, execution organization, validation gates, and revision control.
- Current implementation priority is the independent Underground loop: user need -> underground exploration / contradiction / convergence -> necessary user clarification and recovery -> approved `.agentarbor` Direction Handoff Package. Its terminal states are `approved_package_created`, `awaiting_user`, and `stopped`.
- Intelligence Channel is the only model access route. AI output remains candidate, draft, explanation, or advice until deterministic convergence, validation, verification, or governance promotes it.
- Aboveground organizations eventually grow along the approved direction. When evidence, Soil asset fit, external facts, constraint detail, context, capability hints, or key-assumption validation are missing, they send a Nutrient Request to Underground Center instead of creating their own direction-exploration cluster. This is a later cross-stage collaboration route and must not become the immediate next mainline before the Underground single loop and Aboveground single loop are stable.
- Fruits are deliverables, AgentApps, capability packages, run memories, or experience candidates; they are not Soil until Governance validates, attributes, versions, permissions, and retirement policy.
- Governance is the only route from Fruits back into Soil.

## Collaboration Rule

The user primarily provides direction adjustments, value judgment, and boundary confirmation. AI contributors must turn those inputs into implementable architecture, documentation, task plans, and code paths.

User input is an important direction signal, not the only standard. AI contributors must actively check architecture consistency, long-term maintainability, directory boundaries, runtime contracts, validation evidence, and technical-debt risk. When a better direction, local-optimum risk, boundary confusion, documentation bloat, or implementation risk appears, AI contributors must raise it with reasons and a concrete alternative instead of silently freezing the user's temporary idea as final architecture.

Discussion becomes project fact only after it lands in an ADR, development guide, task contract, or implementation.

## Underground Radial Growth Rule

Underground Center is not a linear pipeline. It uses a fixed center with temporary radial exploration clusters: stable center, dynamic rootlets, divergent exploration, convergent direction decision.

- The stable center owns intent, growth budget, constraints, evidence ledger, convergence, and handoff assembly.
- Temporary rootlet clusters can explore options, risks, asset fit, evidence, constraints, and counterfactuals.
- Rootlet clusters must have bounded input, budget, output, and exit criteria.
- In the current Underground single-loop priority, the result must converge into an approved `.agentarbor` Direction Handoff Package, a user escalation, or a recorded stop reason.
- Nutrient Patch output belongs to later Nutrient Request / Growth Plan Revision collaboration after the single Underground loop and single Aboveground loop are stable.
- `.agentarbor` may include `options.json`, `decision-record.md`, and `risk-register.md`, but it must not become a Growth Plan, final asset store, or Soil copy.

## Documentation Rule

`docs/` must stay clean before implementation. The active docs tree only keeps formal development guidance, architecture design, and research material that can inform future development:

- keep `docs/开发指南/` as the stable current development entry;
- keep `docs/任务看板/` as the human-readable board asset derived from `.trellis/tasks/`; it is not a source of truth;
- keep `docs/研究资料/` for research reports, early product material, engineering research, and external reference research;
- keep `docs/架构设计/` for long-term product architecture, protocol boundaries, workspace structure, and the current native concept-tree architecture;
- use Simplified Chinese folder names, document names, and prose, except conventional `README.md` index files;
- do not mix historical discussions into the current development guide;
- delete historical experiences, progress records, planning residue, session handoffs, preparation packs, and unvalidated draft packs when they do not provide direct architecture or research value;
- keep indexes accurate and minimal.

## Required Workflow

1. Read `docs/README.md`, `docs/开发指南/README.md`, and `docs/开发指南/00-总览.md` before structural work.
2. Use Trellis skills as the default workflow surface:
   - `trellis-before-dev` before implementation;
   - `trellis-check` before handoff;
   - `trellis-update-spec` when a reusable rule belongs in `.trellis/spec/`;
   - `trellis-finish-work` only when the working tree is ready for a clean task close.
3. Do not recreate noisy active planning/progress/experience trees in `docs/`. Trellis owns task lifecycle state; docs keeps stable guide, research, and architecture only.
4. When Trellis task state or next actions change, update `docs/任务看板/看板.md` through the `trellis-task-board` skill, and keep `README.md` / `规则.md` aligned when the asset structure changes.

## Layer Boundaries

- Trellis owns task lifecycle, contextual specs, workflow state, and multi-platform adapters.
- `docs/` owns stable human-readable product and development guidance.
- `.agentarbor/` owns future native direction handoff package material only after its contracts are stable and a real task birth reason exists.
- `.codex/` and `.opencode/` are platform adapters, not AgentArbor-native product source data.
- `docs/任务看板/` projects `.trellis/tasks/` for humans and must be rebuildable from Trellis state.

## Record Placement

- Hard execution rules belong in `AGENTS.md`.
- Human-readable project guidance belongs in `docs/`.
- Current workflow state belongs in `.trellis/`.
- Codex adapter agents belong in `.codex/agents/`.
- OpenCode adapter agents belong in `.opencode/agents/`.
- Agent Skills belong in `.agents/skills/`.
- Future AgentArbor-native direction handoff package material belongs in `.agentarbor/` only when it has task authorization, contract coverage, and real evidence references.

Do not store current documentation history, progress records, or workflow handoffs in `.agentarbor/`.

## Structural Checks

- `docs/` top level contains only `README.md` and approved Chinese directories.
- `docs/任务看板/` contains only human-readable board pages derived from Trellis task state and stable development-guide direction.
- `docs/开发指南/` contains the active chaptered product positioning, core loop, architecture, contracts, agent lifecycle, engineering rules, and implementation entry boundary.
- `.agents/` contains only `skills/` and optional `plugins/`.
- `.agents/skills/` skill folder names match `SKILL.md` frontmatter names.
- `.codex/agents/*.toml` is Codex development tooling, not AgentArbor product source.
- `.opencode/agents/*.md` is OpenCode development tooling, not AgentArbor product source.
- `.agentarbor/` contains only native direction handoff package material with real birth reasons; it must not contain final assets, Soil asset copies, placeholder agents, placeholder workflows, or undocumented schemas.

## Child-Agent Fruit Boundary

Mature child agents are fruit-layer capability assets. Apply this rule whenever work discusses generated agents, detachable agents, agent export packages, or direction handoff material that references future generated agents.

- A child agent starts as a temporary execution ability; it does not automatically have long-term identity.
- A child agent can become fruit only after evaluation, human confirmation, permission review, versioning, and registry governance.
- Detachment from the mother runtime is an explicit governance action, not the default result of registration.
- Detached child agents must not inherit mother runtime permissions, secrets, asset scopes, task history, or registry write access by default.
- Do not create child-agent handoff material under `.agentarbor/` until a concrete native agent contract, schema mapping, governance route, and birth reason are defined.
- Codex and OpenCode agent files are platform adapters or export surfaces; they are not AgentArbor-native child-agent source of truth.

## Closeout

For non-trivial structural changes:

1. Confirm the user goal was satisfied.
2. Confirm indexes and links point to real files.
3. Confirm obsolete documentation trees were not reintroduced.
4. Validate affected JSON, YAML, TOML, Markdown links, and skill frontmatter.
5. Report any residual risk directly.

Do not create documentation records purely to satisfy old process habits when the user asked for a clean documentation set.

## Windows Notes

Use commands that work in this repository's Windows-first environment:

- Prefer `python` over `python3` in local Trellis command examples.
- Prefer PowerShell-native file reads/searches when shell examples are only illustrative.
- Do not rely on Unix-only commands in project-local specs unless a cross-platform alternative is also given.
