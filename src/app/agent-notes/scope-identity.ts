import path from "node:path";

/** Matches workspace identity semantics used by Host path leases. */
export function agentNoteWorkspaceIdentity(workspaceRoot: string): string {
  const normalized = path.normalize(path.resolve(workspaceRoot));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
