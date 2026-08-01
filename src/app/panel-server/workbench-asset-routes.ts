import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import type { DocumentPreview } from "../panel-api-contracts.js";
import {
  editableWorkbenchAssetText,
  MAX_WORKBENCH_ASSET_TEXT_BYTES,
  type WorkbenchAsset,
  type WorkbenchAssetRepository,
  workbenchAssetTextFingerprint,
} from "../workbench-assets/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import { createWorkbenchAssetPreviewFromAsset } from "./workbench-asset-preview.js";
import { documentPresentation } from "./document-preview-presentation.js";

type WorkbenchAssetRouteRuntime = {
  readonly ensureInitialWorkbenchData: () => Promise<void>;
  readonly workbenchAssets: WorkbenchAssetRepository;
};

const updateTextSchema = z.object({
  itemId: z.string().min(1).max(512).optional(),
  relativePath: z.literal("").optional(),
  expectedFingerprint: z.string().min(1).max(512),
  text: z.string(),
}).strict();

export async function handlePanelWorkbenchAssetRoute(
  runtime: WorkbenchAssetRouteRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const previewMatch = /^\/api\/workbench-assets\/([^/]+)\/preview$/u.exec(url.pathname);
  if (previewMatch !== null && request.method === "GET") {
    await runtime.ensureInitialWorkbenchData();
    const preview = await getWorkbenchAssetPreview(runtime.workbenchAssets, decode(previewMatch[1]));
    writeJson(response, 200, { ok: true, preview });
    return true;
  }

  const contentMatch = /^\/api\/workbench-assets\/([^/]+)\/content$/u.exec(url.pathname);
  if (contentMatch !== null && request.method === "PUT") {
    await runtime.ensureInitialWorkbenchData();
    const assetId = decode(contentMatch[1]);
    const input = parseUpdateInput(await readJsonBody(request, { maxChars: MAX_WORKBENCH_ASSET_TEXT_BYTES * 6 + 2_048 }));
    if (input.itemId !== undefined && input.itemId !== assetId) {
      throw new PanelHttpError(400, "invalid_workbench_asset_input", "请求资产与路径中的资产不一致。");
    }
    writeJson(response, 200, { ok: true, preview: await updateWorkbenchAssetTextPreview(
      runtime.workbenchAssets,
      { assetId, expectedFingerprint: input.expectedFingerprint, text: input.text },
    ) });
    return true;
  }

  return false;
}

export async function updateWorkbenchAssetTextPreview(
  repository: WorkbenchAssetRepository,
  input: { readonly assetId: string; readonly expectedFingerprint: string; readonly text: string },
  itemId = input.assetId,
): Promise<DocumentPreview> {
  if (Buffer.byteLength(input.text, "utf8") > MAX_WORKBENCH_ASSET_TEXT_BYTES) {
    throw new PanelHttpError(413, "workbench_asset_text_too_large", "工作台文本资产超过可编辑大小上限。");
  }
  const result = await repository.updateText({
    id: input.assetId,
    expectedFingerprint: input.expectedFingerprint,
    text: input.text,
  });
  switch (result.status) {
    case "updated": return createWorkbenchAssetTextPreview(result.asset, itemId);
    case "not_found": throw new PanelHttpError(404, "workbench_asset_not_found", "工作台资产已不存在。");
    case "not_editable": throw new PanelHttpError(409, "workbench_asset_not_editable", "只有 Markdown 和代码文本资产可以编辑。");
    case "conflict": throw new PanelHttpError(409, "workbench_asset_revision_conflict", "工作台资产已发生变化，请先比较更改。");
    case "too_large": throw new PanelHttpError(413, "workbench_asset_text_too_large", "工作台文本资产超过可编辑大小上限。");
  }
}

export async function getWorkbenchAssetPreview(
  repository: WorkbenchAssetRepository,
  assetId: string,
  itemId = assetId,
): Promise<DocumentPreview> {
  const asset = await repository.get(assetId);
  if (asset === undefined) throw new PanelHttpError(404, "workbench_asset_not_found", "工作台资产已不存在。");
  return createWorkbenchAssetTextPreview(asset, itemId);
}

export function createWorkbenchAssetTextPreview(
  asset: WorkbenchAsset,
  itemId = asset.id,
): DocumentPreview {
  const preview = createWorkbenchAssetPreviewFromAsset(asset, itemId);
  const editable = editableWorkbenchAssetText(asset);
  if (editable === undefined || preview.content.kind !== "text") return preview;
  const content: Extract<DocumentPreview["content"], { readonly kind: "text" }> = {
    ...preview.content,
    text: editable.text,
    truncated: false,
    editable: true,
    language: editable.language,
    encoding: "UTF-8",
  };
  return {
    ...preview,
    fingerprint: workbenchAssetTextFingerprint(editable.text),
    byteLength: Buffer.byteLength(editable.text, "utf8"),
    presentation: documentPresentation(content),
    content,
  };
}

function parseUpdateInput(raw: unknown): z.infer<typeof updateTextSchema> {
  const result = updateTextSchema.safeParse(raw);
  if (!result.success) {
    throw new PanelHttpError(400, "invalid_workbench_asset_input", "工作台资产编辑请求无效。");
  }
  return result.data;
}

function decode(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}
