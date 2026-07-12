import {
  compactAgentLoopContextIfNeeded,
} from "../context-maintenance/index.js";
import type {
  BasicAgentLoopContextCompactionResult,
  CompactBasicAgentLoopContextInput,
} from "./conversation-compaction-contracts.js";

/**
 * Ordinary-Agent compatibility name. The context compaction algorithm is a
 * neutral model/tool-loop capability and does not own completion semantics.
 */
export async function compactBasicAgentLoopContextIfNeeded(
  input: CompactBasicAgentLoopContextInput
): Promise<BasicAgentLoopContextCompactionResult> {
  return compactAgentLoopContextIfNeeded(input);
}
