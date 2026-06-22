import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SkillRuntimeResourceType } from "./skill-loader.js";

export const DEFAULT_SKILL_RESOURCE_MAX_CHARS = 16_000;

export type SkillResourcePackageInput = {
  readonly packagePath: string;
  readonly sourcePath: string;
};

export type SkillResourceResolverInput = SkillResourcePackageInput & {
  readonly relativePath: string;
  readonly type: SkillRuntimeResourceType;
  readonly maxChars?: number;
};

export type SkillResourceResolverErrorCode =
  | "empty_path"
  | "nul_in_path"
  | "absolute_path"
  | "path_escape"
  | "resource_type_mismatch"
  | "invalid_max_chars"
  | "package_not_found"
  | "package_not_directory"
  | "source_not_found"
  | "source_not_file"
  | "source_outside_package"
  | "resource_not_found"
  | "resource_not_file"
  | "cross_package_path"
  | "resource_read_failed";

export type SkillResourceResolvedFacts = {
  readonly ok: true;
  readonly relativePath: string;
  readonly type: SkillRuntimeResourceType;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly charCount?: number;
  readonly truncated: boolean;
  readonly content?: string;
  readonly requiresToolExecution?: true;
  readonly notExecutableByResolver?: true;
  readonly executionNote?: string;
};

export type SkillResourceErrorFacts = {
  readonly ok: false;
  readonly relativePath: string;
  readonly type: SkillRuntimeResourceType;
  readonly truncated: false;
  readonly errorCode: SkillResourceResolverErrorCode;
  readonly errorMessage: string;
};

export type SkillResourceResolverResult = SkillResourceResolvedFacts | SkillResourceErrorFacts;

export async function resolveSkillResource(input: SkillResourceResolverInput): Promise<SkillResourceResolverResult> {
  return resolveSkillResourceInternal(input, { includeReferenceContent: false });
}

export async function readSkillResource(input: SkillResourceResolverInput): Promise<SkillResourceResolverResult> {
  return resolveSkillResourceInternal(input, { includeReferenceContent: true });
}

async function resolveSkillResourceInternal(
  input: SkillResourceResolverInput,
  options: { readonly includeReferenceContent: boolean }
): Promise<SkillResourceResolverResult> {
  const normalized = normalizeSkillResourcePath(input.relativePath);
  if (!normalized.ok) {
    return errorFacts(input.type, "", normalized.errorCode);
  }

  if (!isPathForResourceType(normalized.relativePath, input.type)) {
    return errorFacts(input.type, normalized.relativePath, "resource_type_mismatch");
  }

  const maxChars = normalizeMaxChars(input.maxChars);
  if (typeof maxChars !== "number") {
    return errorFacts(input.type, normalized.relativePath, maxChars);
  }

  const packageFacts = await resolvePackageFacts(input);
  if (!packageFacts.ok) {
    return errorFacts(input.type, normalized.relativePath, packageFacts.errorCode);
  }

  const resourcePath = path.resolve(packageFacts.packageRealPath, normalized.relativePath);
  if (!isInsideOrEqual(packageFacts.packageRealPath, resourcePath)) {
    return errorFacts(input.type, normalized.relativePath, "path_escape");
  }

  const resourceRealPath = await fs.realpath(resourcePath).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }).catch(() => null);
  if (resourceRealPath === undefined) {
    return errorFacts(input.type, normalized.relativePath, "resource_not_found");
  }
  if (resourceRealPath === null || !isInsideOrEqual(packageFacts.packageRealPath, resourceRealPath)) {
    return errorFacts(input.type, normalized.relativePath, "cross_package_path");
  }

  const stat = await fs.stat(resourceRealPath).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }).catch(() => null);
  if (stat === undefined) {
    return errorFacts(input.type, normalized.relativePath, "resource_not_found");
  }
  if (stat === null) {
    return errorFacts(input.type, normalized.relativePath, "resource_read_failed");
  }
  if (!stat.isFile()) {
    return errorFacts(input.type, normalized.relativePath, "resource_not_file");
  }

  const bytes = await fs.readFile(resourceRealPath).catch(() => undefined);
  if (bytes === undefined) {
    return errorFacts(input.type, normalized.relativePath, "resource_read_failed");
  }

  return resourceFacts({
    bytes,
    includeReferenceContent: options.includeReferenceContent,
    maxChars,
    relativePath: normalized.relativePath,
    type: input.type,
  });
}

function resourceFacts(input: {
  readonly bytes: Buffer;
  readonly includeReferenceContent: boolean;
  readonly maxChars: number;
  readonly relativePath: string;
  readonly type: SkillRuntimeResourceType;
}): SkillResourceResolvedFacts {
  const base = {
    ok: true as const,
    relativePath: input.relativePath,
    type: input.type,
    contentHash: hashBuffer(input.bytes),
    byteLength: input.bytes.byteLength,
  };

  if (input.type === "script") {
    return {
      ...base,
      truncated: false,
      requiresToolExecution: true,
      notExecutableByResolver: true,
      executionNote: "Skill scripts are metadata-only here; execution must go through ToolCenter confirmation.",
    };
  }

  if (input.type === "asset") {
    return {
      ...base,
      truncated: false,
    };
  }

  const text = input.bytes.toString("utf8");
  const truncated = text.length > input.maxChars;
  return {
    ...base,
    charCount: text.length,
    truncated,
    ...(input.includeReferenceContent ? { content: truncated ? text.slice(0, input.maxChars) : text } : {}),
  };
}

async function resolvePackageFacts(input: SkillResourcePackageInput): Promise<{
  readonly ok: true;
  readonly packageRealPath: string;
} | {
  readonly ok: false;
  readonly errorCode: SkillResourceResolverErrorCode;
}> {
  const packageRealPath = await fs.realpath(input.packagePath).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }).catch(() => null);
  if (packageRealPath === undefined) {
    return { ok: false, errorCode: "package_not_found" };
  }
  if (packageRealPath === null) {
    return { ok: false, errorCode: "package_not_found" };
  }

  const packageStat = await fs.stat(packageRealPath).catch(() => undefined);
  if (packageStat === undefined || !packageStat.isDirectory()) {
    return { ok: false, errorCode: "package_not_directory" };
  }

  const sourceRealPath = await fs.realpath(input.sourcePath).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }).catch(() => null);
  if (sourceRealPath === undefined) {
    return { ok: false, errorCode: "source_not_found" };
  }
  if (sourceRealPath === null || !isInsideOrEqual(packageRealPath, sourceRealPath)) {
    return { ok: false, errorCode: "source_outside_package" };
  }

  const sourceStat = await fs.stat(sourceRealPath).catch(() => undefined);
  if (sourceStat === undefined) {
    return { ok: false, errorCode: "source_not_found" };
  }
  if (!sourceStat.isFile()) {
    return { ok: false, errorCode: "source_not_file" };
  }

  return { ok: true, packageRealPath };
}

function normalizeSkillResourcePath(value: string): {
  readonly ok: true;
  readonly relativePath: string;
} | {
  readonly ok: false;
  readonly errorCode: SkillResourceResolverErrorCode;
} {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorCode: "empty_path" };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, errorCode: "nul_in_path" };
  }
  if (
    path.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    path.posix.isAbsolute(trimmed) ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return { ok: false, errorCode: "absolute_path" };
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return { ok: false, errorCode: "path_escape" };
  }
  return { ok: true, relativePath: normalized };
}

function isPathForResourceType(relativePath: string, type: SkillRuntimeResourceType): boolean {
  const folder = resourceFolder(type);
  return relativePath === folder || relativePath.startsWith(`${folder}/`);
}

function resourceFolder(type: SkillRuntimeResourceType): string {
  switch (type) {
    case "reference":
      return "references";
    case "asset":
      return "assets";
    case "script":
      return "scripts";
  }
}

function normalizeMaxChars(value: number | undefined): number | SkillResourceResolverErrorCode {
  if (value === undefined) {
    return DEFAULT_SKILL_RESOURCE_MAX_CHARS;
  }
  if (!Number.isFinite(value) || value < 0) {
    return "invalid_max_chars";
  }
  return Math.floor(value);
}

function errorFacts(
  type: SkillRuntimeResourceType,
  relativePath: string,
  errorCode: SkillResourceResolverErrorCode
): SkillResourceErrorFacts {
  return {
    ok: false,
    relativePath,
    type,
    truncated: false,
    errorCode,
    errorMessage: errorMessageFor(errorCode),
  };
}

function errorMessageFor(code: SkillResourceResolverErrorCode): string {
  switch (code) {
    case "empty_path":
      return "Skill resource path must not be empty.";
    case "nul_in_path":
      return "Skill resource path must not contain NUL bytes.";
    case "absolute_path":
      return "Skill resource path must be package-relative.";
    case "path_escape":
      return "Skill resource path must stay inside the skill package.";
    case "resource_type_mismatch":
      return "Skill resource path does not match the requested resource type.";
    case "invalid_max_chars":
      return "Skill resource maxChars must be a non-negative finite number.";
    case "package_not_found":
      return "Skill package directory does not exist.";
    case "package_not_directory":
      return "Skill package path is not a directory.";
    case "source_not_found":
      return "Skill source file does not exist.";
    case "source_not_file":
      return "Skill source path is not a file.";
    case "source_outside_package":
      return "Skill source file must stay inside the skill package.";
    case "resource_not_found":
      return "Skill resource file does not exist.";
    case "resource_not_file":
      return "Skill resource path is not a file.";
    case "cross_package_path":
      return "Skill resource resolved outside the skill package.";
    case "resource_read_failed":
      return "Skill resource file could not be read.";
  }
}

function isInsideOrEqual(basePath: string, candidatePath: string): boolean {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
