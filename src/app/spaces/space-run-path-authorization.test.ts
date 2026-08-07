import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolExecutionContext } from "../../domain/tools/index.js";
import { createTaskSoil } from "../../domain/soil/index.js";
import { removeTestDirectory } from "../testing/fs-test-directories.js";
import { createLocalReadFileTool } from "../tool-center/adapters/local-workspace-read-tools.js";
import { createLocalWriteFileTool } from "../tool-center/adapters/local-workspace-write-tools.js";
import {
  spaceReferenceAttachmentId,
  spaceReferenceWritePermission,
  spaceScopePermission,
} from "./space-file-access.js";
import { createSpaceRunPathAuthorization } from "./space-run-path-authorization.js";

test("Space path authority constrains standard file tools and full_access opens non-Space paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-path-authority-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const grantedRoot = path.join(root, "granted");
  const outsideRoot = path.join(root, "outside");
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(grantedRoot, { recursive: true }),
    fs.mkdir(outsideRoot, { recursive: true }),
  ]);
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: spaceTaskSoil(grantedRoot),
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");
  const write = createLocalWriteFileTool(workspaceRoot, { pathAuthorization: authorization });
  const read = createLocalReadFileTool(workspaceRoot, { pathAuthorization: authorization });
  const grantedFile = path.join(grantedRoot, "inside.txt");
  const outsideFile = path.join(outsideRoot, "outside.txt");

  const written = await write.execute({ path: grantedFile, content: "inside" }, executionContext("prompt"));
  assert.equal((written as { absolutePath?: string }).absolutePath, grantedFile);
  assert.equal((written as { referenceId?: string }).referenceId, "reference-1");
  await assert.rejects(
    write.execute({ path: outsideFile, content: "denied" }, executionContext("prompt")),
    /not inside any Space reference authorized for this run/,
  );

  const fullAccessWritten = await write.execute(
    { path: outsideFile, content: "full access" },
    executionContext("full_access"),
  );
  assert.equal((fullAccessWritten as { absolutePath?: string }).absolutePath, outsideFile);
  assert.equal((await fs.readFile(outsideFile, "utf8")), "full access");
  const fullAccessRead = await read.execute({ path: outsideFile }, executionContext("full_access"));
  assert.equal((fullAccessRead as { content?: string }).content, "full access");
});

test("multi-root Space read continuation keeps the absolute path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-path-continuation-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const firstRoot = path.join(root, "first");
  const secondRoot = path.join(root, "second");
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(firstRoot, { recursive: true }),
    fs.mkdir(secondRoot, { recursive: true }),
  ]);
  const file = path.join(firstRoot, "long.txt");
  await fs.writeFile(file, "abcdefghij", "utf8");
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: multiRootSpaceTaskSoil(firstRoot, secondRoot),
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");
  const read = createLocalReadFileTool(workspaceRoot, { pathAuthorization: authorization });
  const first = await read.execute({ path: file, maxLength: 4 }, executionContext("prompt")) as Record<string, unknown>;
  const continuation = first.continuation as Record<string, unknown> | undefined;
  const nextInput = continuation?.nextInput as Record<string, unknown> | undefined;
  assert.equal(nextInput?.path, file);
  const second = await read.execute(nextInput ?? {}, executionContext("prompt")) as Record<string, unknown>;
  assert.match(String(second.content ?? ""), /def/);
});

test("Space revocation remains a hard deny under full_access while Shell cwd may be outside references", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-revocation-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const grantedRoot = path.join(root, "granted");
  const outsideRoot = path.join(root, "outside");
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(grantedRoot, { recursive: true }),
    fs.mkdir(outsideRoot, { recursive: true }),
  ]);
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: spaceTaskSoil(grantedRoot),
    revocationOverlay: {
      has: (referenceId) => referenceId === "reference-1",
      assertReadAllowed() { return undefined; },
    },
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");

  await assert.rejects(
    authorization.resolve({
      requestedPath: path.join(grantedRoot, "revoked.txt"),
      operation: "write",
      workspaceRoot,
      context: executionContext("full_access"),
    }),
    /was revoked/,
  );
  const shellCwd = await authorization.resolve({
    requestedPath: outsideRoot,
    operation: "execute",
    workspaceRoot,
    context: executionContext("prompt"),
  });
  assert.equal(shellCwd.absolutePath, outsideRoot);
  assert.deepEqual(shellCwd.resourceScope, { ownerKind: "space", ownerId: "space-1" });
  assert.equal(shellCwd.resourceId, undefined);
});

test("missing external roots are removed lazily at the first real tool access", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-path-missing-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const missingRoot = path.join(root, "missing");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const removed: string[] = [];
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: spaceTaskSoil(missingRoot, "source-identity"),
    onInvalidReference: async (referenceId) => { removed.push(referenceId); },
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");

  await assert.rejects(
    authorization.resolve({
      requestedPath: path.join(missingRoot, "README.md"),
      operation: "read",
      workspaceRoot,
      context: executionContext("prompt"),
    }),
    /no longer points to its original source and was removed/,
  );
  assert.deepEqual(removed, ["reference-1"]);
});

test("a different filesystem object at the same path cannot inherit a frozen Space grant", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-path-replaced-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const grantedRoot = path.join(root, "granted");
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(grantedRoot, { recursive: true }),
  ]);
  const removed: string[] = [];
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: spaceTaskSoil(grantedRoot, "original-source"),
    externalSourceInspector: async () => ({ identity: "replacement-source", kind: "folder" }),
    onInvalidReference: async (referenceId) => { removed.push(referenceId); },
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");

  await assert.rejects(
    authorization.resolve({
      requestedPath: path.join(grantedRoot, "README.md"),
      operation: "read",
      workspaceRoot,
      context: executionContext("prompt"),
    }),
    /no longer points to its original source and was removed/,
  );
  assert.deepEqual(removed, ["reference-1"]);
});

test("missing managed folders fail in the file tool without entering external unlink", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-space-managed-path-missing-"));
  t.after(() => removeTestDirectory(root));
  const workspaceRoot = path.join(root, "legacy-workspace");
  const missingManagedRoot = path.join(root, "managed-folder");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const removed: string[] = [];
  const authorization = createSpaceRunPathAuthorization({
    workspaceRoot,
    taskSoil: spaceTaskSoil(missingManagedRoot),
    onInvalidReference: async (referenceId) => { removed.push(referenceId); },
  });
  if (authorization === undefined) throw new Error("Expected Space path authorization.");
  const read = createLocalReadFileTool(workspaceRoot, { pathAuthorization: authorization });

  await assert.rejects(
    read.execute({ path: path.join(missingManagedRoot, "README.md") }, executionContext("prompt")),
  );
  assert.deepEqual(removed, []);
});

function spaceTaskSoil(grantedRoot: string, sourceIdentity?: string) {
  return createTaskSoil({
    rawGoal: "work",
    contextRefs: [{
      attachmentId: spaceReferenceAttachmentId("reference-1"),
      ref: `local-project:${grantedRoot}`,
      kind: "project",
      ...(sourceIdentity === undefined ? {} : { sourceIdentity }),
    }],
    permissionBoundaryRefs: [
      spaceScopePermission("space-1"),
      `read:local-project:${grantedRoot}`,
      spaceReferenceWritePermission("reference-1"),
    ],
  });
}

function multiRootSpaceTaskSoil(firstRoot: string, secondRoot: string) {
  return createTaskSoil({
    rawGoal: "work",
    contextRefs: [
      {
        attachmentId: spaceReferenceAttachmentId("reference-1"),
        ref: `local-project:${firstRoot}`,
        kind: "project",
      },
      {
        attachmentId: spaceReferenceAttachmentId("reference-2"),
        ref: `local-project:${secondRoot}`,
        kind: "project",
      },
    ],
    permissionBoundaryRefs: [
      spaceScopePermission("space-1"),
      `read:local-project:${firstRoot}`,
      `read:local-project:${secondRoot}`,
      spaceReferenceWritePermission("reference-1"),
      spaceReferenceWritePermission("reference-2"),
    ],
  });
}

function executionContext(
  confirmationPolicy: "prompt" | "full_access",
): ToolExecutionContext {
  return {
    callerAgentId: "ordinary",
    traceId: "run-1",
    goalId: "run-1",
    conversationId: "conversation-1",
    confirmationPolicy,
  };
}
