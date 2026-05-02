# Add OpenCode Compatibility

## Goal

Add OpenCode as a Trellis-compatible platform adapter for this project and explain how Trellis makes multiple AI platforms recognize the same project workflow accurately.

## What I Already Know

- Trellis is already initialized for Codex in this repository.
- The user wants OpenCode compatibility as well.
- Trellis platform documentation maps OpenCode to `.opencode/`, with skills under `.opencode/skills/`, agents under `.opencode/agents/`, and plugins under `.opencode/plugins/`.
- The shared source of truth remains `.trellis/`; platform directories are adapters.

## Requirements

- Add OpenCode platform files without overwriting existing Trellis/Codex files.
- Keep `.trellis/` as the shared workflow, task, spec, and workspace layer.
- Preserve AgentArbor project boundaries:
  - `.opencode/` is a tool adapter, not AgentArbor product runtime data.
  - `.agentarbor/` remains future AgentArbor runtime startup assets.
  - `.codex/` remains Codex-only adapter files.
- Validate generated files and update records.
- Explain the compatibility mechanism in plain Chinese.

## Acceptance Criteria

- [x] `.opencode/` exists with Trellis-generated OpenCode adapter files.
- [x] Existing `.trellis/`, `.codex/`, and `.agents/skills/trellis-*` remain intact.
- [x] Generated JSON/frontmatter files validate where applicable.
- [x] Documentation/progress records mention OpenCode compatibility.
- [x] User receives a clear explanation of shared core plus platform adapter mechanics.

## Out of Scope

- Do not install or configure a global OpenCode binary.
- Do not create AgentArbor product agents under `.agentarbor/`.
- Do not change the Trellis shared workflow unless OpenCode initialization requires it.

## Technical Notes

- Platform map reference: `.agents/skills/trellis-meta/references/platform-files/platform-map.md`.
- Platform files overview: `.agents/skills/trellis-meta/references/platform-files/overview.md`.
- OpenCode init command: `npx --yes @mindfoldhq/trellis@beta init --opencode --skip-existing --yes`.
