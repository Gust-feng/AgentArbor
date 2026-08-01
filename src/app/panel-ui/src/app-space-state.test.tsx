import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useSpaceProjection } from "./app-space-state";
import { resetWorkbenchProjectionChangesForTesting } from "./app-workbench-projection-changes";
import {
  getPersonalKnowledgeLoadState,
  getPersonalKnowledgeSnapshot,
  getCommittedLocalNoteRevision,
  getPersonalNoteSaveState,
  initializePersonalKnowledge,
  createPersonalNote,
  refreshPersonalKnowledge,
  resetPersonalKnowledgeForTesting,
  setPersonalKnowledgePersistenceEnabled,
  updatePersonalNote,
} from "./personal-workbench/redesign/app/components/personalKnowledgeClient";

afterEach(() => {
  vi.unstubAllGlobals();
  resetWorkbenchProjectionChangesForTesting();
  resetPersonalKnowledgeForTesting();
});

test("refreshes the Space projection when an Agent-side change arrives", async () => {
  const streams: ProjectionEventSource[] = [];
  vi.stubGlobal("EventSource", class extends ProjectionEventSource {
    constructor(url: string) {
      super(url);
      streams.push(this);
    }
  });
  const fetchMock = vi.fn(async () => jsonResponse({ spaces: [] }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  act(() => streams[0]!.emit(JSON.stringify({
    revision: 1,
    reset: false,
    owners: ["spaces"],
    referenceIds: ["deleted-reference"],
  })));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

test("refreshes Personal Knowledge when an Agent-side note change arrives", async () => {
  const streams: ProjectionEventSource[] = [];
  vi.stubGlobal("EventSource", class extends ProjectionEventSource {
    constructor(url: string) {
      super(url);
      streams.push(this);
    }
  });
  const updated = { ...emptyServerSnapshot(), notes: [serverNote({ bodyMarkdown: "Agent 新正文" })] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ snapshot: emptyServerSnapshot() }))
    .mockResolvedValueOnce(jsonResponse({ snapshot: updated }));
  vi.stubGlobal("fetch", fetchMock);
  setPersonalKnowledgePersistenceEnabled(true);
  await initializePersonalKnowledge("space-1");

  streams[0]!.emit(JSON.stringify({
    revision: 1,
    reset: false,
    owners: ["personal_knowledge"],
    noteIds: ["note-1"],
  }));

  await waitFor(() => expect(getPersonalKnowledgeSnapshot().notes[0]?.bodyMarkdown).toBe("Agent 新正文"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("re-reads Personal Knowledge when a newer Agent change arrives during refresh", async () => {
  const streams: ProjectionEventSource[] = [];
  vi.stubGlobal("EventSource", class extends ProjectionEventSource {
    constructor(url: string) {
      super(url);
      streams.push(this);
    }
  });
  let resolveStale!: (response: Response) => void;
  const stale = new Promise<Response>((resolve) => { resolveStale = resolve; });
  const updated = { ...emptyServerSnapshot(), notes: [serverNote({ bodyMarkdown: "最终正文" })] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ snapshot: emptyServerSnapshot() }))
    .mockReturnValueOnce(stale)
    .mockResolvedValueOnce(jsonResponse({ snapshot: updated }));
  vi.stubGlobal("fetch", fetchMock);
  setPersonalKnowledgePersistenceEnabled(true);
  await initializePersonalKnowledge("space-1");

  streams[0]!.emit(JSON.stringify({ revision: 1, reset: false, owners: ["personal_knowledge"] }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  streams[0]!.emit(JSON.stringify({ revision: 2, reset: false, owners: ["personal_knowledge"] }));
  resolveStale(jsonResponse({ snapshot: emptyServerSnapshot() }));

  await waitFor(() => expect(getPersonalKnowledgeSnapshot().notes[0]?.bodyMarkdown).toBe("最终正文"));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("aborts stale Space refreshes and keeps the newest projection authoritative", async () => {
  const requests: PendingRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ path: String(path), signal: init?.signal, resolve, reject });
  })));

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(requests).toHaveLength(1));

  let newestRefresh!: Promise<void>;
  act(() => {
    newestRefresh = result.current.refresh();
  });
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0]?.signal?.aborted).toBe(true);

  requests[1]!.resolve(jsonResponse({ spaces: [] }));
  await act(async () => newestRefresh);
  expect(result.current.spaces).toEqual([]);
  expect(result.current.loading).toBe(false);

  requests[0]!.resolve(jsonResponse({ spaces: [{ id: "stale-space", title: "旧空间" }] }));
  await act(async () => Promise.resolve());
  expect(requests).toHaveLength(2);
  expect(result.current.spaces).toEqual([]);
});

test("exposes an active Space failure and clears it after retry", async () => {
  const requests: PendingRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ path: String(path), signal: init?.signal, resolve, reject });
  })));

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(requests).toHaveLength(1));
  requests[0]!.reject(new Error("Space API unavailable"));
  await waitFor(() => expect(result.current.error).toBe("Space API unavailable"));

  let retry!: Promise<void>;
  act(() => {
    retry = result.current.refresh();
  });
  await waitFor(() => expect(requests).toHaveLength(2));
  requests[1]!.resolve(jsonResponse({ spaces: [] }));
  await act(async () => retry);

  expect(result.current.error).toBeUndefined();
  expect(result.current.loading).toBe(false);
});

test("deduplicates an in-flight Space mutation and reconciles from the backend", async () => {
  const requests: PendingRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.push({ path: String(path), method: init?.method ?? "GET", signal: init?.signal, resolve, reject });
  })));

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(requests).toHaveLength(1));
  requests[0]!.resolve(jsonResponse({ spaces: [] }));
  await waitFor(() => expect(result.current.loading).toBe(false));

  let first!: Promise<void>;
  let duplicate!: Promise<void>;
  act(() => {
    first = result.current.createSpace("项目资料");
    duplicate = result.current.createSpace("项目资料");
  });
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(result.current.mutationPending).toBe(true);

  requests[1]!.resolve(jsonResponse({ ok: true }));
  await waitFor(() => expect(requests).toHaveLength(3));
  requests[2]!.resolve(jsonResponse({ spaces: [] }));
  await act(async () => Promise.all([first, duplicate]));

  expect(result.current.mutationPending).toBe(false);
  expect(result.current.error).toBeUndefined();
});

test("refreshes only the owning Space after a reference mutation", async () => {
  const requests: Array<{ path: string; method: string }> = [];
  let folderCreated = false;
  vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    const request = { path: String(path), method: init?.method ?? "GET" };
    requests.push(request);
    if (request.path === "/api/spaces" && request.method === "GET") {
      return jsonResponse({ spaces: [{ id: "space-a", title: "空间 A" }] });
    }
    if (request.path === "/api/spaces/space-a" && request.method === "GET") {
      return jsonResponse({ tree: {
        space: { id: "space-a", title: "空间 A", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        entries: folderCreated ? [{
          kind: "reference",
          item: {
            id: "managed-one",
            spaceId: "space-a",
            title: "软件资料",
            reference: { kind: "managed_folder", path: "C:/agentarbor/space-folders/managed-one" },
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        }] : [],
      } });
    }
    if (request.path === "/api/spaces/space-a/managed-folders" && request.method === "POST") {
      folderCreated = true;
      return jsonResponse({ ok: true });
    }
    throw new Error(`unexpected request: ${request.method} ${request.path}`);
  }));

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => result.current.createManagedFolder("space-a", "软件资料"));

  expect(result.current.spaces[0]?.items[0]?.itemId).toBe("managed-one");
  expect(requests.filter((request) => request.path === "/api/spaces")).toHaveLength(1);
  expect(requests.filter((request) => request.path === "/api/spaces/space-a")).toHaveLength(2);
});

test("keeps a successful Space mutation successful when projection refresh fails", async () => {
  let treeReads = 0;
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    const requestPath = String(path);
    const method = init?.method ?? "GET";
    if (requestPath === "/api/spaces" && method === "GET") {
      return jsonResponse({ spaces: [{ id: "space-a", title: "空间 A" }] });
    }
    if (requestPath === "/api/spaces/space-a" && method === "GET") {
      treeReads += 1;
      if (treeReads > 1) throw new Error("refresh unavailable");
      return jsonResponse({ tree: {
        space: { id: "space-a", title: "空间 A", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
        entries: [],
      } });
    }
    if (requestPath === "/api/spaces/space-a/managed-folders" && method === "POST") {
      writes += 1;
      return jsonResponse({ ok: true });
    }
    throw new Error(`unexpected request: ${method} ${requestPath}`);
  }));

  const { result } = renderHook(() => useSpaceProjection());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => result.current.createManagedFolder("space-a", "软件资料"));

  expect(writes).toBe(1);
  expect(result.current.mutationPending).toBe(false);
  expect(result.current.error).toBe("操作已完成，但空间数据刷新失败。请手动刷新。");
});

test("exposes knowledge initialization failure and retries in place", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetPersonalKnowledgeForTesting();
  setPersonalKnowledgePersistenceEnabled(true);

  fetchMock.mockRejectedValueOnce(new Error("knowledge unavailable"));
  await expect(initializePersonalKnowledge("space-1")).rejects.toThrow("knowledge unavailable");
  expect(getPersonalKnowledgeLoadState()).toEqual({ status: "error", message: "knowledge unavailable" });

  fetchMock
    .mockResolvedValueOnce(jsonResponse({ snapshot: emptyServerSnapshot() }));
  const retry = initializePersonalKnowledge("space-1");
  expect(getPersonalKnowledgeLoadState()).toEqual({ status: "retrying" });
  await retry;

  expect(getPersonalKnowledgeLoadState()).toEqual({ status: "ready" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("rejects a malformed knowledge snapshot without replacing the last valid state", async () => {
  const valid = { ...emptyServerSnapshot(), notes: [serverNote({ bodyMarkdown: "保留正文" })] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ snapshot: valid }))
    .mockResolvedValueOnce(jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  setPersonalKnowledgePersistenceEnabled(true);
  await initializePersonalKnowledge("space-1");

  const before = getPersonalKnowledgeSnapshot();
  await expect(refreshPersonalKnowledge()).rejects.toThrow("个人知识响应缺少 snapshot");
  expect(getPersonalKnowledgeSnapshot()).toBe(before);
});

test("persists a newly created note followed by an immediate edit in order", async () => {
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: emptyServerSnapshot() });
    }
    return jsonResponse({ ok: true });
  }));
  setPersonalKnowledgePersistenceEnabled(true);
  await initializePersonalKnowledge("space-1");

  const note = createPersonalNote({ title: "第一篇", bodyMarkdown: "初稿" });
  updatePersonalNote(note.id, { bodyMarkdown: "编辑后的正文" });
  expect(getPersonalKnowledgeSnapshot().notes[0]?.bodyMarkdown).toBe("编辑后的正文");
  expect(getPersonalNoteSaveState(note.id)).toBe("saving");

  await waitFor(() => expect(getPersonalNoteSaveState(note.id)).toBe("saved"));
  expect(getCommittedLocalNoteRevision(note.id)).toBe(2);
  const mutationRequests = requests.filter((request) => request.path.includes("/api/personal-knowledge/notes"));
  expect(mutationRequests.map((request) => request.method)).toEqual(["POST", "PATCH"]);
  expect(JSON.parse(mutationRequests[1]?.body ?? "{}")).toMatchObject({
    expectedRevision: 1,
    bodyMarkdown: "编辑后的正文",
  });
});

test("rebases a queued note edit after the previous write fails", async () => {
  const note = serverNote({ bodyMarkdown: "服务端正文", revision: 1 });
  const requests: Array<{ method: string; body?: string }> = [];
  let patchCount = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ method, body: init?.body as string | undefined });
    if (String(path) === "/api/personal-knowledge") {
      return jsonResponse({ snapshot: { ...emptyServerSnapshot(), notes: [note] } });
    }
    if (method === "PATCH") {
      patchCount += 1;
      if (patchCount === 1) throw new Error("temporary write failure");
      const body = JSON.parse(init?.body as string) as { expectedRevision: number };
      if (body.expectedRevision !== 1) throw new Error(`stale revision ${body.expectedRevision}`);
    }
    return jsonResponse({ ok: true });
  }));
  setPersonalKnowledgePersistenceEnabled(true);
  await initializePersonalKnowledge("space-1");

  updatePersonalNote(note.id, { bodyMarkdown: "第一次编辑" });
  updatePersonalNote(note.id, { bodyMarkdown: "第二次编辑" });

  await waitFor(() => expect(getPersonalNoteSaveState(note.id)).toBe("saved"));
  expect(getPersonalKnowledgeSnapshot().notes[0]).toMatchObject({
    bodyMarkdown: "第二次编辑",
    revision: 2,
  });
  const patchBodies = requests
    .filter((request) => request.method === "PATCH")
    .map((request) => JSON.parse(request.body ?? "{}"));
  expect(patchBodies).toMatchObject([
    { expectedRevision: 1, bodyMarkdown: "第一次编辑" },
    { expectedRevision: 1, bodyMarkdown: "第二次编辑" },
  ]);
});

interface PendingRequest {
  readonly path: string;
  readonly method?: string;
  readonly signal?: AbortSignal | null;
  readonly resolve: (response: Response) => void;
  readonly reject: (reason: unknown) => void;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

function emptyServerSnapshot() {
  return {
    notes: [],
    pages: [],
    links: [],
    themes: [],
    assignments: [],
    recentlyOpened: {},
  };
}

function serverNote(overrides: Partial<Record<"bodyMarkdown" | "revision", string | number>> = {}) {
  return {
    id: "note-1",
    spaceId: "space-1",
    title: "测试笔记",
    bodyMarkdown: "",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class ProjectionEventSource {
  readonly listeners = new Map<string, EventListener[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {}
  emit(data: string): void {
    for (const listener of this.listeners.get("workbench.projection.changed") ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }
}
