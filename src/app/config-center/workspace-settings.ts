import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeOptionalString } from "./model-provider-settings.js";

export class WorkspaceDirectoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceDirectoryValidationError";
  }
}

export async function normalizeWorkspaceDirectory(value: string | undefined): Promise<string> {
  const normalized = path.resolve(normalizeOptionalString(value) ?? resolveDefaultWorkspaceDirectory());
  await ensureWorkspaceReady(normalized);
  return normalized;
}

/**
 * 文件选择器初始目录偏好（ADR-0035 §2.4）：只做路径规范化，不创建目录、
 * 不参与任何运行授权。兼容期保留旧字段名。
 */
export function normalizeFilePickerInitialDirectory(value: string | undefined): string {
  return path.resolve(normalizeOptionalString(value) ?? resolveDefaultWorkspaceDirectory());
}

export function normalizeConfiguredWorkspaceDirectory(value: string | undefined): string {
  return path.resolve(normalizeOptionalString(value) ?? resolveDefaultWorkspaceDirectory());
}

function resolveDefaultWorkspaceDirectory(): string {
  return path.join(os.homedir(), ".agentarbor", "workspace");
}

async function ensureWorkspaceReady(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new WorkspaceDirectoryValidationError("Workspace directory could not be created.");
  }
  const info = await stat(directory).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new WorkspaceDirectoryValidationError("Workspace directory must be a directory.");
  }
}
