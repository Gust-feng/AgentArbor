import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { utf16SafePrefixLength } from "../text-window.js";

export const DEFAULT_LOCAL_WORKSPACE_ROOT = process.cwd();
export const MAX_LOCAL_WORKSPACE_FILE_BYTES = 512_000;

export type LocalWorkspaceToolOptions = {
  readonly sandboxPolicy?: import("../../../domain/tools/index.js").SandboxPolicy;
  readonly commandShell?: import("../../../domain/config/index.js").SanitizedCommandShellConfig;
  readonly mutationCoordinator?: import("./local-workspace-mutation-coordinator.js").LocalWorkspaceMutationCoordinator;
};

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error("Tool execution cancelled.");
    error.name = "AbortError";
    throw error;
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
  return name === ".git" || name === "node_modules" || name === "dist" || name === "coverage";
}

export function isLikelyBinaryPath(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|exe|dll|bin|lock)$/i.test(value);
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const prefixLength = utf16SafePrefixLength(value, Math.max(0, maxLength - 1));
  return `${value.slice(0, prefixLength)}…`;
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

export function optionalSafeIntegerAtLeast(
  value: unknown,
  fieldName: string,
  minimum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${fieldName} must be at least ${minimum} and a safe integer.`);
  }
  return value as number;
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

export function decodeUtf8Text(value: Uint8Array): string | undefined {
  try {
    // Keeping the BOM as U+FEFF ensures a read/edit/write cycle preserves the
    // original bytes instead of silently changing the file encoding marker.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    return undefined;
  }
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
