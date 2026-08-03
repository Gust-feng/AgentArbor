import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { OrdinaryExecutionPort } from "../../ordinary-agent/index.js";
import { startLocalPanelServer } from "../../panel-server.js";
import { createAgentSessionExecutionTestDriver } from "../../testing/agent-session-execution-driver.js";
import {
  removeTemporaryTree,
  requestJson,
} from "./panel-server-test-utils.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);

test("managed attachment multipart upload exposes only opaque refs and permissions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-upload-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const uploaded = await uploadAttachment(server.url, {
      filename: "opaque.png",
      contentType: "image/png",
      body: ONE_PIXEL_PNG,
    });
    const attachment = requireManagedUpload(uploaded.body);
    const managedAttachmentId = managedIdFromRef(attachment.ref);
    const managedRoot = path.join(directory, "runtime", "ordinary-agent", "managed-attachments");
    const managedDirectories = await fs.readdir(managedRoot);

    assert.equal(uploaded.status, 200);
    assert.equal(managedDirectories.length, 1);
    assert.match(managedAttachmentId, /^[A-Za-z0-9_-]+$/u);
    assert.deepEqual(attachment.permissionRefs, [`read:uploaded-attachment:${managedAttachmentId}`]);
    assert.equal(uploaded.text.includes("absolutePath"), false);
    assertManagedPathIsAbsent(uploaded.text, managedRoot);
    assertManagedPathIsAbsent(
      uploaded.text,
      path.join(managedRoot, managedDirectories[0]!, "content"),
    );
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("replaying one upload idempotency key returns the same managed draft", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-upload-replay-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const uploadRequestId = randomUUID();
    const file = {
      filename: "replay.txt",
      contentType: "text/plain",
      body: Buffer.from("same upload", "utf8"),
    };
    const first = requireManagedUpload((await uploadAttachment(server.url, file, uploadRequestId)).body);
    const replay = requireManagedUpload((await uploadAttachment(server.url, file, uploadRequestId)).body);
    const managedRoot = path.join(directory, "runtime", "ordinary-agent", "managed-attachments");

    assert.equal(first.attachmentId, replay.attachmentId);
    assert.equal(first.ref, replay.ref);
    assert.equal((await fs.readdir(managedRoot)).length, 1);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("replaying one upload idempotency key after a backend restart keeps the same managed draft identity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-upload-restart-"));
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const uploadRequestId = randomUUID();
    const file = {
      filename: "restart-replay.txt",
      contentType: "text/plain",
      body: Buffer.from("same upload after restart", "utf8"),
    };
    const first = requireManagedUpload((await uploadAttachment(server.url, file, uploadRequestId)).body);
    await server.close();
    server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      testOnlySkipInitialWorkbenchData: true,
    });
    const replay = requireManagedUpload((await uploadAttachment(server.url, file, uploadRequestId)).body);

    assert.equal(replay.attachmentId, first.attachmentId);
    assert.equal(replay.ref, first.ref);
  } finally {
    await server.close().catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

test("deleting a managed attachment draft makes its media unreadable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-delete-"));
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const uploaded = await uploadAttachment(server.url, {
      filename: "discard.png",
      contentType: "image/png",
      body: ONE_PIXEL_PNG,
    });
    const attachment = requireManagedUpload(uploaded.body);
    const managedAttachmentId = managedIdFromRef(attachment.ref);
    assert.ok(attachment.mediaPreviewUrl !== undefined);

    const beforeDelete = await requestBuffer(server.url, attachment.mediaPreviewUrl);
    const discarded = await requestJson(
      server.url,
      `/api/context/attachments/${encodeURIComponent(managedAttachmentId)}`,
      { method: "DELETE" },
    );
    const afterDelete = await requestBuffer(server.url, attachment.mediaPreviewUrl);

    assert.equal(beforeDelete.status, 200);
    assert.deepEqual(beforeDelete.body, ONE_PIXEL_PNG);
    assert.equal(discarded.status, 200);
    assert.equal(discarded.body.discardedAttachmentId, managedAttachmentId);
    assert.equal(afterDelete.status, 404);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("managed attachment submission rejects IDs from another instance or conversation with 409", async () => {
  const sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-owner-source-"));
  const targetDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-owner-target-"));
  const sourceServer = await startLocalPanelServer({
    port: 0,
    configDirectory: sourceDirectory,
    ordinaryAgentExecution: completedExecution(sourceDirectory),
    testOnlySkipInitialWorkbenchData: true,
  });
  const targetServer = await startLocalPanelServer({
    port: 0,
    configDirectory: targetDirectory,
    ordinaryAgentExecution: completedExecution(targetDirectory),
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const foreignUpload = requireManagedUpload((await uploadAttachment(sourceServer.url, {
      filename: "foreign.txt",
      contentType: "text/plain",
      body: Buffer.from("foreign instance", "utf8"),
    })).body);
    const foreignSubmission = await requestJson(targetServer.url, "/api/conversations", {
      method: "POST",
      body: submissionRequest("foreign attachment", "foreign-attachment-submission", foreignUpload),
    });

    const ownedUpload = requireManagedUpload((await uploadAttachment(sourceServer.url, {
      filename: "owned.txt",
      contentType: "text/plain",
      body: Buffer.from("owned conversation", "utf8"),
    })).body);
    const firstOwner = await requestJson(sourceServer.url, "/api/conversations", {
      method: "POST",
      body: submissionRequest("claim attachment", "claim-attachment-submission", ownedUpload),
    });
    const conflictingOwner = await requestJson(sourceServer.url, "/api/conversations", {
      method: "POST",
      body: submissionRequest("reuse attachment", "reuse-attachment-submission", ownedUpload),
    });

    assertManagedAttachmentConflict(foreignSubmission);
    assert.equal(firstOwner.status, 202);
    assertManagedAttachmentConflict(conflictingOwner);
  } finally {
    try {
      await Promise.all([sourceServer.close(), targetServer.close()]);
    } finally {
      await Promise.all([
        removeTemporaryTree(sourceDirectory),
        removeTemporaryTree(targetDirectory),
      ]);
    }
  }
});

test("identical managed attachment retries with one submissionId return the same run", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-idempotency-"));
  let executionCount = 0;
  const server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecution(directory, () => {
      executionCount += 1;
    }),
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const attachment = requireManagedUpload((await uploadAttachment(server.url, {
      filename: "retry.txt",
      contentType: "text/plain",
      body: Buffer.from("retry once", "utf8"),
    })).body);
    const body = submissionRequest("submit exactly once", "managed-idempotent-submission", attachment);

    const first = await requestJson(server.url, "/api/conversations", { method: "POST", body });
    const retried = await requestJson(server.url, "/api/conversations", { method: "POST", body });

    assert.equal(first.status, 202);
    assert.equal(retried.status, 202);
    assert.equal(retried.body.run.runId, first.body.run.runId);
    assert.equal(retried.body.conversation.conversationId, first.body.conversation.conversationId);
    await waitForRunStatus(server.url, first.body.run.runId, "completed");
    assert.equal(executionCount, 1);
  } finally {
    await server.close();
    await removeTemporaryTree(directory);
  }
});

test("conversation-owned managed media remains readable after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-panel-managed-media-restart-"));
  let server = await startLocalPanelServer({
    port: 0,
    configDirectory: directory,
    ordinaryAgentExecution: completedExecution(directory),
    testOnlySkipInitialWorkbenchData: true,
  });
  try {
    const attachment = requireManagedUpload((await uploadAttachment(server.url, {
      filename: "restart.png",
      contentType: "image/png",
      body: ONE_PIXEL_PNG,
    })).body);
    assert.ok(attachment.mediaPreviewUrl !== undefined);
    const submitted = await requestJson(server.url, "/api/conversations", {
      method: "POST",
      body: submissionRequest("persist media", "managed-media-restart", attachment),
    });
    assert.equal(submitted.status, 202);
    await waitForRunStatus(server.url, submitted.body.run.runId, "completed");
    await server.close();

    server = await startLocalPanelServer({
      port: 0,
      configDirectory: directory,
      ordinaryAgentExecution: completedExecution(directory),
      testOnlySkipInitialWorkbenchData: true,
    });
    const media = await requestBuffer(server.url, attachment.mediaPreviewUrl);

    assert.equal(media.status, 200);
    assert.deepEqual(media.body, ONE_PIXEL_PNG);
  } finally {
    await server.close().catch(() => undefined);
    await removeTemporaryTree(directory);
  }
});

type ManagedUpload = {
  readonly attachmentId: string;
  readonly ref: string;
  readonly permissionRefs: readonly string[];
  readonly mediaPreviewUrl?: string;
};

type JsonResponse = {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
};

function submissionRequest(goal: string, submissionId: string, attachment: ManagedUpload) {
  return {
    goal,
    submissionId,
    taskSoilInput: {
      contextRefs: [{
        attachmentId: attachment.attachmentId,
        ref: attachment.ref,
        kind: "file",
      }],
      permissionBoundaryRefs: attachment.permissionRefs,
    },
  };
}

function requireManagedUpload(body: unknown): ManagedUpload {
  if (!isRecord(body) || !Array.isArray(body.attachments) || body.attachments.length !== 1) {
    throw new Error("Managed attachment upload response must contain exactly one attachment.");
  }
  const attachment = body.attachments[0];
  if (!isRecord(attachment) ||
    typeof attachment.attachmentId !== "string" ||
    typeof attachment.ref !== "string" ||
    !Array.isArray(attachment.permissionRefs) ||
    !attachment.permissionRefs.every((value) => typeof value === "string")) {
    throw new Error("Managed attachment upload response has an invalid attachment contract.");
  }
  const mediaPreviewUrl = isRecord(attachment.mediaPreview) && typeof attachment.mediaPreview.url === "string"
    ? attachment.mediaPreview.url
    : undefined;
  return {
    attachmentId: attachment.attachmentId,
    ref: attachment.ref,
    permissionRefs: attachment.permissionRefs,
    ...(mediaPreviewUrl === undefined ? {} : { mediaPreviewUrl }),
  };
}

function managedIdFromRef(ref: string): string {
  const match = /^uploaded-attachment:([A-Za-z0-9_-]+)$/u.exec(ref);
  assert.ok(match !== null, `Expected an opaque uploaded-attachment ref, received ${ref}`);
  return match[1]!;
}

function assertManagedAttachmentConflict(response: Awaited<ReturnType<typeof requestJson>>): void {
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "ordinary_managed_attachment_unavailable");
  assert.equal(typeof response.body.error.message, "string");
  assert.equal(response.body.error.message.length > 0, true);
}

function assertManagedPathIsAbsent(serializedResponse: string, absolutePath: string): void {
  const escapedPath = JSON.stringify(path.resolve(absolutePath)).slice(1, -1);
  assert.equal(serializedResponse.includes(path.resolve(absolutePath)), false);
  assert.equal(serializedResponse.includes(escapedPath), false);
}

function completedExecution(directory: string, onExecute: () => void = () => undefined): OrdinaryExecutionPort {
  return {
    async execute(input) {
      onExecute();
      const answer = "managed attachment test completed";
      input.onTextDelta?.(answer);
      const session = await createAgentSessionExecutionTestDriver(directory).complete(input, answer);
      return {
        status: "completed",
        answer,
        session,
        toolCalls: [],
        usage: {},
      };
    },
  };
}

async function waitForRunStatus(baseUrl: string, runId: string, status: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  let last: Awaited<ReturnType<typeof requestJson>> | undefined;
  while (Date.now() < deadline) {
    last = await requestJson(baseUrl, `/api/basic-agent/runs/${encodeURIComponent(runId)}/view`);
    if (last.status === 200 && last.body.view.run.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for Ordinary run ${runId} status ${status}; last=${last?.text}`);
}

function uploadAttachment(
  baseUrl: string,
  file: { readonly filename: string; readonly contentType: string; readonly body: Buffer },
  uploadRequestId = randomUUID(),
): Promise<JsonResponse> {
  const boundary = `agentarbor-managed-attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n`,
      "utf8",
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const url = new URL("/api/context/attachments/upload", baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
        "idempotency-key": uploadRequestId,
      },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          text,
          body: JSON.parse(text) as unknown,
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function requestBuffer(
  baseUrl: string,
  pathname: string,
): Promise<{ readonly status: number; readonly body: Buffer }> {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
