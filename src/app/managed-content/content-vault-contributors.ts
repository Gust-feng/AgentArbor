import { createHash } from "node:crypto";

import {
  canonicalManagedFileIdentity,
  managedFileResourceIdFromSha256,
  parseContentVaultPayload,
  type ContentVaultResource,
} from "../content-vault/index.js";
import type { ContentVaultLocalResource, ContentVaultSyncContributor } from "../content-vault-sync/contracts.js";
import type { ManagedContentFeature, ManagedContentRoot, ManagedContentTextFile } from "./contracts.js";

export function createManagedContentVaultContributors(
  feature: ManagedContentFeature,
): readonly ContentVaultSyncContributor[] {
  return [createRootContributor(feature), createFileContributor(feature)];
}

export function managedFileResourceId(input: { readonly managedRootId: string; readonly relativePath: string }): string {
  const digest = createHash("sha256")
    .update(canonicalManagedFileIdentity(input), "utf8")
    .digest("hex");
  return managedFileResourceIdFromSha256(digest);
}

function createRootContributor(feature: ManagedContentFeature): ContentVaultSyncContributor {
  return {
    kind: "managed_root",
    async list() { return (await feature.queries.listRoots()).map(projectRoot); },
    async read(resourceId) {
      const root = await feature.queries.readRoot(resourceId);
      return root === undefined ? undefined : projectRoot(root);
    },
    async apply(resource) {
      const current = await feature.queries.readRoot(resource.resourceId);
      if (resource.deleted) {
        if (current !== undefined) await feature.commands.deleteRoot(resource.resourceId);
        return;
      }
      const payload = parseContentVaultPayload("managed_root", requiredPayload(resource));
      await feature.commands.applyRoot({
        id: resource.resourceId,
        spaceId: String(payload.spaceId),
        title: String(payload.title),
      });
    },
    subscribe(listener) { return feature.events.subscribe(() => listener()); },
  };
}

function createFileContributor(feature: ManagedContentFeature): ContentVaultSyncContributor {
  return {
    kind: "managed_file",
    async list() { return (await allFiles(feature)).map(projectFile); },
    async read(resourceId) {
      const file = (await allFiles(feature)).find((item) => managedFileResourceId(item) === resourceId);
      return file === undefined ? undefined : projectFile(file);
    },
    async apply(resource) {
      const current = (await allFiles(feature)).find((item) => managedFileResourceId(item) === resource.resourceId);
      if (resource.deleted) {
        if (current !== undefined) await feature.commands.deleteText({
          rootId: current.managedRootId,
          relativePath: current.relativePath,
        });
        return;
      }
      const payload = parseContentVaultPayload("managed_file", requiredPayload(resource));
      const identity = {
        managedRootId: String(payload.managedRootId),
        relativePath: String(payload.relativePath),
      };
      if (managedFileResourceId(identity) !== resource.resourceId) {
        throw new Error(`Managed file ${resource.resourceId} does not match its root and relative path`);
      }
      await feature.commands.writeText({
        rootId: identity.managedRootId,
        relativePath: identity.relativePath,
        text: String(payload.text),
        ...(current === undefined ? {} : { expectedFingerprint: current.fingerprint }),
      });
    },
    subscribe(listener) { return feature.events.subscribe(() => listener()); },
  };
}

function projectRoot(root: ManagedContentRoot): ContentVaultLocalResource {
  return {
    kind: "managed_root",
    resourceId: root.id,
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("managed_root", { spaceId: root.spaceId, title: root.title }),
  };
}

function projectFile(file: ManagedContentTextFile): ContentVaultLocalResource {
  return {
    kind: "managed_file",
    resourceId: managedFileResourceId(file),
    payloadSchemaVersion: 1,
    payload: parseContentVaultPayload("managed_file", {
      managedRootId: file.managedRootId,
      relativePath: file.relativePath,
      text: file.text,
    }),
  };
}

async function allFiles(feature: ManagedContentFeature): Promise<readonly ManagedContentTextFile[]> {
  const roots = await feature.queries.listRoots();
  const pages = await Promise.all(roots.map(async (root) => await feature.queries.listTextFiles(root.id)));
  return pages.flat();
}

function requiredPayload(resource: ContentVaultResource): Readonly<Record<string, unknown>> {
  if (resource.deleted || resource.payload === undefined) {
    throw new Error(`Content Vault ${resource.kind}/${resource.resourceId} has no active payload`);
  }
  return resource.payload;
}
