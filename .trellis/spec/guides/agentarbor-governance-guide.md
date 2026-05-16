# AgentArbor Governance Guide

Use this guide whenever work touches AgentArbor repository structure, docs, skills, agents, Trellis configuration, `.agentarbor/`, `.codex/`, `.opencode/`, or root-level project instructions.

## Source Of Truth

- `AGENTS.md` is the hard execution rule for AI contributors.
- `docs/README.md` is the human-readable documentation entry.
- `docs/开发指南/` is the formal chaptered product and development guide.
- `docs/架构设计/产品架构/ADR-0022-AgentArbor桌面通用Agent与双运行时架构.md` is the long-term product architecture fact source.
- `docs/架构设计/产品架构/ADR-0024-桌面基础Agent与基础设施优先路线.md` is the current active implementation route.
- `docs/架构设计/产品架构/ADR-0018-AgentArbor原生概念树架构.md` is historical context only; it is partially superseded by ADR-0022.
- `docs/架构设计/产品架构/ADR-0019-地下辐射生长模型.md` defines the historical radial-growth basis now framed as Underground Cognitive Runtime.
- `docs/架构设计/产品架构/ADR-0020-智能通道与模型接入边界.md` defines the accepted model access boundary.
- `.trellis/` is historical Trellis workflow/spec material. `.trellis/tasks/` is no longer the current task, constraint, or context source.
- `.agents/skills/` is the shared Agent Skills layer.
- `.codex/` is Codex development adapter configuration.
- `.opencode/` is OpenCode development adapter configuration.
- `.agentarbor/` is the future Plan Package storage form, not a product concept-tree node, not the final asset store, not a Soil copy, and not the current documentation workspace.

## Current Product Architecture Rule

The active architecture is:

```text
Desktop Shell -> Task Soil -> Underground Cognitive Runtime -> Plan -> Aboveground Execution Runtime -> Fruits -> Governance Pipeline -> Global Soil
```

- Desktop Shell is the single user-facing entry.
- Task Soil holds the current task goal, refs, temporary constraints and permission boundaries.
- Underground Cognitive Runtime turns task intent into a judged Plan through exploration, parent synthesis, convergence, necessary user clarification, or stopped state.
- Plan / Plan Package carries direction basis, constraint refs, evidence refs, risks and execution entry from Underground to Aboveground. `.agentarbor` is only an implementation/storage form for Plan Package.
- Aboveground Execution Runtime consumes approved Plan and produces execution artifacts, verification and Fruits.
- Current implementation priority is the default Desktop Basic Agent: task input, continuous conversation, model/tool loop, confirmation, safe events, persistence, and workbench result presentation. Visible deep entry and deep backend expansion are frozen for future work unless the user explicitly restarts that project.
- Intelligence Channel is the only model access route. AI output remains candidate, draft, explanation, or advice until deterministic convergence, validation, verification, or governance promotes it.
- Aboveground organizations consume Plan by default. When evidence, Global Soil fit, external facts, constraint detail, context, capability hints, or key-assumption validation are missing, they send a Nutrient Request to Underground Cognitive Runtime instead of creating their own direction-exploration cluster.
- Fruits are deliverables, AgentApps, capability packages, run memories, or experience candidates; they are not Soil until Governance validates, attributes, versions, permissions, and retirement policy.
- Governance Pipeline is the only route from Fruits / Run Memory / Experience Candidate back into Global Soil.

## Collaboration Rule

The user primarily provides direction adjustments, value judgment, and boundary confirmation. AI contributors must turn those inputs into implementable architecture, documentation, task plans, and code paths.

User input is an important direction signal, not the only standard. AI contributors must actively check architecture consistency, long-term maintainability, directory boundaries, runtime contracts, validation evidence, and technical-debt risk. When a better direction, local-optimum risk, boundary confusion, documentation bloat, or implementation risk appears, AI contributors must raise it with reasons and a concrete alternative instead of silently freezing the user's temporary idea as final architecture.

Discussion becomes project fact only after it lands in an ADR, development guide, task contract, or implementation.

## Underground Radial Growth Rule

Underground Cognitive Runtime is not a linear pipeline. It uses a fixed parent layer with temporary radial exploration clusters: stable center, dynamic rootlets, divergent exploration, convergent direction decision.

- The stable center owns intent, growth budget, constraints, evidence ledger, convergence, and handoff assembly.
- Temporary rootlet clusters can explore options, risks, asset fit, evidence, constraints, and counterfactuals.
- Rootlet clusters must have bounded input, budget, output, and exit criteria.
- In the current Desktop Shell priority, the result must converge into an approved Plan Package, a user escalation, or a recorded stop reason before Aboveground execution.
- Nutrient Patch output belongs to later Nutrient Request / Plan Revision collaboration after the single Desktop Shell loop is stable.
- `.agentarbor` may eventually store Plan Package files, but it must not become an execution plan, final asset store, or Soil copy.

## Documentation Rule

`docs/` must stay clean before implementation. The active docs tree only keeps formal development guidance, architecture design, and research material that can inform future development:

- keep `docs/开发指南/` as the stable current development entry;
- keep `docs/任务看板/` only as a historical board asset; it is not a current task source and is no longer derived from `.trellis/tasks/`;
- keep `docs/研究资料/` for research reports, early product material, engineering research, and external reference research;
- keep `docs/架构设计/` for long-term product architecture, protocol boundaries, workspace structure, and the current native concept-tree architecture;
- use Simplified Chinese folder names, document names, and prose, except conventional `README.md` index files;
- do not mix historical discussions into the current development guide;
- delete historical experiences, progress records, planning residue, session handoffs, preparation packs, and unvalidated draft packs when they do not provide direct architecture or research value;
- keep indexes accurate and minimal.

## Required Workflow

1. Read `docs/README.md`, `docs/开发指南/README.md`, and `docs/开发指南/00-总览.md` before structural work.
2. Do not use `.trellis/tasks/` as the default workflow surface. It is historical material only.
3. Do not recreate noisy active planning/progress/experience trees in `docs/`. Stable rules belong in the development guide, ADRs, task contract documents, or code/test boundaries.
4. Keep `docs/任务看板/` frozen as a historical view unless its boundary explanation or links are wrong.

## Layer Boundaries

- Trellis no longer owns current task lifecycle or workflow state in this repository. Historical `.trellis/spec/` material may inform implementation only when it does not conflict with `AGENTS.md`, `docs/开发指南/`, ADR-0024, or the latest user instruction.
- `docs/` owns stable human-readable product and development guidance.
- `.agentarbor/` owns future Plan Package material only after its contracts are stable and a real task birth reason exists.
- `.codex/` and `.opencode/` are platform adapters, not AgentArbor-native product source data.
- `docs/任务看板/` is a historical view and must not be rebuilt from `.trellis/tasks/` as current state.

## Record Placement

- Hard execution rules belong in `AGENTS.md`.
- Human-readable project guidance belongs in `docs/`.
- Current workflow state no longer belongs in `.trellis/tasks/`.
- Codex adapter agents belong in `.codex/agents/`.
- OpenCode adapter agents belong in `.opencode/agents/`.
- Agent Skills belong in `.agents/skills/`.
- Future AgentArbor-native Plan Package material belongs in `.agentarbor/` only when it has task authorization, contract coverage, and real evidence references.

Do not store current documentation history, progress records, or workflow handoffs in `.agentarbor/`.

## Structural Checks

- `docs/` top level contains only `README.md` and approved Chinese directories.
- `docs/任务看板/` contains only historical board pages and boundary notes.
- `docs/开发指南/` contains the active chaptered product positioning, core loop, architecture, contracts, agent lifecycle, engineering rules, and implementation entry boundary.
- `.agents/` contains only `skills/` and optional `plugins/`.
- `.agents/skills/` skill folder names match `SKILL.md` frontmatter names.
- `.codex/agents/*.toml` is Codex development tooling, not AgentArbor product source.
- `.opencode/agents/*.md` is OpenCode development tooling, not AgentArbor product source.
- `.agentarbor/` contains only native Plan Package material with real birth reasons; it must not contain final assets, Soil asset copies, placeholder agents, placeholder workflows, or undocumented schemas.

## Child-Agent Fruit Boundary

Mature child agents are fruit-layer capability assets. Apply this rule whenever work discusses generated agents, detachable agents, agent export packages, or Plan material that references future generated agents.

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
