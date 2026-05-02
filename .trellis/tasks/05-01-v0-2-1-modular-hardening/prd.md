# V0.2.1 Modular Hardening

## Goal

Refactor the current V0.2 staged/working implementation into maintainable modules without changing runtime behavior. This is a structural quality hardening pass, not V0.3.

## Requirements

- Preserve all current V0.1/V0.2 behavior while layering V0.2.1 modular structure on top.
- Split `src/domain/contracts.ts` into focused domain modules and keep it as a compatibility barrel as much as practical.
- Split `src/domain/agentarbor/direction-handoff-package.ts` into a compatibility barrel backed by cohesive modules for schema/files, contracts, builder, validation, serialization, in-memory store, file-system store, and errors.
- Keep validation, serialization, and store responsibilities separate.
- Split `src/app/agents.ts` into a barrel backed by focused fake-agent modules.
- Move deterministic fixture/factory construction out of fake agent classes into helper modules such as minimal direction, growth plan, and governance helpers.
- Split tests so Direction Handoff Package tests live near `src/domain/agentarbor`, kernel/app boundary tests live near their ownership boundary, and `minimal-loop` tests stay focused on event sequence, minimal loop result, and demo `.agentarbor` safety.
- Update docs or backend specs only if material module/file names or reusable rules changed.

## Acceptance Criteria

- [ ] V0.1 13-event EventLog order is exactly preserved.
- [ ] `pnpm demo` prints loaded direction package id/version/status.
- [ ] Store API remains `save(package)`, `load(directionId, version)`, `listVersions(directionId)`, `validate(package)`.
- [ ] Validation result shape remains `passed`, `errors`, `warnings`.
- [ ] No repo-root `.agentarbor/` runtime assets are created, staged, or tracked.
- [ ] No real LLM, database, UI, MCP/A2A/AG-UI adapter, HTTP route, ORM, Jest/Vitest/ESLint/Prettier, or new external dependency is added.
- [ ] `pnpm build`, `pnpm test`, `pnpm demo`, `git diff --check`, and `git diff --cached --check` pass.
- [ ] If docs change, local Markdown links are checked.
- [ ] No root `Plan/` or `Plans/` directory exists.

## Definition of Done

- Tests are moved or updated at the owning boundary and still prove old behavior.
- Build and test commands pass.
- Diff is reviewed for staged-change preservation and accidental scope creep.
- Documentation/spec updates are concise and only cover material contract changes.

## Technical Approach

Use compatibility barrels to preserve caller imports while moving implementation details behind domain-owned module boundaries. Keep existing deterministic runtime behavior unchanged and avoid creating any real repo-root `.agentarbor/` assets.

## Out of Scope

- V0.3 behavior or new runtime capabilities.
- Real LLM, database, UI, protocol adapter, HTTP route, ORM, or external dependency integration.
- New package manager, test framework, lint framework, or formatting framework.
- Prefilled `.agentarbor/` runtime assets.

## Technical Notes

- Build on the current staged/working state; do not unstage, revert, reset, or rewrite existing staged changes.
- Respect AGENTS.md native concept tree and `.agentarbor` boundary.
- Pay special attention to `.trellis/spec/backend/direction-handoff-package.md`, directory structure, error handling, and quality guidelines.
