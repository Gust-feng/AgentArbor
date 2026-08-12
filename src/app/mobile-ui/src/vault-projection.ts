import type { ContentVaultResource, ContentVaultResourceKind } from "../../content-vault/contracts";
import type { MobileRemoteState } from "./remote-client";
import type { MobileVaultConflict } from "./storage";

export type SpaceItem = {
  readonly id: string;
  readonly title: string;
};

export type SpaceManagedRoot = {
  readonly id: string;
  readonly title: string;
  readonly pending: boolean;
};

export type PendingVaultContent = {
  readonly kind: "personal_note" | "managed_file";
  readonly resourceId: string;
  readonly spaceId: string;
  readonly title: string;
  readonly draftText: string;
  readonly detail: string;
};

export type VaultContentItem = {
  readonly id: string;
  readonly title: string;
  readonly kind: "folder" | "note" | "file" | "asset" | "notebook" | "knowledge";
  readonly indent?: boolean;
  /** Stable parent row for the mobile Space tree. Undefined means a section root. */
  readonly parentId?: string;
  /** Zero-based depth within a managed root. */
  readonly depth?: number;
  readonly ownerLabel?: string;
  readonly detail?: string;
  readonly searchText?: string;
  readonly resource?: ContentVaultResource;
  readonly value?: string;
  /** The visible row is backed by a local mutation that is not applied yet. */
  readonly pending?: boolean;
};

/**
 * Projects durable, not-yet-applied Vault writes into the owning Space.
 * This is intentionally a read-only projection; the outbox remains the only
 * write fact and is removed by RemoteMobileClient after apply or conflict.
 */
export function projectPendingVaultContent(state: MobileRemoteState): readonly PendingVaultContent[] {
  const roots = new Map<string, string>();
  for (const resource of state.vaultResources) {
    if (resource.kind !== "managed_root" || resource.deleted) continue;
    const spaceId = stringField(resource.payload, "spaceId");
    if (spaceId !== undefined) roots.set(resource.resourceId, spaceId);
  }
  const entries = (state.vaultOutbox ?? []).slice().sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.mutationId.localeCompare(right.mutationId));
  for (const entry of entries) {
    if (entry.mutation.operation !== "upsert" || entry.mutation.kind !== "managed_root") continue;
    const spaceId = stringField(entry.mutation.payload, "spaceId");
    if (spaceId !== undefined) roots.set(entry.mutation.resourceId, spaceId);
  }
  const pending = new Map<string, PendingVaultContent>();
  for (const entry of entries) {
    const mutation = entry.mutation;
    if (mutation.operation !== "upsert") continue;
    if (mutation.kind === "personal_note") {
      const spaceId = stringField(mutation.payload, "spaceId");
      if (spaceId === undefined) continue;
      pending.set(`${mutation.kind}:${mutation.resourceId}`, {
        kind: mutation.kind,
        resourceId: mutation.resourceId,
        spaceId,
        title: stringField(mutation.payload, "title") ?? "未命名笔记",
        draftText: stringField(mutation.payload, "bodyMarkdown") ?? "",
        detail: "等待同步",
      });
      continue;
    }
    if (mutation.kind !== "managed_file") continue;
    const managedRootId = stringField(mutation.payload, "managedRootId");
    const spaceId = managedRootId === undefined ? undefined : roots.get(managedRootId);
    if (spaceId === undefined) continue;
    const presentation = managedFilePresentation(stringField(mutation.payload, "relativePath"));
    pending.set(`${mutation.kind}:${mutation.resourceId}`, {
      kind: mutation.kind,
      resourceId: mutation.resourceId,
      spaceId,
      title: presentation.title,
      draftText: stringField(mutation.payload, "text") ?? "",
      detail: "等待同步",
    });
  }
  return [...pending.values()];
}

export type VaultContentContext = {
  readonly typeLabel: string;
  readonly ownerLabel?: string;
  readonly locationLabel?: string;
};

export function projectSpaces(state: MobileRemoteState): readonly SpaceItem[] {
  return activeVaultResources(state, "space").flatMap((resource) => {
    const title = stringField(resource.payload, "title");
    const createdAt = stringField(resource.payload, "createdAt");
    return title === undefined ? [] : [{ id: resource.resourceId, title, createdAt }];
  }).sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.id.localeCompare(right.id))
    .map(({ id, title }) => ({ id, title }));
}

export function projectSpaceManagedRoots(state: MobileRemoteState, spaceId: string): readonly SpaceManagedRoot[] {
  const roots = new Map<string, SpaceManagedRoot>();
  for (const resource of state.vaultResources) {
    if (resource.kind !== "managed_root" || resource.deleted || stringField(resource.payload, "spaceId") !== spaceId) continue;
    roots.set(resource.resourceId, {
      id: resource.resourceId,
      title: stringField(resource.payload, "title") ?? "文件",
      pending: false,
    });
  }
  for (const entry of state.vaultOutbox ?? []) {
    if (entry.mutation.operation !== "upsert"
      || entry.mutation.kind !== "managed_root"
      || stringField(entry.mutation.payload, "spaceId") !== spaceId) continue;
    roots.set(entry.mutation.resourceId, {
      id: entry.mutation.resourceId,
      title: stringField(entry.mutation.payload, "title") ?? "文件",
      pending: true,
    });
  }
  return [...roots.values()];
}

export function projectSpaceContent(state: MobileRemoteState, spaceId: string): readonly VaultContentItem[] {
  const resources = state.vaultResources.filter((resource) => !resource.deleted);
  const notes = resources.filter((resource) => resource.kind === "personal_note" && stringField(resource.payload, "spaceId") === spaceId)
    .map((resource) => contentFromResource(resource));
  const roots = resources.filter((resource) => resource.kind === "managed_root" && stringField(resource.payload, "spaceId") === spaceId);
  const files = roots.flatMap((root) => {
    const rootItem: VaultContentItem = { id: root.resourceId, title: stringField(root.payload, "title") ?? "文件", kind: "folder", resource: root };
    const managedFiles = resources
      .filter((resource) => resource.kind === "managed_file" && stringField(resource.payload, "managedRootId") === root.resourceId)
      .sort((left, right) => (stringField(left.payload, "relativePath") ?? "").localeCompare(stringField(right.payload, "relativePath") ?? ""));
    const rows: VaultContentItem[] = [rootItem];
    const folderIds = new Map<string, string>();
    for (const resource of managedFiles) {
      const item = contentFromResource(resource);
      const relativePath = stringField(resource.payload, "relativePath")?.replace(/\\/gu, "/") ?? item.title;
      const parts = relativePath.split("/").filter(Boolean);
      const fileName = parts.pop() ?? item.title;
      let parentId = root.resourceId;
      let depth = 1;
      let folderPath = "";
      for (const folderName of parts) {
        folderPath = folderPath.length === 0 ? folderName : `${folderPath}/${folderName}`;
        const folderId = folderIds.get(folderPath) ?? `${root.resourceId}:folder:${folderPath}`;
        if (!folderIds.has(folderPath)) {
          folderIds.set(folderPath, folderId);
          rows.push({ id: folderId, title: folderName, kind: "folder", parentId, depth });
        }
        parentId = folderId;
        depth += 1;
      }
      rows.push({ ...item, title: fileName, indent: true, parentId, depth });
    }
    return rows;
  });
  const references = resources.filter((resource) => resource.kind === "space_reference" && stringField(resource.payload, "spaceId") === spaceId)
    .flatMap((reference) => {
      const linkedId = objectField(reference.payload, "reference")?.assetId;
      const asset = typeof linkedId === "string" ? resources.find((resource) => resource.kind === "workbench_asset" && resource.resourceId === linkedId) : undefined;
      return asset === undefined
        ? [{ id: reference.resourceId, title: stringField(reference.payload, "title") ?? "内容", kind: "folder" as const, resource: reference }]
        : [contentFromResource(asset)];
    });
  return [...notes, ...files, ...references];
}

/**
 * Keep sync attention in the Space that owns the affected resource. Conflict
 * state remains centralized in the mobile client while each Space exposes a
 * scoped resolution surface without inventing another store.
 */
export function projectSpaceConflicts(state: MobileRemoteState, spaceId: string): readonly MobileVaultConflict[] {
  const identities = new Set(projectSpaceContent(state, spaceId).flatMap((item) => {
    const resource = item.resource;
    return resource === undefined ? [] : [`${resource.kind}:${resource.resourceId}`];
  }));
  return state.vaultConflicts.filter((conflict) => {
    if (conflict.mutation.kind === "space" && conflict.mutation.resourceId === spaceId) return true;
    if (identities.has(`${conflict.mutation.kind}:${conflict.mutation.resourceId}`)) return true;
    const payload = conflict.mutation.operation === "upsert" ? conflict.mutation.payload : conflict.current?.payload;
    return stringField(payload, "spaceId") === spaceId;
  });
}

export function projectKnowledge(state: MobileRemoteState): readonly VaultContentItem[] {
  // Link/theme/assignment projections are ownership metadata, not user-facing library objects.
  const kinds: readonly ContentVaultResourceKind[] = ["personal_note", "workbench_asset", "agent_notebook"];
  const spaces = new Map(projectSpaces(state).map((space) => [space.id, space.title]));
  return state.vaultResources
    .filter((resource) => !resource.deleted && kinds.includes(resource.kind))
    .map((resource) => {
      const item = contentFromResource(resource);
      if (resource.kind === "personal_note") {
        const spaceId = stringField(resource.payload, "spaceId");
        const ownerLabel = spaceId === undefined ? undefined : spaces.get(spaceId);
        return ownerLabel === undefined ? item : { ...item, ownerLabel };
      }
      if (resource.kind === "workbench_asset") {
        const ownerLabel = workbenchAssetOwnerLabel(state, resource.resourceId, spaces);
        return ownerLabel === undefined ? item : { ...item, ownerLabel };
      }
      return resource.kind === "agent_notebook" ? { ...item, ownerLabel: "全局" } : item;
    });
}

/**
 * Resolve the small amount of ownership context a mobile editor needs.
 * The editor consumes Vault identity only; it does not infer filesystem
 * permissions or recreate the desktop execution scope.
 */
export function contentContext(state: MobileRemoteState, item: VaultContentItem): VaultContentContext {
  const resource = item.resource;
  const spaces = new Map(projectSpaces(state).map((space) => [space.id, space.title]));
  if (resource === undefined) return { typeLabel: contentTypeLabel(item.kind), locationLabel: item.detail };

  if (resource.kind === "personal_note") {
    const spaceId = stringField(resource.payload, "spaceId");
    return {
      typeLabel: "笔记",
      ...(spaceId === undefined || spaces.get(spaceId) === undefined ? {} : { ownerLabel: spaces.get(spaceId) }),
    };
  }
  if (resource.kind === "managed_file") {
    const managedRootId = stringField(resource.payload, "managedRootId");
    const root = state.vaultResources.find((candidate) => candidate.kind === "managed_root" && candidate.resourceId === managedRootId && !candidate.deleted);
    const spaceId = stringField(root?.payload, "spaceId");
    return {
      typeLabel: "文件",
      ...(spaceId === undefined || spaces.get(spaceId) === undefined ? {} : { ownerLabel: spaces.get(spaceId) }),
      ...(item.detail === undefined ? {} : { locationLabel: item.detail }),
    };
  }
  if (resource.kind === "workbench_asset") {
    const ownerLabel = workbenchAssetOwnerLabel(state, resource.resourceId, spaces);
    return {
      typeLabel: "资料",
      ...(ownerLabel === undefined ? {} : { ownerLabel }),
      ...(item.detail === undefined ? {} : { locationLabel: item.detail }),
    };
  }
  if (resource.kind === "agent_notebook") return { typeLabel: "Agent 笔记", ownerLabel: "全局" };
  return { typeLabel: contentTypeLabel(item.kind), locationLabel: item.detail };
}

export function knowledgeMatchesQuery(item: VaultContentItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return true;
  return [item.title, item.ownerLabel, item.detail, item.searchText, item.value]
    .some((value) => value?.toLocaleLowerCase().includes(normalized));
}

export type VaultConflictPresentation = {
  readonly title: string;
  readonly localContent?: string;
  readonly localPreview?: string;
  readonly remoteContent?: string;
  readonly remotePreview?: string;
  readonly canKeepLocal: boolean;
  readonly detectedAt: string;
};

export function conflictPresentation(conflict: MobileVaultConflict): VaultConflictPresentation {
  const localPayload = conflict.mutation.operation === "upsert" ? conflict.mutation.payload : undefined;
  const remotePayload = conflict.current?.payload;
  const localContent = contentText(conflict.mutation.kind, localPayload);
  const remoteContent = contentText(conflict.current?.kind, remotePayload);
  const title = resourceTitle(conflict.mutation.kind, localPayload)
    ?? resourceTitle(conflict.current?.kind, remotePayload)
    ?? "未命名内容";
  return {
    title,
    ...(localContent === undefined ? {} : { localContent }),
    ...(previewText(conflict.mutation.kind, localPayload) === undefined ? {} : { localPreview: previewText(conflict.mutation.kind, localPayload) }),
    ...(remoteContent === undefined ? {} : { remoteContent }),
    ...(previewText(conflict.current?.kind, remotePayload) === undefined ? {} : { remotePreview: previewText(conflict.current?.kind, remotePayload) }),
    canKeepLocal: conflict.current !== undefined && !conflict.current.deleted,
    detectedAt: conflict.detectedAt,
  };
}

export function firstManagedRootId(state: MobileRemoteState, spaceId: string): string | undefined {
  return projectSpaceManagedRoots(state, spaceId)[0]?.id;
}

export function contentFromResource(resource: ContentVaultResource): VaultContentItem {
  const payload = resource.payload;
  switch (resource.kind) {
    case "personal_note": return {
      id: resource.resourceId,
      title: stringField(payload, "title") || "未命名笔记",
      kind: "note",
      detail: "笔记",
      resource,
      value: stringField(payload, "bodyMarkdown") ?? "",
      searchText: stringField(payload, "bodyMarkdown") ?? "",
    };
    case "managed_file": return {
      id: resource.resourceId,
      ...managedFilePresentation(stringField(payload, "relativePath")),
      kind: "file",
      resource,
      value: stringField(payload, "text") ?? "",
      searchText: stringField(payload, "text") ?? "",
    };
    case "workbench_asset": return {
      id: resource.resourceId,
      title: stringField(payload, "title") ?? "未命名资产",
      kind: "asset",
      detail: stringField(payload, "language") || "文本",
      resource,
      value: stringField(payload, "text") ?? "",
      searchText: stringField(payload, "text") ?? "",
    };
    case "agent_notebook": return {
      id: resource.resourceId,
      title: stringField(payload, "label") ?? "Agent 笔记",
      kind: "notebook",
      detail: "全局笔记",
      resource,
      value: stringField(payload, "content") ?? "",
      searchText: stringField(payload, "content") ?? "",
    };
    case "knowledge_page": return {
      id: resource.resourceId,
      title: stringField(objectField(payload, "asset"), "title") ?? stringField(payload, "refId") ?? "知识条目",
      kind: "knowledge",
      detail: "知识条目",
      resource,
    };
    default: return { id: resource.resourceId, title: stringField(payload, "title") ?? "内容", kind: "file", resource };
  }
}

export function updatedTextPayload(
  resource: ContentVaultResource,
  value: string,
  baseRevision = resource.revision,
  title?: string,
): Readonly<Record<string, unknown>> {
  const payload = { ...(resource.payload ?? {}) };
  switch (resource.kind) {
    case "personal_note": return {
      ...payload,
      ...(title === undefined ? {} : { title }),
      bodyMarkdown: value,
      updatedAt: Date.now(),
      sourceRevision: Math.max(numberField(payload, "sourceRevision", 0), baseRevision) + 1,
    };
    case "workbench_asset":
    case "managed_file": return { ...payload, text: value };
    case "agent_notebook": return { ...payload, content: value, updatedAt: new Date().toISOString() };
    default: return payload;
  }
}

export function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0 || normalized.split("/").some((part) => part === "" || part === "." || part === "..") || /^[a-zA-Z]:/u.test(normalized)) {
    throw new Error("请输入软件文件夹内的相对路径");
  }
  return normalized;
}

export function normalizeManagedFileName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || /[\\/<>:"|?*\u0000-\u001f]/u.test(normalized)) {
    throw new Error("请输入有效的文件名");
  }
  return normalized;
}

function managedFilePresentation(relativePath?: string): { readonly title: string; readonly detail?: string } {
  if (relativePath === undefined) return { title: "未命名文件" };
  const parts = relativePath.replace(/\\/gu, "/").split("/");
  const title = parts.pop() || "未命名文件";
  const detail = parts.join("/");
  return detail.length === 0 ? { title } : { title, detail };
}

function contentTypeLabel(kind: VaultContentItem["kind"]): string {
  if (kind === "note") return "笔记";
  if (kind === "folder") return "文件夹";
  if (kind === "asset") return "资料";
  if (kind === "notebook") return "Agent 笔记";
  if (kind === "knowledge") return "知识条目";
  return "文件";
}

function activeVaultResources(state: MobileRemoteState, kind: ContentVaultResourceKind): readonly ContentVaultResource[] {
  return state.vaultResources.filter((resource) => resource.kind === kind && !resource.deleted && resource.payload !== undefined);
}

function workbenchAssetOwnerLabel(
  state: MobileRemoteState,
  assetId: string,
  spaces: ReadonlyMap<string, string>,
): string | undefined {
  const owners = new Set(state.vaultResources.flatMap((resource) => {
    if (resource.kind !== "space_reference"
      || resource.deleted
      || objectField(resource.payload, "reference")?.assetId !== assetId) return [];
    const spaceId = stringField(resource.payload, "spaceId");
    const title = spaceId === undefined ? undefined : spaces.get(spaceId);
    return title === undefined ? [] : [title];
  }));
  if (owners.size === 0) return undefined;
  if (owners.size === 1) return owners.values().next().value;
  return `${owners.size} 个空间`;
}

function stringField(value: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: Readonly<Record<string, unknown>> | undefined, key: string, fallback: number): number {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : fallback;
}

function objectField(value: Readonly<Record<string, unknown>> | undefined, key: string): Readonly<Record<string, unknown>> | undefined {
  const field = value?.[key];
  return field !== null && typeof field === "object" && !Array.isArray(field) ? field as Readonly<Record<string, unknown>> : undefined;
}

function resourceTitle(kind: ContentVaultResourceKind | undefined, payload: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (kind === "managed_file") return managedFilePresentation(stringField(payload, "relativePath")).title;
  if (kind === "agent_notebook") return stringField(payload, "label");
  return stringField(payload, "title");
}

function previewText(kind: ContentVaultResourceKind | undefined, payload: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const value = contentText(kind, payload);
  if (value === undefined) return undefined;
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) return "空内容";
  return compact.length <= 120 ? compact : `${compact.slice(0, 120)}…`;
}

function contentText(kind: ContentVaultResourceKind | undefined, payload: Readonly<Record<string, unknown>> | undefined): string | undefined {
  return kind === "personal_note"
    ? stringField(payload, "bodyMarkdown")
    : kind === "agent_notebook"
      ? stringField(payload, "content")
      : stringField(payload, "text");
}
