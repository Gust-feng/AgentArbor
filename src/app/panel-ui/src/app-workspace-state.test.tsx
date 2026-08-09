import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useWorkspaceProjection } from "./app-workspace-state";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("keeps the newest workspace refresh authoritative when responses arrive out of order", async () => {
  const requests: PendingRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((_path: string | URL | Request, init?: RequestInit) => (
    new Promise<Response>((resolve, reject) => {
      requests.push({ signal: init?.signal ?? undefined, resolve, reject });
    })
  )));

  const { result } = renderHook(() => useWorkspaceProjection(true));
  await waitFor(() => expect(requests).toHaveLength(1));

  let newestRefresh!: Promise<void>;
  act(() => {
    newestRefresh = result.current.refresh();
  });
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]?.signal?.aborted).toBe(true);

  requests[1]!.resolve(workspacesResponse("new-workspace", "最新工作区"));
  await act(async () => newestRefresh);
  expect(result.current.workspaces.map((workspace) => workspace.workspaceId)).toEqual(["new-workspace"]);
  expect(result.current.loading).toBe(false);

  requests[0]!.resolve(workspacesResponse("stale-workspace", "旧工作区"));
  await act(async () => Promise.resolve());
  expect(result.current.workspaces.map((workspace) => workspace.workspaceId)).toEqual(["new-workspace"]);
});

type PendingRequest = {
  readonly signal?: AbortSignal;
  readonly resolve: (response: Response) => void;
  readonly reject: (error: unknown) => void;
};

function workspacesResponse(id: string, title: string): Response {
  return new Response(JSON.stringify({
    ok: true,
    workspaces: [{ id, title, status: "available", linkCount: 0 }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
