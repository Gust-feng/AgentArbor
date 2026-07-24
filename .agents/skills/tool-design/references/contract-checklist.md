# Tool Contract Checklist

Use this checklist as a review worksheet. It is deliberately about observable contracts, not a preferred implementation framework.

## Ownership and frozen boundaries

- [ ] The owning feature is named, and no parallel runner, store, event family, or read model was introduced.
- [ ] Frozen catalog, execution-allowed tools, confirmation policy, and model active set are represented separately.
- [ ] Executor availability and provider capability feed boundary resolution without being inferred from visibility.
- [ ] The run freezes definitions, source identities, hashes, and permission facts; later registry drift cannot silently change it.

## Input and definition

- [ ] The root input schema is an object for MCP/function tools and includes `type: "object"`.
- [ ] Required fields are actually required; optional fields are omitted from `required` instead of being forced through `null`.
- [ ] `additionalProperties`, `$ref`, `$defs`, `allOf`, `anyOf`, `oneOf`, bounds, enums, patterns, and output schemas survive every copy/cache boundary.
- [ ] Provider-supplied output schemas and annotations remain canonical catalog facts even when the active model protocol does not serialize them as input definitions.
- [ ] Definitions are detached before crossing a boundary; invalid JSON values fail explicitly rather than disappearing through a shallow clone.
- [ ] The description states objective capability and meaningful side effects, not routing instructions or duplicated runtime policy.
- [ ] Optional model guidance does not become a visibility gate or a hidden deterministic router.

## Exposure and execution

- [ ] In AgentArbor, only eligible frozen MCP definitions are deferred, and only after the real serialized definition cost passes the configured gate with net savings.
- [ ] A control-name conflict, uncertain capability/cost fact, or insufficient savings falls back to complete direct visibility rather than failing the run.
- [ ] A deferred tool has a compact catalog entry and an explicit model action that activates the complete frozen schema for the next request.
- [ ] Activation never grants tools outside the frozen run permission set.
- [ ] Search/load controls neither connect to nor execute the remote tool, and they do not count as execution of that tool.
- [ ] A new root or delegated run resets to its freshly resolved initial active set; recovery and reconciliation do not infer activation from public tool output or inherit historical `addedToolNames`.
- [ ] A hidden or unavailable tool cannot execute through a stale or contract-mismatched executor, and catalog-only definitions have no fake executor.
- [ ] Confirmation is evaluated from explicit operation/risk metadata at preflight time.

## Results and continuation

- [ ] The canonical result retains status, producer facts, error domain/facts, confirmation, and required attachment metadata. Attachment bytes remain in the protocol-approved out-of-band path rather than a duplicate feature snapshot.
- [ ] Text and structured result content are normalized into one canonical result without dropping either non-mirrored fact or duplicating equivalent payloads.
- [ ] Provider and UI projections are additive views; neither replaces the canonical result.
- [ ] Producer `truncated`/`hasMoreAfter` facts have a complete replayable `continuation.nextInput`, or the producer reports honestly that safe continuation is unavailable.
- [ ] Producer continuation preserves path/query/selectors, page size, filters, and next cursor/offset without hidden mutable state or side-effect replay.
- [ ] Oversized unpageable results use a real `read_tool_output` input backed by retained evidence; a ref alone is not presented as executable.
- [ ] Producer pagination and transport retention remain distinct in results and metrics.

## Verification and metrics

- [ ] Tests cover every changed boundary and its adjacent consumer; unchanged layers are not added merely to make the matrix look complete.
- [ ] Negative cases match the change: malformed schema, missing or mismatched executor, unauthorized activation, invalid recovery marker, denied call, unavailable evidence reader, or unsafe pagination.
- [ ] Tool selection, argument validation, delivery/continuation, and task success are evaluated separately when quality is in scope.
- [ ] Metrics contain bounded counts, hashes, sizes, timings, and statuses rather than raw file contents, stdout, or model transcripts; metric failure cannot change execution.
- [ ] `pnpm build:node`, selected focused tests, and `git diff --check` pass. Run broader tests only for a shared contract or cross-module behavior change.
