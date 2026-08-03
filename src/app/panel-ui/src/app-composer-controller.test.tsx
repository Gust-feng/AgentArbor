import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppComposerController } from "./app-composer-controller";
import { createInitialAppState, type AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

describe("managed attachment composer lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the upload idempotency key after a lost response", async () => {
    const requestIds: string[] = [];
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestIds.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      attempts += 1;
      if (attempts === 1) throw new Error("response lost");
      return Response.json({ attachments: [managedAttachment("managed-1")] });
    }));
    const state = fixture([]);
    const file = new File(["hello"], "notes.txt", { type: "text/plain", lastModified: 1 });

    await state.controller.uploadAttachments([file]);
    await state.controller.uploadAttachments([file]);

    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).not.toBe("");
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(state.uploadAttemptRef.current).toBeUndefined();
    expect(state.attachments.map((attachment) => attachment.attachmentId)).toEqual(["managed-1"]);
  });

  it("deletes only managed uploads when attachments are removed", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ ok: true });
    }));
    const local: ContextAttachment = {
      ...managedAttachment("local-ui-id"),
      ref: "local-file:C:\\notes.txt",
      permissionRefs: ["read:local-file:C:\\notes.txt"],
    };
    const managed = managedAttachment("managed-2");
    const state = fixture([local, managed]);

    await state.controller.removeAttachment(local.attachmentId);
    await state.controller.removeAttachment(managed.attachmentId);

    expect(requests).toEqual(["/api/context/attachments/managed-2"]);
    expect(state.attachments).toEqual([]);
  });
});

function fixture(initialAttachments: readonly ContextAttachment[]) {
  let app: AppState = createInitialAppState();
  let attachments = initialAttachments;
  const uploadAttemptRef = {
    current: undefined as { readonly key: string; readonly id: string } | undefined,
  };
  const controller = createAppComposerController({
    setApp: dispatch((next) => { app = next; }, () => app),
    mountedRef: { current: true },
    contextBusy: false,
    setContextBusy: () => undefined,
    attachmentUploadAttemptRef: uploadAttemptRef,
    setAttachments: dispatch((next) => { attachments = next; }, () => attachments),
    attachments,
    setSelectedWorkspaceDirectory: () => undefined,
    selectedModelId: "model-1",
    setComposerSelectedModelId: () => undefined,
    selectComposerModel: async () => undefined,
    toolConfirmationPolicy: "full_access",
    setToolConfirmationPolicy: () => undefined,
    saveToolConfirmationPolicy: async () => undefined,
  });
  return {
    controller,
    uploadAttemptRef,
    get attachments() { return attachments; },
  };
}

function managedAttachment(attachmentId: string): ContextAttachment {
  return {
    attachmentId,
    kind: "file",
    ref: `uploaded-attachment:${attachmentId}`,
    title: "notes.txt",
    summary: "Managed upload",
    permissionRefs: [`read:uploaded-attachment:${attachmentId}`],
    readonlyPreviewMeta: { available: true, title: "notes.txt", mimeType: "text/plain" },
    status: "ready",
  };
}

function dispatch<T>(write: (value: T) => void, read: () => T): React.Dispatch<React.SetStateAction<T>> {
  return (action) => {
    write(typeof action === "function" ? (action as (previous: T) => T)(read()) : action);
  };
}
