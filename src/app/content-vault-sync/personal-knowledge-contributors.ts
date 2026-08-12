import { createHash } from "node:crypto";

import {
  canonicalContentVaultJson,
  parseContentVaultPayload,
  type ContentVaultResource,
} from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "./contracts.js";

export type KnowledgePageSyncRecord = {
  readonly refId: string;
  readonly kind: "note" | "material" | "space_reference";
  readonly collectedAt: number;
  readonly asset?: {
    readonly status: "managed";
    readonly title: string;
    readonly sourceLabel: string;
    readonly contentKind: "file" | "directory";
    readonly sourceReferenceId: string;
    readonly sourceRelativePath: string;
  };
};

export type KnowledgeLinkSyncRecord = { readonly from: string; readonly to: string };

export type KnowledgeThemeSyncRecord = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly origin: "agent" | "user";
};

export type KnowledgeAssignmentSyncRecord = {
  readonly refId: string;
  readonly themeId: string;
  readonly by: "agent" | "user";
  readonly locked: boolean;
};

export type PersonalKnowledgeSyncSnapshot = {
  readonly pages: readonly KnowledgePageSyncRecord[];
  readonly links: readonly KnowledgeLinkSyncRecord[];
  readonly themes: readonly KnowledgeThemeSyncRecord[];
  readonly assignments: readonly KnowledgeAssignmentSyncRecord[];
};

/** Host-facing port implemented only from Personal Knowledge's public facade. */
export type PersonalKnowledgeSyncPort = {
  snapshot(): Promise<PersonalKnowledgeSyncSnapshot>;
  upsertPage(page: KnowledgePageSyncRecord): Promise<void>;
  deletePage(refId: string): Promise<void>;
  upsertLink(link: KnowledgeLinkSyncRecord): Promise<void>;
  deleteLink(link: KnowledgeLinkSyncRecord): Promise<void>;
  upsertTheme(theme: KnowledgeThemeSyncRecord): Promise<void>;
  deleteTheme(themeId: string): Promise<void>;
  upsertAssignment(assignment: KnowledgeAssignmentSyncRecord): Promise<void>;
  deleteAssignment(assignment: Pick<KnowledgeAssignmentSyncRecord, "refId" | "themeId">): Promise<void>;
  subscribe(listener: () => void): () => void;
};

export function createPersonalKnowledgeContentVaultContributors(
  port: PersonalKnowledgeSyncPort,
): readonly ContentVaultSyncContributor[] {
  return [
    createContributor("knowledge_page", port, {
      list: (snapshot) => snapshot.pages.map(projectPage),
      read: (snapshot, resourceId) => snapshot.pages.find((page) => page.refId === resourceId),
      project: projectPage,
      async apply(resource, current) {
        if (resource.deleted) {
          if (current !== undefined) await port.deletePage(resource.resourceId);
          return;
        }
        const page = pagePayload(resource);
        if (!sameJson(current, page)) await port.upsertPage(page);
      },
    }),
    createContributor("knowledge_link", port, {
      list: (snapshot) => snapshot.links.map(projectLink),
      read: (snapshot, resourceId) => snapshot.links.find((link) => knowledgeLinkResourceId(link) === resourceId),
      project: projectLink,
      async apply(resource, current) {
        if (resource.deleted) {
          if (current !== undefined) await port.deleteLink(current);
          return;
        }
        const link = linkPayload(resource);
        if (!sameJson(current, link)) await port.upsertLink(link);
      },
    }),
    createContributor("knowledge_theme", port, {
      list: (snapshot) => snapshot.themes.map(projectTheme),
      read: (snapshot, resourceId) => snapshot.themes.find((theme) => theme.id === resourceId),
      project: projectTheme,
      async apply(resource, current) {
        if (resource.deleted) {
          if (current !== undefined) await port.deleteTheme(resource.resourceId);
          return;
        }
        const theme = themePayload(resource);
        if (!sameJson(current, theme)) await port.upsertTheme(theme);
      },
    }),
    createContributor("knowledge_assignment", port, {
      list: (snapshot) => snapshot.assignments.map(projectAssignment),
      read: (snapshot, resourceId) => snapshot.assignments.find(
        (assignment) => knowledgeAssignmentResourceId(assignment) === resourceId,
      ),
      project: projectAssignment,
      async apply(resource, current) {
        if (resource.deleted) {
          if (current !== undefined) await port.deleteAssignment(current);
          return;
        }
        const assignment = assignmentPayload(resource);
        if (!sameJson(current, assignment)) await port.upsertAssignment(assignment);
      },
    }),
  ];
}

export function selectSynchronizablePersonalKnowledge(
  snapshot: PersonalKnowledgeSyncSnapshot,
  synchronizedAssetIds: ReadonlySet<string>,
): PersonalKnowledgeSyncSnapshot {
  const pages = snapshot.pages.filter((page) => page.kind === "note"
    || page.kind === "material" && synchronizedAssetIds.has(page.refId));
  const pageIds = new Set(pages.map((page) => page.refId));
  return {
    pages,
    links: snapshot.links.filter((link) => pageIds.has(link.from) && pageIds.has(link.to)),
    themes: snapshot.themes,
    assignments: snapshot.assignments.filter((assignment) => pageIds.has(assignment.refId)),
  };
}

export function knowledgeLinkResourceId(link: KnowledgeLinkSyncRecord): string {
  return relationResourceId("link", [link.from, link.to]);
}

export function knowledgeAssignmentResourceId(
  assignment: Pick<KnowledgeAssignmentSyncRecord, "refId" | "themeId">,
): string {
  return relationResourceId("assignment", [assignment.refId, assignment.themeId]);
}

function createContributor<TRecord>(
  kind: "knowledge_page" | "knowledge_link" | "knowledge_theme" | "knowledge_assignment",
  port: PersonalKnowledgeSyncPort,
  behavior: {
    readonly list: (snapshot: PersonalKnowledgeSyncSnapshot) => readonly ContentVaultLocalResource[];
    readonly read: (snapshot: PersonalKnowledgeSyncSnapshot, resourceId: string) => TRecord | undefined;
    readonly project: (record: TRecord) => ContentVaultLocalResource;
    readonly apply: (resource: ContentVaultResource, current: TRecord | undefined) => Promise<void>;
  },
): ContentVaultSyncContributor {
  return {
    kind,
    async list() {
      return behavior.list(await port.snapshot());
    },
    async read(resourceId) {
      const record = behavior.read(await port.snapshot(), resourceId);
      return record === undefined ? undefined : behavior.project(record);
    },
    async apply(resource) {
      const current = behavior.read(await port.snapshot(), resource.resourceId);
      await behavior.apply(resource, current);
    },
    subscribe: port.subscribe,
  };
}

function projectPage(page: KnowledgePageSyncRecord): ContentVaultLocalResource {
  return {
    kind: "knowledge_page",
    resourceId: page.refId,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("knowledge_page", {
      refId: page.refId,
      kind: page.kind,
      collectedAt: page.collectedAt,
      ...(page.asset === undefined ? {} : { asset: page.asset }),
    }),
  };
}

function projectLink(link: KnowledgeLinkSyncRecord): ContentVaultLocalResource {
  return {
    kind: "knowledge_link",
    resourceId: knowledgeLinkResourceId(link),
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("knowledge_link", link),
  };
}

function projectTheme(theme: KnowledgeThemeSyncRecord): ContentVaultLocalResource {
  return {
    kind: "knowledge_theme",
    resourceId: theme.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("knowledge_theme", {
      name: theme.name,
      color: theme.color,
      origin: theme.origin,
    }),
  };
}

function projectAssignment(assignment: KnowledgeAssignmentSyncRecord): ContentVaultLocalResource {
  return {
    kind: "knowledge_assignment",
    resourceId: knowledgeAssignmentResourceId(assignment),
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("knowledge_assignment", assignment),
  };
}

function pagePayload(resource: ContentVaultResource): KnowledgePageSyncRecord {
  const payload = parseContentVaultPayload("knowledge_page", requiredPayload(resource));
  return {
    refId: String(payload.refId),
    kind: payload.kind as KnowledgePageSyncRecord["kind"],
    collectedAt: Number(payload.collectedAt),
    ...(payload.asset === undefined ? {} : { asset: payload.asset as NonNullable<KnowledgePageSyncRecord["asset"]> }),
  };
}

function linkPayload(resource: ContentVaultResource): KnowledgeLinkSyncRecord {
  const payload = parseContentVaultPayload("knowledge_link", requiredPayload(resource));
  return { from: String(payload.from), to: String(payload.to) };
}

function themePayload(resource: ContentVaultResource): KnowledgeThemeSyncRecord {
  const payload = parseContentVaultPayload("knowledge_theme", requiredPayload(resource));
  return {
    id: resource.resourceId,
    name: String(payload.name),
    color: String(payload.color),
    origin: payload.origin as KnowledgeThemeSyncRecord["origin"],
  };
}

function assignmentPayload(resource: ContentVaultResource): KnowledgeAssignmentSyncRecord {
  const payload = parseContentVaultPayload("knowledge_assignment", requiredPayload(resource));
  return {
    refId: String(payload.refId),
    themeId: String(payload.themeId),
    by: payload.by as KnowledgeAssignmentSyncRecord["by"],
    locked: Boolean(payload.locked),
  };
}

function requiredPayload(resource: ContentVaultResource): Readonly<Record<string, unknown>> {
  if (resource.deleted || resource.payload === undefined) {
    throw new Error(`Content Vault ${resource.kind}/${resource.resourceId} has no active payload`);
  }
  return resource.payload;
}

function relationResourceId(prefix: string, values: readonly string[]): string {
  const digest = createHash("sha256").update(canonicalContentVaultJson(values), "utf8").digest("hex");
  return `${prefix}-${digest}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return left !== undefined && canonicalContentVaultJson(left) === canonicalContentVaultJson(right);
}
