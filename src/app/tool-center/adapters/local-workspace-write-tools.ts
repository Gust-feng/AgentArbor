import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolExecutor } from "../../../domain/tools/index.js";
import {
  asRecord,
  DEFAULT_LOCAL_WORKSPACE_ROOT,
  MAX_LOCAL_WORKSPACE_FILE_BYTES,
  positiveInteger,
  requireText,
  resolveWorkspacePath,
  sha256Hex,
  stringOrFallback,
  throwIfAborted,
  type LocalWorkspaceToolOptions,
} from "./local-workspace-common.js";
import {
  assertSandboxAllowed,
  createLocalWorkspaceSandboxPolicy,
  sandboxRequest,
} from "./local-workspace-sandbox.js";

export function createLocalWriteFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file under the local workspace. Returns the written path and byte size.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "Text content to write." },
          append: { type: "boolean", description: "If true, append to the file instead of overwriting." },
        },
        required: ["path", "content"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const content = requireText(record.content, "content", { allowEmpty: true });
      const append = record.append === true;
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("write", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      if (append) {
        await fs.appendFile(target.absolutePath, content, "utf8");
      } else {
        await fs.writeFile(target.absolutePath, content, "utf8");
      }
      const stat = await fs.stat(target.absolutePath);
      return {
        action: "write_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · ${append ? "appended" : "written"}`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          append,
        },
        truncated: false,
      };
    },
  };
}

export function createLocalCreateFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "create_file",
      description: "Create a UTF-8 text file under the local workspace. By default it fails if the target exists; set overwrite=true to replace the file.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          content: { type: "string", description: "UTF-8 text content to create." },
          overwrite: { type: "boolean", description: "If true, overwrite the target file when it already exists." },
        },
        required: ["path", "content"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const content = requireText(record.content, "content", { allowEmpty: true });
      const overwrite = record.overwrite === true;
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      if (target.relativePath === ".") {
        throw new Error("create_file expects a file path.");
      }
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("write", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      try {
        await fs.writeFile(target.absolutePath, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new Error(`create_file target already exists: ${target.relativePath}. Set overwrite=true to replace it.`);
        }
        throw error;
      }
      const stat = await fs.stat(target.absolutePath);
      const afterHash = sha256Hex(content);
      return {
        action: "create_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · ${overwrite ? "overwritten" : "created"}`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          afterHash,
          overwrite,
        },
        truncated: false,
      };
    },
  };
}

export function createLocalEditFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "edit_file",
      description: "Edit a UTF-8 text file under the local workspace with precise text replacements. Provide the exact existing text and the replacement text; when the same text appears multiple times, use occurrence or line range to target the intended location.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          edits: {
            type: "array",
            description: "Precise text edits. Each edit replaces exact existing text with new text. Use occurrence or line range only when the same text appears more than once.",
            items: {
              type: "object",
              properties: {
                oldText: { type: "string", description: "Exact existing text to replace." },
                newText: { type: "string", description: "Replacement text." },
                occurrence: { type: "number", description: "Optional 1-based occurrence of oldText in the file." },
                startLine: { type: "number", description: "Optional 1-based start line used to narrow or verify the target location." },
                endLine: { type: "number", description: "Optional 1-based end line used to narrow or verify the target location." },
              },
              required: ["oldText", "newText"],
            },
          },
        },
        required: ["path", "edits"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const edits = parseAnchorEdits(record.edits);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("edit", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`edit_file expects a file path: ${target.relativePath}`);
      }
      if (stat.size > MAX_LOCAL_WORKSPACE_FILE_BYTES) {
        throw new Error(`File is too large to edit safely: ${target.relativePath}`);
      }
      const original = await fs.readFile(target.absolutePath, "utf8");
      const located = locateAnchorEdits(original, edits, target.relativePath);
      assertNoOverlappingEdits(located, target.relativePath);
      let updated = original;
      for (const edit of [...located].sort((left, right) => right.start - left.start)) {
        updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`;
      }
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("edit", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(updated, "utf8"),
      }));
      await fs.writeFile(target.absolutePath, updated, "utf8");
      const beforeHash = sha256Hex(original);
      const afterHash = sha256Hex(updated);
      return {
        action: "edit_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${original.length} -> ${updated.length} chars · ${located.length} replacements`,
        result: {
          path: target.relativePath,
          previousLength: original.length,
          nextLength: updated.length,
          replacements: located.length,
          beforeHash,
          afterHash,
          diffSummary: diffSummaryForEdits(original, located),
        },
        truncated: false,
      };
    },
  };
}

export function createLocalDeleteFileTool(rootDirectory = DEFAULT_LOCAL_WORKSPACE_ROOT, options: LocalWorkspaceToolOptions = {}): ToolExecutor {
  const sandboxPolicy = options.sandboxPolicy ?? createLocalWorkspaceSandboxPolicy();
  return {
    definition: {
      name: "delete_file",
      description: "Delete a regular file under the local workspace. Directory deletion is not supported.",
      metadata: {
        category: "filesystem",
        riskLevel: "medium",
        operationType: "read-write",
        requiresConfirmation: false,
        visibleResultPolicy: {
          userVisible: "summary-only",
          maxPreviewChars: 600,
          omitRawOutput: true,
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path to delete." },
        },
        required: ["path"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("delete", rootDirectory, target.relativePath));
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) {
        throw new Error(`delete_file expects a regular file path: ${target.relativePath}`);
      }
      await fs.unlink(target.absolutePath);
      return {
        action: "delete_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · deleted`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
        },
        truncated: false,
      };
    },
  };
}

type AnchorEditInput = {
  readonly oldText: string;
  readonly replacement: string;
  readonly occurrence?: number;
  readonly startLineHint?: number;
  readonly endLineHint?: number;
};

type LocatedAnchorEdit = AnchorEditInput & {
  readonly start: number;
  readonly end: number;
};

function parseAnchorEdits(value: unknown): readonly AnchorEditInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("edits must be a non-empty array.");
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    const oldText = textField(record.oldText) ?? textField(record.anchor);
    const replacement = textField(record.newText) ?? textField(record.replacement);
    return {
      oldText: oldText ?? requireText(record.oldText ?? record.anchor, `edits[${index}].oldText`, { allowEmpty: false }),
      replacement: replacement ?? requireText(record.newText ?? record.replacement, `edits[${index}].newText`, { allowEmpty: true }),
      occurrence: positiveInteger(record.occurrence),
      startLineHint: positiveInteger(record.startLine) ?? positiveInteger(record.startLineHint),
      endLineHint: positiveInteger(record.endLine) ?? positiveInteger(record.endLineHint),
    };
  });
}

function locateAnchorEdits(
  source: string,
  edits: readonly AnchorEditInput[],
  relativePath: string
): readonly LocatedAnchorEdit[] {
  return edits.map((edit, index) => {
    const matches = findAllOccurrences(source, edit.oldText);
    const target = editTargetText(edit);
    if (matches.length === 0) {
      throw new Error(`edit_file edit ${index + 1} could not find the target text in ${relativePath}${target}.`);
    }
    const selectedMatches = selectMatches(source, edit, matches, relativePath, index);
    if (selectedMatches.length > 1) {
      throw new Error(
        `edit_file edit ${index + 1} matched ${matches.length} locations in ${relativePath}${target}; provide occurrence or line range to disambiguate.`
      );
    }
    if (selectedMatches.length === 0) {
      throw new Error(
        `edit_file edit ${index + 1} matched ${matches.length} locations in ${relativePath}${target}, but none overlapped the requested line range.`
      );
    }
    const start = selectedMatches[0]!;
    return {
      ...edit,
      start,
      end: start + edit.oldText.length,
    };
  });
}

function selectMatches(
  source: string,
  edit: AnchorEditInput,
  matches: readonly number[],
  relativePath: string,
  index: number
): readonly number[] {
  if (edit.occurrence !== undefined) {
    const selected = matches[edit.occurrence - 1];
    if (selected === undefined) {
      throw new Error(
        `edit_file edit ${index + 1} requested occurrence ${edit.occurrence}, but only found ${matches.length} matches in ${relativePath}${editTargetText(edit)}.`
      );
    }
    if (!matchesLineHint(source, edit, selected)) {
      throw new Error(
        `edit_file edit ${index + 1} occurrence ${edit.occurrence} in ${relativePath} did not overlap the requested line range${lineHintText(edit)}.`
      );
    }
    return [selected];
  }
  return selectMatchesByLineHint(source, edit, matches);
}

function selectMatchesByLineHint(
  source: string,
  edit: AnchorEditInput,
  matches: readonly number[]
): readonly number[] {
  if (matches.length <= 1 || (edit.startLineHint === undefined && edit.endLineHint === undefined)) {
    return matches;
  }
  return matches.filter((offset) => matchesLineHint(source, edit, offset));
}

function matchesLineHint(source: string, edit: AnchorEditInput, offset: number): boolean {
  if (edit.startLineHint === undefined && edit.endLineHint === undefined) {
    return true;
  }
  const startLine = edit.startLineHint ?? edit.endLineHint!;
  const endLine = edit.endLineHint ?? startLine;
  const editStartLine = lineNumberAt(source, offset);
  const editEndLine = lineNumberAt(source, offset + edit.oldText.length);
  return editStartLine <= endLine && editEndLine >= startLine;
}

function assertNoOverlappingEdits(edits: readonly LocatedAnchorEdit[], relativePath: string): void {
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.end > current.start) {
      throw new Error(`edit_file edits overlap in ${relativePath}; split or narrow the anchors.`);
    }
  }
}

function diffSummaryForEdits(source: string, edits: readonly LocatedAnchorEdit[]): readonly string[] {
  return edits
    .slice()
    .sort((left, right) => left.start - right.start)
    .map((edit) => {
      const line = lineNumberAt(source, edit.start);
      return `line ${line}: ${previewOneLine(edit.oldText)} -> ${previewOneLine(edit.replacement)}`;
    });
}

function findAllOccurrences(source: string, search: string): readonly number[] {
  const matches: number[] = [];
  let position = 0;
  while (position <= source.length - search.length) {
    const index = source.indexOf(search, position);
    if (index === -1) {
      break;
    }
    matches.push(index);
    position = index + search.length;
  }
  return matches;
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    }
  }
  return line;
}

function lineHintText(edit: AnchorEditInput): string {
  const start = edit.startLineHint;
  const end = edit.endLineHint;
  if (start === undefined && end === undefined) {
    return "";
  }
  return ` near lines ${start ?? "?"}-${end ?? start ?? "?"}`;
}

function editTargetText(edit: AnchorEditInput): string {
  const parts: string[] = [];
  if (edit.occurrence !== undefined) {
    parts.push(`occurrence ${edit.occurrence}`);
  }
  const hint = lineHintText(edit).trim();
  if (hint.length > 0) {
    parts.push(hint);
  }
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function previewOneLine(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
