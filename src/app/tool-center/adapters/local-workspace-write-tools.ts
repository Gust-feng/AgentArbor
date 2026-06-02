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
      description: "Create a new UTF-8 text file under the local workspace. Fails if the target already exists; never overwrites.",
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
        },
        required: ["path", "content"],
      },
    },
    execute: async (input, context) => {
      throwIfAborted(context.abortSignal);
      const record = asRecord(input);
      const content = requireText(record.content, "content", { allowEmpty: true });
      const target = resolveWorkspacePath(rootDirectory, stringOrFallback(record.path, ""));
      if (target.relativePath === ".") {
        throw new Error("create_file expects a file path.");
      }
      assertSandboxAllowed(sandboxPolicy, sandboxRequest("write", rootDirectory, target.relativePath, {
        bytes: Buffer.byteLength(content, "utf8"),
      }));
      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      try {
        await fs.writeFile(target.absolutePath, content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new Error(`create_file target already exists: ${target.relativePath}.`);
        }
        throw error;
      }
      const stat = await fs.stat(target.absolutePath);
      const afterHash = sha256Hex(content);
      return {
        action: "create_file",
        status: "completed",
        refId: `workspace:file:${target.relativePath}`,
        summary: `${target.relativePath} · ${stat.size} bytes · created`,
        result: {
          path: target.relativePath,
          bytes: stat.size,
          afterHash,
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
      description: "Atomically edit a UTF-8 text file under the local workspace with exact anchor replacements. Every anchor must match exactly once.",
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
            description: "Atomic edits. Each anchor is exact text to replace and must match exactly once.",
            items: {
              type: "object",
              properties: {
                anchor: { type: "string", description: "Exact existing text to replace. Must match once." },
                replacement: { type: "string", description: "Replacement text." },
                startLineHint: { type: "number", description: "Optional diagnostic hint only; not used to guess." },
                endLineHint: { type: "number", description: "Optional diagnostic hint only; not used to guess." },
              },
              required: ["anchor", "replacement"],
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
        riskLevel: "high",
        operationType: "read-write",
        requiresConfirmation: true,
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
  readonly anchor: string;
  readonly replacement: string;
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
    return {
      anchor: requireText(record.anchor, `edits[${index}].anchor`, { allowEmpty: false }),
      replacement: requireText(record.replacement, `edits[${index}].replacement`, { allowEmpty: true }),
      startLineHint: positiveInteger(record.startLineHint),
      endLineHint: positiveInteger(record.endLineHint),
    };
  });
}

function locateAnchorEdits(
  source: string,
  edits: readonly AnchorEditInput[],
  relativePath: string
): readonly LocatedAnchorEdit[] {
  return edits.map((edit, index) => {
    const matches = findAllOccurrences(source, edit.anchor);
    const hint = lineHintText(edit);
    if (matches.length === 0) {
      throw new Error(`edit_file anchor ${index + 1} was not found in ${relativePath}${hint}.`);
    }
    if (matches.length > 1) {
      throw new Error(`edit_file anchor ${index + 1} matched ${matches.length} times in ${relativePath}${hint}; provide a more specific anchor.`);
    }
    const start = matches[0]!;
    return {
      ...edit,
      start,
      end: start + edit.anchor.length,
    };
  });
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
      return `line ${line}: ${previewOneLine(edit.anchor)} -> ${previewOneLine(edit.replacement)}`;
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
  return ` near hinted lines ${start ?? "?"}-${end ?? start ?? "?"}`;
}

function previewOneLine(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
