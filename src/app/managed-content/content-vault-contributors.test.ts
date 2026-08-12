import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { contentVaultHash, type ContentVaultResource } from "../content-vault/index.js";
import { createManagedContentVaultContributors, managedFileResourceId } from "./content-vault-contributors.js";
import { createManagedContentFeature } from "./managed-content-feature.js";
import type { ManagedContentRootRecord } from "./contracts.js";

test("Managed Content contributors apply remote roots, files and tombstones without exposing local paths", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-managed-vault-"));
  const roots = new Map<string, ManagedContentRootRecord>();
  const feature = createManagedContentFeature({
    rootDirectory: directory,
    spaces: {
      listManagedRoots: async () => [...roots.values()],
      readManagedRoot: async (id) => roots.get(id),
      async createManagedRoot(root) { roots.set(root.id, root); },
      async renameManagedRoot(id, title) { roots.set(id, { ...roots.get(id)!, title }); },
      async moveManagedRoot(id, spaceId) { roots.set(id, { ...roots.get(id)!, spaceId }); },
      async removeManagedRoot(id) {
        const root = roots.get(id);
        if (root !== undefined) await rm(root.path, { recursive: true, force: true });
        roots.delete(id);
      },
      subscribe: () => () => undefined,
    },
  });
  t.after(async () => {
    await feature.release();
    await rm(directory, { recursive: true, force: true });
  });
  const contributors = new Map(createManagedContentVaultContributors(feature).map((item) => [item.kind, item]));

  await contributors.get("managed_root")!.apply(resource("managed_root", "root-one", {
    spaceId: "space-one",
    title: "手机资料",
  }));
  const identity = { managedRootId: "root-one", relativePath: "drafts/plan.md" };
  const fileId = managedFileResourceId(identity);
  assert.equal(fileId, "managed-file-42bac7985adbd7830cb28314e3bd627c2e9b438a6c6f06105861bc4aca965552");
  await contributors.get("managed_file")!.apply(resource("managed_file", fileId, {
    ...identity,
    text: "来自手机",
  }));

  assert.equal((await feature.queries.readTextFile("root-one", "drafts/plan.md"))?.text, "来自手机");
  const projectedRoot = await contributors.get("managed_root")!.read("root-one");
  assert.deepEqual(projectedRoot?.payload, { spaceId: "space-one", title: "手机资料" });
  assert.equal(JSON.stringify(projectedRoot).includes(directory), false);

  await contributors.get("managed_file")!.apply(tombstone("managed_file", fileId));
  assert.equal(await feature.queries.readTextFile("root-one", "drafts/plan.md"), undefined);
  await contributors.get("managed_root")!.apply(tombstone("managed_root", "root-one"));
  assert.equal(await feature.queries.readRoot("root-one"), undefined);
});

function resource(
  kind: ContentVaultResource["kind"],
  resourceId: string,
  payload: Readonly<Record<string, unknown>>,
): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 1,
    deleted: false,
    payloadSchemaVersion: 1,
    payload,
    contentHash: contentVaultHash(payload),
    contentBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-one",
  };
}

function tombstone(kind: ContentVaultResource["kind"], resourceId: string): ContentVaultResource {
  return {
    kind,
    resourceId,
    revision: 2,
    deleted: true,
    payloadSchemaVersion: 1,
    contentHash: `sha256:${"0".repeat(64)}`,
    contentBytes: 0,
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedByDeviceId: "mobile-one",
  };
}
