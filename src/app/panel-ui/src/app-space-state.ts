import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJson, getJson, postJson } from "./api";
import { selectLocalContextAttachment } from "./app-attachments";
import { selectTaskWorkspaceDirectory } from "./app-workspace-selection";
import type { PersonalSpaceItemProjection, PersonalSpaceProjection } from "./personal-workbench/space";

type SpaceSummaryResponse = {
  readonly spaces: readonly { readonly id: string; readonly title: string }[];
};

type SpaceTreeResponse = {
  readonly tree: SpaceTreeResponseTree;
};

type SpaceTreeResponseTree = {
  readonly space: { readonly id: string; readonly title: string; readonly demoDataset?: "learning-workspace" };
  readonly entries: readonly SpaceTreeEntry[];
};

type SpaceTreeEntry =
  | {
      readonly kind: "folder";
      readonly folder: { readonly id: string; readonly title: string; readonly updatedAt: string };
      readonly children: readonly SpaceTreeEntry[];
    }
  | {
      readonly kind: "reference";
      readonly item: {
        readonly id: string;
        readonly title: string;
        readonly updatedAt: string;
        readonly reference: {
          readonly kind: "local_file" | "workspace_folder" | "web_page" | "generated_artifact" | "conversation";
          readonly path?: string;
          readonly url?: string;
          readonly artifactRef?: string;
          readonly conversationId?: string;
          readonly conversationTitle?: string;
        };
      };
    };

type SpaceReferenceKind = "local_file" | "workspace_folder" | "web_page" | "generated_artifact" | "conversation";

/** Panel query state for SpaceFeature's one-way tree projection. */
export function useSpaceProjection(enabled = true): {
  readonly spaces: readonly PersonalSpaceProjection[];
  readonly createSpace: (title: string) => Promise<void>;
  readonly createFolder: (spaceId: string, title: string, parentFolderId?: string) => Promise<void>;
  readonly addLocalFile: (spaceId: string, parentFolderId?: string) => Promise<void>;
  readonly addWorkspaceFolder: (spaceId: string, parentFolderId?: string) => Promise<void>;
  readonly addWebReference: (spaceId: string, title: string, url: string, parentFolderId?: string) => Promise<void>;
  readonly addConversation: (spaceId: string, conversationId: string, conversationTitle: string, parentFolderId?: string) => Promise<void>;
  readonly move: (
    sourceSpaceId: string,
    target: { readonly kind: "folder" | "reference"; readonly id: string },
    destinationSpaceId: string,
    destinationFolderId?: string,
  ) => Promise<void>;
  readonly rename: (target: { readonly kind: "space" | "folder" | "reference"; readonly id: string }, title: string) => Promise<void>;
  readonly removeReference: (itemId: string) => Promise<void>;
  readonly removeFolder: (folderId: string) => Promise<void>;
  readonly openReference: (spaceId: string, itemId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly loading: boolean;
  readonly mutationPending: boolean;
  readonly error?: string;
} {
  const [spaces, setSpaces] = useState<readonly PersonalSpaceProjection[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | undefined>();
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
  const refreshEpochRef = useRef(0);
  const mutationPromisesRef = useRef(new Map<string, Promise<void>>());
  const [mutationPendingCount, setMutationPendingCount] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    const epoch = ++refreshEpochRef.current;
    refreshAbortRef.current?.abort();
    const abortController = new AbortController();
    refreshAbortRef.current = abortController;
    setLoading(true);
    setError(undefined);
    try {
      const listed = await getJson<SpaceSummaryResponse>("/api/spaces", { signal: abortController.signal });
      if (epoch !== refreshEpochRef.current) return;
      const trees = await Promise.all(listed.spaces.map(async (summary) => {
        const { tree } = await getJson<SpaceTreeResponse>(
          `/api/spaces/${encodeURIComponent(summary.id)}`,
          { signal: abortController.signal },
        );
        return projectTree(tree);
      }));
      if (epoch !== refreshEpochRef.current) return;
      setSpaces(trees);
    } catch (reason: unknown) {
      if (epoch !== refreshEpochRef.current || isAbortError(reason)) return;
      setError(reason instanceof Error ? reason.message : "空间数据加载失败。");
      throw reason;
    } finally {
      if (epoch === refreshEpochRef.current) {
        setLoading(false);
        if (refreshAbortRef.current === abortController) refreshAbortRef.current = undefined;
      }
    }
  }, []);

  const runMutation = useCallback((key: string, request: () => Promise<unknown>): Promise<void> => {
    const existing = mutationPromisesRef.current.get(key);
    if (existing !== undefined) return existing;
    setMutationPendingCount((count) => count + 1);
    setError(undefined);
    const pending = (async () => {
      try {
        await request();
        await refresh();
      } catch (reason: unknown) {
        try {
          await refresh();
        } catch {
          // Preserve the write failure below; a manual refresh remains available.
        }
        setError(reason instanceof Error ? reason.message : "空间数据保存失败。");
        throw reason;
      } finally {
        mutationPromisesRef.current.delete(key);
        setMutationPendingCount((count) => Math.max(0, count - 1));
      }
    })();
    mutationPromisesRef.current.set(key, pending);
    return pending;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      refreshAbortRef.current?.abort();
      setLoading(false);
      return undefined;
    }
    void refresh().catch(() => undefined);
    return () => refreshAbortRef.current?.abort();
  }, [enabled, refresh]);

  const createSpace = useCallback(async (title: string): Promise<void> => {
    await runMutation(`create-space:${title.trim()}`, () => postJson("/api/spaces", { title }));
  }, [runMutation]);

  const createFolder = useCallback(async (spaceId: string, title: string, parentFolderId?: string): Promise<void> => {
    await runMutation(`create-folder:${spaceId}:${parentFolderId ?? "root"}:${title.trim()}`, () => postJson(`/api/spaces/${encodeURIComponent(spaceId)}/folders`, {
      title,
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }));
  }, [runMutation]);

  const addLocalFile = useCallback(async (spaceId: string, parentFolderId?: string): Promise<void> => {
    const attachment = await selectLocalContextAttachment();
    if (attachment === undefined) return;
    const reference = localReferenceFromAttachment(attachment);
    if (reference === undefined) throw new Error("所选内容不能作为空间引用。");
    await runMutation(`add-local-file:${spaceId}:${parentFolderId ?? "root"}:${attachment.ref}`, () => postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: attachment.title,
      reference,
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }));
  }, [runMutation]);

  const addWorkspaceFolder = useCallback(async (spaceId: string, parentFolderId?: string): Promise<void> => {
    const directory = await selectTaskWorkspaceDirectory();
    if (directory === undefined) return;
    await runMutation(`add-workspace:${spaceId}:${parentFolderId ?? "root"}:${directory}`, () => postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: basename(directory),
      reference: { kind: "workspace_folder", path: directory },
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }));
  }, [runMutation]);

  const addWebReference = useCallback(async (
    spaceId: string,
    title: string,
    url: string,
    parentFolderId?: string,
  ): Promise<void> => {
    await runMutation(`add-web:${spaceId}:${parentFolderId ?? "root"}:${url}`, () => postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title,
      reference: { kind: "web_page", url },
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }));
  }, [runMutation]);

  const addConversation = useCallback(async (
    spaceId: string,
    conversationId: string,
    conversationTitle: string,
    parentFolderId?: string,
  ): Promise<void> => {
    await runMutation(`add-conversation:${spaceId}:${parentFolderId ?? "root"}:${conversationId}`, () => postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: conversationTitle,
      reference: { kind: "conversation", conversationId, conversationTitle },
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }));
  }, [runMutation]);

  const move = useCallback(async (
    sourceSpaceId: string,
    target: { readonly kind: "folder" | "reference"; readonly id: string },
    destinationSpaceId: string,
    destinationFolderId?: string,
  ): Promise<void> => {
    await runMutation(`move:${target.kind}:${target.id}`, () => postJson(`/api/spaces/${encodeURIComponent(sourceSpaceId)}/move`, {
      target,
      destinationSpaceId,
      ...(destinationFolderId === undefined ? {} : { destinationFolderId }),
    }));
  }, [runMutation]);

  const rename = useCallback(async (
    target: { readonly kind: "space" | "folder" | "reference"; readonly id: string },
    title: string,
  ): Promise<void> => {
    const path = target.kind === "space"
      ? `/api/spaces/${encodeURIComponent(target.id)}/rename`
      : `/api/spaces/${target.kind === "folder" ? "folders" : "references"}/${encodeURIComponent(target.id)}/rename`;
    await runMutation(`rename:${target.kind}:${target.id}`, () => postJson(path, { title }));
  }, [runMutation]);

  const removeReference = useCallback(async (itemId: string): Promise<void> => {
    await runMutation(`remove-reference:${itemId}`, () => deleteJson(`/api/spaces/references/${encodeURIComponent(itemId)}`));
  }, [runMutation]);

  const removeFolder = useCallback(async (folderId: string): Promise<void> => {
    await runMutation(`remove-folder:${folderId}`, () => deleteJson(`/api/spaces/folders/${encodeURIComponent(folderId)}`));
  }, [runMutation]);

  const openReference = useCallback(async (_spaceId: string, itemId: string): Promise<void> => {
    await postJson(`/api/spaces/references/${encodeURIComponent(itemId)}/open`, {});
  }, []);

  return {
    spaces,
    createSpace,
    createFolder,
    addLocalFile,
    addWorkspaceFolder,
    addWebReference,
    addConversation,
    move,
    rename,
    removeReference,
    removeFolder,
    openReference,
    refresh,
    loading,
    mutationPending: mutationPendingCount > 0,
    error,
  };
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException
    ? reason.name === "AbortError"
    : reason instanceof Error && reason.name === "AbortError";
}

function localReferenceFromAttachment(attachment: { readonly kind: string; readonly ref: string }):
  | { readonly kind: "local_file"; readonly path: string }
  | { readonly kind: "workspace_folder"; readonly path: string }
  | undefined {
  if (attachment.ref.startsWith("local-file:")) {
    return { kind: "local_file", path: attachment.ref.slice("local-file:".length) };
  }
  if (attachment.ref.startsWith("local-project:")) {
    return { kind: "workspace_folder", path: attachment.ref.slice("local-project:".length) };
  }
  return undefined;
}

function basename(value: string): string {
  const normalized = value.replace(/[\\/]+$/u, "");
  const segment = normalized.split(/[\\/]/u).at(-1)?.trim();
  return segment === undefined || segment.length === 0 ? "工作区文件夹" : segment;
}

function projectTree(tree: SpaceTreeResponseTree): PersonalSpaceProjection {
  return {
    spaceId: tree.space.id,
    title: tree.space.title,
    itemCount: countEntries(tree.entries),
    color: colorFor(tree.space.id),
    ...(tree.space.demoDataset === undefined ? {} : { demoDataset: tree.space.demoDataset }),
    items: tree.entries.map(projectEntry),
  };
}

function countEntries(entries: readonly SpaceTreeEntry[]): number {
  return entries.reduce((count, entry) => count + 1 + (entry.kind === "folder" ? countEntries(entry.children) : 0), 0);
}

function projectEntry(entry: SpaceTreeEntry): PersonalSpaceItemProjection {
  if (entry.kind === "folder") {
    return {
      itemId: entry.folder.id,
      title: entry.folder.title,
      kind: "folder",
      updatedAtLabel: relativeTimeLabel(entry.folder.updatedAt),
      children: entry.children.map(projectEntry),
    };
  }
  const { item } = entry;
  const openable = item.reference.kind !== "generated_artifact";
  return {
    itemId: item.id,
    title: item.title,
    kind: itemKind(item.reference.kind),
    openable,
    ...(item.reference.kind === "conversation" ? { conversationId: item.reference.conversationId } : {}),
    ...(item.reference.kind === "web_page" ? { openUrl: item.reference.url } : {}),
    detail: itemDetail(item.reference),
    updatedAtLabel: relativeTimeLabel(item.updatedAt),
  };
}

function itemKind(kind: SpaceReferenceKind): PersonalSpaceItemProjection["kind"] {
  switch (kind) {
    case "local_file": return "local_file";
    case "workspace_folder": return "workspace_folder";
    case "web_page": return "web_reference";
    case "generated_artifact": return "generated_artifact";
    case "conversation": return "conversation_reference";
    default: return "local_file";
  }
}

function itemDetail(reference: Extract<SpaceTreeEntry, { readonly kind: "reference" }>["item"]["reference"]): string | undefined {
  switch (reference.kind) {
    case "local_file":
    case "workspace_folder": return reference.path;
    case "web_page": return reference.url;
    case "generated_artifact": return reference.artifactRef;
    case "conversation": return reference.conversationTitle ?? reference.conversationId;
  }
}

function relativeTimeLabel(value: string): string | undefined {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function colorFor(id: string): string {
  const palette = ["#7a78bd", "#5f9a6b", "#c28b44", "#7186ab"];
  let value = 0;
  for (const character of id) value = ((value << 5) - value + character.charCodeAt(0)) | 0;
  return palette[Math.abs(value) % palette.length] ?? palette[0]!;
}
