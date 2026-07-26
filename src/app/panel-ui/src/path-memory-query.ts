import { queryOptions } from "@tanstack/react-query";
import { deleteJson, getJson } from "./api";
import type {
  PathMemoryDiagnostics,
  PathMemoryDiagnosticsResponse,
  PathMemoryListResponse,
  PathMemoryRecord,
  PathMemoryTerminalStatus,
} from "./contracts/path-memory";
import { panelQueryClient } from "./panel-query-client";

export type PathMemoryListFilter = {
  readonly terminalStatus?: PathMemoryTerminalStatus;
  readonly workspaceRoot?: string;
};

export function pathMemoryListQuery(filter: PathMemoryListFilter = {}) {
  return queryOptions({
    queryKey: ["path-memory", "records", filter.terminalStatus ?? "", filter.workspaceRoot ?? ""] as const,
    queryFn: async ({ signal }): Promise<readonly PathMemoryRecord[]> => {
      const params = new URLSearchParams();
      if (filter.terminalStatus !== undefined) params.set("terminalStatus", filter.terminalStatus);
      if (filter.workspaceRoot !== undefined && filter.workspaceRoot.length > 0) {
        params.set("workspaceRoot", filter.workspaceRoot);
      }
      const query = params.toString();
      const response = await getJson<PathMemoryListResponse>(
        `/api/path-memory/records${query.length > 0 ? `?${query}` : ""}`,
        { signal },
      );
      return response.memories;
    },
    retry: false,
    staleTime: 30_000,
  });
}

export const pathMemoryDiagnosticsQuery = queryOptions({
  queryKey: ["path-memory", "diagnostics"] as const,
  queryFn: async ({ signal }): Promise<PathMemoryDiagnostics> => {
    const response = await getJson<PathMemoryDiagnosticsResponse>("/api/path-memory/diagnostics", { signal });
    return response.diagnostics;
  },
  retry: false,
  staleTime: 30_000,
});

export async function deletePathMemory(memoryId: string): Promise<void> {
  await deleteJson<{ readonly ok: true }>(`/api/path-memory/records/${encodeURIComponent(memoryId)}`);
}

export function invalidatePathMemories(): void {
  void panelQueryClient.invalidateQueries({ queryKey: ["path-memory"] });
}
