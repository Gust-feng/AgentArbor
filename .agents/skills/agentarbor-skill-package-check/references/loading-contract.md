# AgentArbor Skills Loading Contract

## Progressive Loading

1. Metadata is always discoverable. AgentArbor may list safe fields such as `name`, `description`, enablement state, and UI summary in a capability snapshot.
2. `SKILL.md` body is loaded only after the current run selects the skill.
3. `references/` files are read only when the selected skill body says the extra detail is needed.
4. `scripts/` files are never executed by the loader. They are available for an agent or developer to run explicitly during a task.
5. `assets/` files are output resources or templates. Do not load them into context unless the task needs their contents.

## Current Runtime Boundaries

- Triggering is keyword based and capped by the ordinary agent runtime policy.
- The frozen run facts should include safe metadata and enabled/disabled state, not the full skill body.
- The body can enter the model context through Context Ledger / Context Pack after selection.
- The default read-model should show skill name, trigger reason, and safe summary; it should not expose the full body.

## Explicit Non-Goals

- No RAG ingest, chunking, embedding, vector store, or retrieval policy.
- No automatic upgrade from ordinary `agent` to `deep`.
- No automatic execution of bundled skill scripts.
- No storage of full skill body in RuntimeDatabase.
- No use of Skills as a Plan, Governance, or task orchestration layer.
