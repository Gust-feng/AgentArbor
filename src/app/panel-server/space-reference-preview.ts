/**
 * Space 引用预览的业务分派层。
 *
 * 本模块只负责 `reference.kind` 业务分派：
 * - web_page / 非本地类型直接返回对应预览或 unsupported
 * - local_file / workspace_folder / managed_folder 委托给
 *   local-reference-preview.ts 的共享本地文件系统预览逻辑
 *
 * 纯机械性文件系统操作（路径安全、MIME 识别、文本解码、指纹计算等）
 * 已提取到 local-filesystem 中性模块。本文件不再导出这些函数。
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { SpaceReferencePreview } from "../panel-api-contracts.js";
import type { SpaceReferenceItem } from "../spaces/index.js";
import { PanelHttpError } from "./http-utils.js";
import {
  buildLocalReferencePreview,
  streamLocalReferenceContent,
  type LocalReferenceMeta,
} from "./local-reference-preview.js";
import { normalizeRelativePath } from "../local-filesystem/index.js";
import { documentPresentation } from "./document-preview-presentation.js";

export type PanelSpaceReferencePreview = SpaceReferencePreview;

export async function createPanelSpaceReferencePreview(
  item: SpaceReferenceItem,
  relativePath = "",
  contentBaseUrl?: string,
  contentTypeHintPath?: string,
): Promise<PanelSpaceReferencePreview> {
  if (item.reference.kind === "web_page") {
    const content = { kind: "web" as const, url: item.reference.url };
    return {
      itemId: item.id,
      title: item.title,
      sourceKind: item.reference.kind,
      source: item.reference.url,
      status: "ready",
      presentation: documentPresentation(content),
      content,
    };
  }
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    const content = { kind: "unavailable" as const, message: "这个引用需要由它的来源功能提供预览。" };
    return {
      itemId: item.id,
      title: item.title,
      sourceKind: item.reference.kind,
      source: referenceSource(item),
      status: "unsupported",
      presentation: documentPresentation(content),
      content,
    };
  }

  const meta: LocalReferenceMeta = { itemId: item.id, title: item.title, sourceKind: item.reference.kind };
  const normalized = safeNormalizeRelativePath(relativePath);
  if (item.reference.kind === "local_file" && normalized.length > 0) {
    throw new PanelHttpError(400, "invalid_space_reference_path", "文件引用不接受子路径。");
  }
  return buildLocalReferencePreview(item.reference.path, normalized, meta, { contentBaseUrl, contentTypeHintPath });
}

export async function writePanelSpaceReferenceContent(
  item: SpaceReferenceItem,
  request: IncomingMessage,
  response: ServerResponse,
  relativePath = "",
  contentTypeHintPath?: string,
): Promise<void> {
  if (item.reference.kind !== "local_file" && item.reference.kind !== "workspace_folder" && item.reference.kind !== "managed_folder") {
    throw new PanelHttpError(409, "space_reference_content_unavailable", "这个引用没有可读取的文件内容。");
  }
  const normalized = safeNormalizeRelativePath(relativePath);
  if (item.reference.kind === "local_file" && normalized.length > 0) {
    throw new PanelHttpError(400, "invalid_space_reference_path", "文件引用不接受子路径。");
  }
  await streamLocalReferenceContent(item.reference.path, normalized, request, response, contentTypeHintPath);
}

function referenceSource(item: SpaceReferenceItem): string {
  switch (item.reference.kind) {
    case "local_file":
    case "workspace_folder":
    case "managed_folder": return item.reference.path;
    case "asset_folder": return item.title;
    case "workbench_asset": return item.reference.assetId;
    case "web_page": return item.reference.url;
    case "generated_artifact": return item.reference.artifactRef;
    case "conversation": return item.reference.conversationId;
  }
}

function safeNormalizeRelativePath(value: string): string {
  try {
    return normalizeRelativePath(value);
  } catch {
    throw new PanelHttpError(400, "invalid_space_reference_path", "引用子路径无效。");
  }
}
