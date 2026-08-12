import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  createDirectory,
  createFile,
  deleteEntry,
  isWithinRoot,
  joinRelativePath,
  normalizeRelativePath,
  readFileText,
  renameEntry as renameFileSystemEntry,
  writeText,
} from "../local-filesystem/index.js";
import {
  MANAGED_CONTENT_MAX_TEXT_BYTES,
  ManagedContentError,
  type ManagedContentEvent,
  type ManagedContentFeature,
  type ManagedContentRoot,
  type ManagedContentRootRecord,
  type ManagedContentSpacePort,
  type ManagedContentTextFile,
} from "./contracts.js";

export function createManagedContentFeature(input: {
  readonly rootDirectory: string;
  readonly spaces: ManagedContentSpacePort;
  readonly idFactory?: () => string;
  readonly runMutation?: <T>(key: string, operation: () => Promise<T>) => Promise<T>;
}): ManagedContentFeature {
  const createId = input.idFactory ?? randomUUID;
  const runMutation = input.runMutation ?? (async <T>(_key: string, operation: () => Promise<T>) => await operation());
  const listeners = new Set<(event: ManagedContentEvent) => void>();
  let released = false;

  const assertActive = (action: string): void => {
    if (released) throw new ManagedContentError("managed_content_released", `Managed content feature is released and cannot ${action}.`);
  };
  const publish = (event: ManagedContentEvent): void => {
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* An observer cannot roll back a committed filesystem operation. */ }
    }
  };
  const root = async (id: string): Promise<ManagedContentRootRecord> => {
    const value = await input.spaces.readManagedRoot(required(id, "rootId"));
    if (value === undefined) throw new ManagedContentError("managed_content_root_not_found", `Managed root ${id} was not found.`);
    await assertRootPath(input.rootDirectory, value.path);
    return value;
  };

  const createRoot = async (value: { readonly id?: string; readonly spaceId: string; readonly title: string }): Promise<ManagedContentRoot> => {
    assertActive("create a root");
    const spaceId = required(value.spaceId, "spaceId");
    const title = requiredTitle(value.title);
    const id = value.id === undefined ? createId() : required(value.id, "id");
    const folder = path.join(input.rootDirectory, `managed-${hashId(id)}`);
    await fs.mkdir(input.rootDirectory, { recursive: true });
    let folderCreated = false;
    try {
      await fs.mkdir(folder);
      folderCreated = true;
      await input.spaces.createManagedRoot({ id, spaceId, title, path: folder });
    } catch (error) {
      if (folderCreated) await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    publish({ type: "managed_content.root_changed", rootId: id });
    return { id, spaceId, title };
  };

  return {
    commands: {
      createRoot,
      async applyRoot(value) {
        assertActive("apply a root");
        const id = required(value.id, "id");
        const current = await input.spaces.readManagedRoot(id);
        if (current === undefined) {
          await createRoot(value);
          return;
        }
        if (current.spaceId !== value.spaceId) await input.spaces.moveManagedRoot(id, required(value.spaceId, "spaceId"));
        if (current.title !== value.title) await input.spaces.renameManagedRoot(id, requiredTitle(value.title));
        publish({ type: "managed_content.root_changed", rootId: id });
      },
      async deleteRoot(id) {
        assertActive("delete a root");
        const current = await root(id);
        await runMutation(current.id, async () => await input.spaces.removeManagedRoot(current.id));
        publish({ type: "managed_content.root_changed", rootId: current.id });
      },
      async createEntry(value) {
        assertActive("create an entry");
        const current = await root(value.rootId);
        const relativePath = entryPath(value.parentRelativePath, value.name);
        return await runMutation(current.id, async () => {
          const target = await safePath(current, relativePath, true);
          const result = value.kind === "directory" ? await createDirectory(target) : await createFile(target);
          if (!result.ok) {
            if (result.error.kind === "already_exists") throw new ManagedContentError("managed_content_entry_exists", `Entry ${relativePath} already exists.`);
            throw new ManagedContentError("managed_content_io_failure", `Could not create ${relativePath}.`);
          }
          publish({ type: "managed_content.root_changed", rootId: current.id });
          return { relativePath };
        });
      },
      async renameEntry(value) {
        assertActive("rename an entry");
        const current = await root(value.rootId);
        const sourcePath = normalizeEntryPath(value.relativePath);
        const name = requiredEntryName(value.name);
        const parent = path.posix.dirname(sourcePath) === "." ? "" : path.posix.dirname(sourcePath);
        const destinationPath = entryPath(parent, name);
        return await runMutation(current.id, async () => {
          const source = await safePath(current, sourcePath, false);
          const destination = await safePath(current, destinationPath, true);
          const result = await renameFileSystemEntry(source, destination);
          if (!result.ok) {
            if (result.error.kind === "not_found") throw new ManagedContentError("managed_content_entry_not_found", `Entry ${sourcePath} was not found.`);
            if (result.error.kind === "already_exists") throw new ManagedContentError("managed_content_entry_exists", `Entry ${destinationPath} already exists.`);
            throw new ManagedContentError("managed_content_io_failure", `Could not rename ${sourcePath}.`);
          }
          publish({ type: "managed_content.root_changed", rootId: current.id });
          return { relativePath: destinationPath };
        });
      },
      async deleteEntry(value) {
        assertActive("delete an entry");
        const current = await root(value.rootId);
        const relativePath = normalizeEntryPath(value.relativePath);
        await runMutation(current.id, async () => {
          const target = await safePath(current, relativePath, false);
          const result = await deleteEntry(target);
          if (!result.ok) {
            if (result.error.kind === "not_found") throw new ManagedContentError("managed_content_entry_not_found", `Entry ${relativePath} was not found.`);
            throw new ManagedContentError("managed_content_io_failure", `Could not delete ${relativePath}.`);
          }
          publish({ type: "managed_content.root_changed", rootId: current.id });
        });
      },
      async writeText(value) {
        assertActive("write text");
        const current = await root(value.rootId);
        const relativePath = normalizeEntryPath(value.relativePath);
        assertTextSize(value.text);
        return await runMutation(current.id, async () => {
          const target = await safePath(current, relativePath, true);
          await fs.mkdir(path.dirname(target), { recursive: true });
          const existing = await readFileText(target, { maxBytes: MANAGED_CONTENT_MAX_TEXT_BYTES });
          if (!existing.ok && existing.error.kind !== "not_found") {
            throw new ManagedContentError("managed_content_not_text", `Entry ${relativePath} is not editable text.`);
          }
          if (existing.ok && (existing.value.truncated || existing.value.encoding !== "UTF-8")) {
            throw new ManagedContentError("managed_content_not_text", `Entry ${relativePath} is not editable UTF-8 text.`);
          }
          if (value.expectedFingerprint !== undefined && value.expectedFingerprint !== (existing.ok ? existing.value.fingerprint : "")) {
            throw new ManagedContentError("managed_content_revision_conflict", `Entry ${relativePath} changed before it could be saved.`);
          }
          if (existing.ok) {
            const result = await writeText(target, value.text, existing.value.fingerprint);
            if (!result.ok) {
              if (result.error.kind === "fingerprint_mismatch") throw new ManagedContentError("managed_content_revision_conflict", `Entry ${relativePath} changed before it could be saved.`);
              throw new ManagedContentError("managed_content_io_failure", `Could not save ${relativePath}.`);
            }
          } else {
            try {
              await fs.writeFile(target, value.text, { encoding: "utf8", flag: "wx" });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ManagedContentError("managed_content_revision_conflict", `Entry ${relativePath} was created concurrently.`);
              throw new ManagedContentError("managed_content_io_failure", `Could not create ${relativePath}.`, { cause: error });
            }
          }
          const saved = await readTextFileFromRoot(current, relativePath);
          if (saved === undefined) throw new ManagedContentError("managed_content_io_failure", `Saved entry ${relativePath} could not be read back.`);
          publish({ type: "managed_content.file_changed", managedRootId: current.id, relativePath });
          return saved;
        });
      },
      async deleteText(value) {
        assertActive("delete text");
        const current = await root(value.rootId);
        const relativePath = normalizeEntryPath(value.relativePath);
        await runMutation(current.id, async () => {
          const target = await safePath(current, relativePath, false);
          const stat = await fs.lstat(target).catch(() => undefined);
          if (stat?.isFile() !== true) throw new ManagedContentError("managed_content_not_text", `Entry ${relativePath} is not a regular text file.`);
          const result = await deleteEntry(target);
          if (!result.ok) throw new ManagedContentError("managed_content_io_failure", `Could not delete ${relativePath}.`);
          publish({ type: "managed_content.file_deleted", managedRootId: current.id, relativePath });
        });
      },
    },
    queries: {
      async listRoots() {
        assertActive("list roots");
        return (await input.spaces.listManagedRoots()).map(stripRootPath);
      },
      async readRoot(id) {
        assertActive("read a root");
        const value = await input.spaces.readManagedRoot(id);
        return value === undefined ? undefined : stripRootPath(value);
      },
      async listTextFiles(id) {
        assertActive("list text files");
        const current = await root(id);
        const files: ManagedContentTextFile[] = [];
        await walkTextFiles(current.path, "", current.id, files);
        return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      },
      async readTextFile(id, relativePath) {
        assertActive("read a text file");
        const current = await root(id);
        return await readTextFileFromRoot(current, normalizeEntryPath(relativePath));
      },
    },
    events: {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    async release() {
      if (released) return;
      released = true;
      listeners.clear();
    },
  };
}

async function walkTextFiles(rootPath: string, relative: string, rootId: string, output: ManagedContentTextFile[]): Promise<void> {
  const directory = path.join(rootPath, relative);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new ManagedContentError(
      "managed_content_io_failure",
      `Managed directory ${relative || "."} could not be scanned.`,
      { cause: error },
    );
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const next = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkTextFiles(rootPath, next, rootId, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const content = await readFileText(path.join(rootPath, next), { maxBytes: MANAGED_CONTENT_MAX_TEXT_BYTES });
    if (!content.ok) {
      throw new ManagedContentError(
        "managed_content_io_failure",
        `Managed file ${next} could not be read.`,
      );
    }
    if (content.value.truncated || content.value.encoding !== "UTF-8") {
      throw new ManagedContentError(
        "managed_content_not_text",
        `Managed file ${next} is not editable UTF-8 text within the 5 MiB limit.`,
      );
    }
    output.push({ managedRootId: rootId, relativePath: next, text: content.value.text, fingerprint: content.value.fingerprint });
  }
}

async function readTextFileFromRoot(root: ManagedContentRootRecord, relativePath: string): Promise<ManagedContentTextFile | undefined> {
  const target = await safePath(root, relativePath, true);
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ManagedContentError("managed_content_io_failure", `Managed file ${relativePath} could not be inspected.`, { cause: error });
  }
  if (stat === undefined) return undefined;
  if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
  const content = await readFileText(target, { maxBytes: MANAGED_CONTENT_MAX_TEXT_BYTES });
  if (!content.ok) {
    throw new ManagedContentError("managed_content_io_failure", `Managed file ${relativePath} could not be read.`);
  }
  if (content.value.truncated || content.value.encoding !== "UTF-8") {
    throw new ManagedContentError("managed_content_not_text", `Managed file ${relativePath} is not editable UTF-8 text within the 5 MiB limit.`);
  }
  return { managedRootId: root.id, relativePath, text: content.value.text, fingerprint: content.value.fingerprint };
}

async function safePath(root: ManagedContentRootRecord, relativePath: string, allowMissing: boolean): Promise<string> {
  const normalized = normalizeRelativePath(relativePath);
  const absoluteRoot = path.resolve(root.path);
  const candidate = path.resolve(absoluteRoot, normalized);
  if (!isWithinRoot(absoluteRoot, candidate)) throw new ManagedContentError("managed_content_path_escape", "Managed content path escapes its root.");
  await rejectSymlinkSegments(absoluteRoot, candidate, allowMissing);
  if (!allowMissing && await fs.lstat(candidate).catch(() => undefined) === undefined) {
    throw new ManagedContentError("managed_content_entry_not_found", `Managed entry ${normalized} was not found.`);
  }
  return candidate;
}

async function rejectSymlinkSegments(root: string, candidate: string, allowMissing: boolean): Promise<void> {
  const relative = path.relative(root, candidate);
  const segments = relative.length === 0 ? [] : relative.split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && allowMissing) return undefined;
      throw new ManagedContentError("managed_content_entry_not_found", `Managed path ${relative} was not found.`);
    });
    if (stat?.isSymbolicLink()) throw new ManagedContentError("managed_content_path_escape", "Symbolic links are not allowed in managed content.");
  }
}

async function assertRootPath(storageRoot: string, rootPath: string): Promise<void> {
  const storage = await fs.realpath(storageRoot).catch(() => path.resolve(storageRoot));
  const resolved = await fs.realpath(rootPath).catch(() => path.resolve(rootPath));
  if (resolved === storage || !isWithinRoot(storage, resolved)) {
    throw new ManagedContentError("managed_content_path_escape", "Managed root is outside its storage boundary.");
  }
  const stat = await fs.lstat(rootPath).catch(() => undefined);
  if (stat?.isDirectory() !== true || stat.isSymbolicLink()) {
    throw new ManagedContentError("managed_content_root_not_found", "Managed root directory is unavailable.");
  }
}

function stripRootPath(root: ManagedContentRootRecord): ManagedContentRoot {
  return { id: root.id, spaceId: root.spaceId, title: root.title };
}

function hashId(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 24);
}

function required(value: string, field: string): string {
  const result = value.trim();
  if (result.length === 0) throw new ManagedContentError("managed_content_invalid_path", `${field} must not be empty.`);
  return result;
}

function requiredTitle(value: string): string {
  const result = required(value, "title");
  if (result.length > 160) throw new ManagedContentError("managed_content_invalid_path", "Managed root titles are limited to 160 characters.");
  return result;
}

function requiredEntryName(value: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 255 || result === "." || result === ".." || /[\\/:*?"<>|]/u.test(result)) {
    throw new ManagedContentError("managed_content_invalid_path", "Managed entry name is invalid.");
  }
  return result;
}

function normalizeEntryPath(value: string): string {
  try {
    const result = normalizeRelativePath(value);
    if (result.length === 0) throw new Error("empty");
    return result;
  } catch {
    throw new ManagedContentError("managed_content_invalid_path", "Managed entry path is invalid.");
  }
}

function entryPath(parent: string, name: string): string {
  try { return joinRelativePath(parent, requiredEntryName(name)); }
  catch { throw new ManagedContentError("managed_content_invalid_path", "Managed entry path is invalid."); }
}

function assertTextSize(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MANAGED_CONTENT_MAX_TEXT_BYTES) {
    throw new ManagedContentError("managed_content_not_text", "Managed text exceeds the 512 KiB limit.");
  }
}
