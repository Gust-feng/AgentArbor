# Technical Design

## Ownership

- Panel backend API owns job lifecycle and in-memory polling state.
- Underground runtime/event log remains the source of operational facts.
- Agent transcript is a JSON-safe derived read model built from event log snapshots and final observation/summary; it must not become a new fact source.
- Panel UI owns polling, loading/running/completed/error rendering, and Chinese operator-facing labels.

## Proposed Shape

1. Introduce an in-memory `PanelRunJobStore` for process-local underground runs.
2. Add async routes:
   - `POST /api/underground/runs`
   - `GET /api/underground/runs/:runId`
3. Keep existing sync route `POST /api/underground/run` as a compatibility wrapper around current behavior.
4. Add read-model types and derivation helpers for:
   - event cursor / trace summary
   - model call status cards
   - `AgentWorkNote[]`
   - `PanelRunTranscript`
5. Update vanilla panel UI JavaScript to start/poll jobs without adding dependencies.

## Safety Rules

- Never include raw secret fields in API responses, logs, transcript notes, test snapshots, or DOM rendering.
- Never include full prompt text or raw model output in transcript details.
- Any model note must use model name, rootlet kind, sanitized purpose/status, candidate refs, and model call refs only.
- Network-backed AI remains disabled unless existing explicit config validation passes.

## Verification Plan

- Add focused backend route/store/read-model tests for async start, partial polling, final polling, and transcript redaction.
- Preserve existing sync/config/panel tests.
- Run `pnpm build`, `pnpm test`, `pnpm panel:smoke`, `git diff --check`, and task validation.
