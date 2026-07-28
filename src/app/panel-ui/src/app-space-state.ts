import { useCallback, useEffect, useState } from "react";
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
  readonly space: { readonly id: string; readonly title: string };
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
  readonly addLocalFile: (spaceId: string) => Promise<void>;
  readonly addWorkspaceFolder: (spaceId: string) => Promise<void>;
  readonly addConversation: (spaceId: string, conversationId: string, conversationTitle: string) => Promise<void>;
  readonly rename: (target: { readonly kind: "space" | "folder" | "reference"; readonly id: string }, title: string) => Promise<void>;
  readonly removeReference: (itemId: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly error?: string;
} {
  const [spaces, setSpaces] = useState<readonly PersonalSpaceProjection[]>([]);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async (): Promise<void> => {
    const listed = await getJson<SpaceSummaryResponse>("/api/spaces");
    const trees = await Promise.all(listed.spaces.map(async (summary) => {
      const { tree } = await getJson<SpaceTreeResponse>(`/api/spaces/${encodeURIComponent(summary.id)}`);
      return projectTree(tree);
    }));
    setSpaces(trees);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh().then(
      () => setError(undefined),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : "空间数据加载失败。"),
    );
    return undefined;
  }, [enabled, refresh]);

  const createSpace = useCallback(async (title: string): Promise<void> => {
    await postJson("/api/spaces", { title });
    await refresh();
  }, [refresh]);

  const createFolder = useCallback(async (spaceId: string, title: string, parentFolderId?: string): Promise<void> => {
    await postJson(`/api/spaces/${encodeURIComponent(spaceId)}/folders`, {
      title,
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    });
    await refresh();
  }, [refresh]);

  const addLocalFile = useCallback(async (spaceId: string): Promise<void> => {
    const attachment = await selectLocalContextAttachment();
    if (attachment === undefined) return;
    const reference = localReferenceFromAttachment(attachment);
    if (reference === undefined) throw new Error("所选内容不能作为空间引用。");
    await postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: attachment.title,
      reference,
    });
    await refresh();
  }, [refresh]);

  const addWorkspaceFolder = useCallback(async (spaceId: string): Promise<void> => {
    const directory = await selectTaskWorkspaceDirectory();
    if (directory === undefined) return;
    await postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: basename(directory),
      reference: { kind: "workspace_folder", path: directory },
    });
    await refresh();
  }, [refresh]);

  const addConversation = useCallback(async (
    spaceId: string,
    conversationId: string,
    conversationTitle: string,
  ): Promise<void> => {
    await postJson(`/api/spaces/${encodeURIComponent(spaceId)}/references`, {
      title: conversationTitle,
      reference: { kind: "conversation", conversationId, conversationTitle },
    });
    await refresh();
  }, [refresh]);

  const rename = useCallback(async (
    target: { readonly kind: "space" | "folder" | "reference"; readonly id: string },
    title: string,
  ): Promise<void> => {
    const path = target.kind === "space"
      ? `/api/spaces/${encodeURIComponent(target.id)}/rename`
      : `/api/spaces/${target.kind === "folder" ? "folders" : "references"}/${encodeURIComponent(target.id)}/rename`;
    await postJson(path, { title });
    await refresh();
  }, [refresh]);

  const removeReference = useCallback(async (itemId: string): Promise<void> => {
    await deleteJson(`/api/spaces/references/${encodeURIComponent(itemId)}`);
    await refresh();
  }, [refresh]);

  return {
    spaces,
    createSpace,
    createFolder,
    addLocalFile,
    addWorkspaceFolder,
    addConversation,
    rename,
    removeReference,
    refresh,
    error,
  };
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
  const openable = item.reference.kind === "conversation" || item.reference.kind === "web_page";
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
