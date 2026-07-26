import type {
  PathMemory,
  PathMemorySearchInput,
  PathMemorySearchMatch,
  PathMemorySearchMatchedField,
} from "./contracts.js";

export const PATH_MEMORY_SEARCH_DEFAULT_LIMIT = 20;
export const PATH_MEMORY_SEARCH_MAX_LIMIT = 100;

/** Fixed order keeps matchedFields deterministic and traceable. */
const MATCHED_FIELD_ORDER: readonly PathMemorySearchMatchedField[] = [
  "userRequest",
  "toolName",
  "workspaceRoot",
  "conversationId",
];

const FIELD_WEIGHTS: Readonly<Record<PathMemorySearchMatchedField, number>> = {
  userRequest: 3,
  toolName: 2,
  workspaceRoot: 1,
  conversationId: 1,
};

/**
 * Deterministic keyword search over an in-memory PathMemory slice (ADR-0032 §8).
 * Scope filtering first, then lowercase substring token scoring; no IO here.
 */
export function searchPathMemories(
  memories: readonly PathMemory[],
  input: PathMemorySearchInput,
): readonly PathMemorySearchMatch[] {
  const tokens = tokenize(input.text);
  if (tokens.length === 0) return [];
  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? PATH_MEMORY_SEARCH_DEFAULT_LIMIT)),
    PATH_MEMORY_SEARCH_MAX_LIMIT,
  );

  const matches: PathMemorySearchMatch[] = [];
  for (const memory of memories) {
    if (input.workspaceRoot !== undefined && memory.scope.workspaceRoot !== input.workspaceRoot) continue;
    if (input.conversationId !== undefined && memory.source.conversationId !== input.conversationId) continue;
    if (input.terminalStatus !== undefined && memory.outcome.terminalStatus !== input.terminalStatus) continue;
    const match = scoreMemory(memory, tokens);
    if (match !== undefined) matches.push(match);
  }

  matches.sort((left, right) =>
    right.score - left.score ||
    right.memory.source.terminalAt.localeCompare(left.memory.source.terminalAt) ||
    left.memory.id.localeCompare(right.memory.id));
  return matches.slice(0, limit);
}

/** CJK ideographs and kana are written without spaces, so they need segmentation. */
const CJK_CHARACTER = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const CONTAINS_ALPHANUMERIC = /[\p{L}\p{N}]/u;

/**
 * Whitespace splitting alone cannot segment Chinese, so a whole CJK phrase would
 * collapse into one substring probe. Latin runs stay whole words while CJK runs
 * become overlapping bigrams, which keeps partial phrase recall symmetric across
 * languages. Tokens are deduplicated so a repeated term scores its fields once.
 */
function tokenize(text: string): readonly string[] {
  const tokens = new Set<string>();
  for (const chunk of text.toLowerCase().split(/\s+/u)) {
    for (const token of segmentChunk(chunk)) tokens.add(token);
  }
  return [...tokens];
}

function segmentChunk(chunk: string): readonly string[] {
  const characters = [...chunk];
  const tokens: string[] = [];
  let index = 0;
  while (index < characters.length) {
    const cjkRun = CJK_CHARACTER.test(characters[index] ?? "");
    let end = index + 1;
    while (end < characters.length && CJK_CHARACTER.test(characters[end] ?? "") === cjkRun) end += 1;
    const run = characters.slice(index, end);
    if (!cjkRun) {
      // Drop pure punctuation runs; a bare "。" or "," must not match every record.
      const word = run.join("");
      if (CONTAINS_ALPHANUMERIC.test(word)) tokens.push(word);
    } else if (run.length === 1) {
      tokens.push(run[0] ?? "");
    } else {
      for (let offset = 0; offset + 1 < run.length; offset += 1) {
        tokens.push(`${run[offset] ?? ""}${run[offset + 1] ?? ""}`);
      }
    }
    index = end;
  }
  return tokens;
}

function scoreMemory(memory: PathMemory, tokens: readonly string[]): PathMemorySearchMatch | undefined {
  const userRequest = memory.goal.userRequest.toLowerCase();
  const toolNames = memory.path.toolSteps.map((step) => step.toolName.toLowerCase());
  const workspaceRoot = memory.scope.workspaceRoot.toLowerCase();
  const conversationId = memory.source.conversationId.toLowerCase();

  let score = 0;
  const matched = new Set<PathMemorySearchMatchedField>();
  for (const token of tokens) {
    if (userRequest.includes(token)) {
      score += FIELD_WEIGHTS.userRequest;
      matched.add("userRequest");
    }
    // A token hitting several steps counts once per token.
    if (toolNames.some((name) => name.includes(token))) {
      score += FIELD_WEIGHTS.toolName;
      matched.add("toolName");
    }
    if (workspaceRoot.includes(token)) {
      score += FIELD_WEIGHTS.workspaceRoot;
      matched.add("workspaceRoot");
    }
    if (conversationId.includes(token)) {
      score += FIELD_WEIGHTS.conversationId;
      matched.add("conversationId");
    }
  }
  if (score === 0) return undefined;
  return {
    memory,
    score,
    matchedFields: MATCHED_FIELD_ORDER.filter((field) => matched.has(field)),
  };
}
