import { createHash } from "node:crypto";
import path from "node:path";

export const DEFAULT_LOCAL_WORKSPACE_ROOT = process.cwd();
export const MAX_LOCAL_WORKSPACE_FILE_BYTES = 512_000;

export type LocalWorkspaceToolOptions = {
  readonly sandboxPolicy?: import("../../../domain/tools/index.js").SandboxPolicy;
};

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Tool execution cancelled.");
  }
}

export function resolveWorkspacePath(rootDirectory: string, requestedPath: string): { readonly absolutePath: string; readonly relativePath: string } {
  const root = path.resolve(rootDirectory);
  const absolutePath = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace boundary.");
  }
  return {
    absolutePath,
    relativePath: relative.length === 0 ? "." : normalizePath(relative),
  };
}

export function toWorkspaceRelative(rootDirectory: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootDirectory), absolutePath);
  return relative.length === 0 ? "." : normalizePath(relative);
}

export function safeRefToken(value: string): string {
  const token = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return token.length === 0 ? "query" : token;
}

export function shouldSkipEntry(name: string): boolean {
  return name === "node_modules" || name === "dist" || name === "coverage";
}

export function isLikelyBinaryPath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dll|bin|lock)$/i.test(value);
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

export function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function requireText(value: unknown, fieldName: string, options: { readonly allowEmpty: boolean }): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
