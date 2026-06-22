import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  normalizeSkillFrontmatter,
  parseSkillMarkdown,
  validateSkillFrontmatter,
  validateSkillOptionalFrontmatter,
  type SkillJsonValue,
  type SkillValidationIssue,
} from "./skill-validation.js";

export type SkillPackageOperationStatus = "installed" | "rolled_back" | "blocked";

export type InstallSkillPackageOptions = {
  readonly sourcePackagePath: string;
  readonly targetRootPath: string;
  readonly replace?: boolean;
  readonly overwrite?: boolean;
  readonly now?: Date;
};

export type SkillPackageInstallResult = {
  readonly status: "installed" | "blocked";
  readonly skillName: string | undefined;
  readonly version?: string;
  readonly provenance?: Readonly<Record<string, SkillJsonValue>>;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly contentHash: string | undefined;
  readonly bodyHash: string | undefined;
  readonly metadataHash: string | undefined;
  readonly issues: readonly SkillValidationIssue[];
};

export type SkillPackageRollbackResult = {
  readonly status: "rolled_back" | "blocked";
  readonly skillName: string | undefined;
  readonly version?: string;
  readonly provenance?: Readonly<Record<string, SkillJsonValue>>;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly contentHash: string | undefined;
  readonly bodyHash: string | undefined;
  readonly metadataHash: string | undefined;
  readonly issues: readonly SkillValidationIssue[];
};

type SafePathResult =
  | { readonly ok: true; readonly resolvedPath: string }
  | { readonly ok: false; readonly issue: SkillValidationIssue; readonly displayPath: string };

type SourcePackageFacts = {
  readonly skillName: string | undefined;
  readonly version?: string;
  readonly provenance?: Readonly<Record<string, SkillJsonValue>>;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly contentHash: string | undefined;
  readonly bodyHash: string | undefined;
  readonly metadataHash: string | undefined;
  readonly issues: readonly SkillValidationIssue[];
};

class SkillInstallerIssueError extends Error {
  constructor(readonly issue: SkillValidationIssue) {
    super(issue.message);
  }
}

export async function installSkillPackage(options: InstallSkillPackageOptions): Promise<SkillPackageInstallResult> {
  const sourceResolution = resolveSafePath(options.sourcePackagePath, "sourcePackagePath");
  const targetRootResolution = resolveSafePath(options.targetRootPath, "targetRootPath");
  if (!sourceResolution.ok || !targetRootResolution.ok) {
    const sourcePath = sourceResolution.ok ? sourceResolution.resolvedPath : sourceResolution.displayPath;
    const targetPath = targetRootResolution.ok ? targetRootResolution.resolvedPath : targetRootResolution.displayPath;
    return blockedInstallResult({
      sourcePath,
      targetPath,
      issues: [
        ...(sourceResolution.ok ? [] : [sourceResolution.issue]),
        ...(targetRootResolution.ok ? [] : [targetRootResolution.issue]),
      ],
    });
  }

  const sourcePath = sourceResolution.resolvedPath;
  const targetRootPath = targetRootResolution.resolvedPath;
  const sourceFacts = await readSourcePackageFacts(sourcePath, targetRootPath);
  if (sourceFacts.issues.length > 0) {
    return blockedInstallResult(sourceFacts);
  }

  const relationIssue = installPathRelationIssue(sourceFacts.sourcePath, sourceFacts.targetPath);
  if (relationIssue !== undefined) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [relationIssue],
    });
  }

  let sourceSymlinkPath: string | undefined;
  try {
    sourceSymlinkPath = await findFirstSymlink(sourceFacts.sourcePath);
  } catch (error) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [issueFromError(error, "source_scan_failed", "Skill source package scan failed.")],
    });
  }
  if (sourceSymlinkPath !== undefined) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [symlinkIssue(sourceSymlinkPath)],
    });
  }

  let targetRootIssue: SkillValidationIssue | undefined;
  try {
    targetRootIssue = await ensureDirectoryPath(targetRootPath, "target_root");
  } catch (error) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [issueFromError(error, "target_root_create_failed", "Skill target root preparation failed.")],
    });
  }
  if (targetRootIssue !== undefined) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [targetRootIssue],
    });
  }

  const targetStats = await lstatOptional(sourceFacts.targetPath);
  if (targetStats?.isSymbolicLink()) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [symlinkIssue(sourceFacts.targetPath)],
    });
  }
  if (targetStats !== undefined && !targetStats.isDirectory()) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [{
        code: "target_not_directory",
        path: sourceFacts.targetPath,
        message: "Existing skill target must be a directory.",
      }],
    });
  }

  const shouldReplace = options.replace === true || options.overwrite === true;
  if (targetStats !== undefined && !shouldReplace) {
    return blockedInstallResult({
      ...sourceFacts,
      issues: [{
        code: "target_exists",
        path: sourceFacts.targetPath,
        message: "Skill target already exists; pass replace or overwrite to install over it.",
      }],
    });
  }

  const tempPath = await fs.mkdtemp(path.join(targetRootPath, `.agentarbor-skill-install-${sourceFacts.skillName ?? "skill"}-`));
  let backupPath: string | undefined;
  try {
    await copyDirectoryWithoutSymlinks(sourceFacts.sourcePath, tempPath);
    if (targetStats !== undefined) {
      const backupRootPath = path.join(targetRootPath, ".agentarbor-skill-backups");
      const backupRootIssue = await ensureDirectoryPath(backupRootPath, "backup_root");
      if (backupRootIssue !== undefined) {
        throw new SkillInstallerIssueError(backupRootIssue);
      }
      backupPath = await nextAvailableBackupPath(
        backupRootPath,
        sourceFacts.skillName ?? path.basename(sourceFacts.targetPath),
        options.now ?? new Date()
      );
      await fs.rename(sourceFacts.targetPath, backupPath);
    }
    await fs.rename(tempPath, sourceFacts.targetPath);
    return {
      status: "installed",
      skillName: sourceFacts.skillName,
      version: sourceFacts.version,
      provenance: sourceFacts.provenance,
      sourcePath: sourceFacts.sourcePath,
      targetPath: sourceFacts.targetPath,
      backupPath,
      contentHash: sourceFacts.contentHash,
      bodyHash: sourceFacts.bodyHash,
      metadataHash: sourceFacts.metadataHash,
      issues: [],
    };
  } catch (error) {
    await rmIfExists(tempPath);
    if (backupPath !== undefined && await pathExists(backupPath) && !await pathExists(sourceFacts.targetPath)) {
      await fs.rename(backupPath, sourceFacts.targetPath).catch(() => undefined);
    }
    return blockedInstallResult({
      ...sourceFacts,
      backupPath,
      issues: [issueFromError(error, "install_failed", "Skill package installation failed.")],
    });
  }
}

export async function rollbackSkillPackageInstall(
  result: SkillPackageInstallResult
): Promise<SkillPackageRollbackResult> {
  if (result.status !== "installed" || result.backupPath === undefined) {
    return blockedRollbackResult(result, [{
      code: "rollback_rejected",
      message: "Rollback requires a successful install result with backupPath.",
    }]);
  }

  const targetResolution = resolveSafePath(result.targetPath, "targetPath");
  const backupResolution = resolveSafePath(result.backupPath, "backupPath");
  const sourceResolution = resolveSafePath(result.sourcePath, "sourcePath");
  if (!targetResolution.ok || !backupResolution.ok || !sourceResolution.ok) {
    return blockedRollbackResult(result, [
      ...(targetResolution.ok ? [] : [targetResolution.issue]),
      ...(backupResolution.ok ? [] : [backupResolution.issue]),
      ...(sourceResolution.ok ? [] : [sourceResolution.issue]),
    ]);
  }

  const targetPath = targetResolution.resolvedPath;
  const backupPath = backupResolution.resolvedPath;
  const sourcePath = sourceResolution.resolvedPath;
  const targetRootPath = path.dirname(targetPath);
  const backupRootPath = path.join(targetRootPath, ".agentarbor-skill-backups");
  if (!isSubpathOrEqual(backupPath, backupRootPath) || path.basename(targetPath) !== result.skillName) {
    return blockedRollbackResult(result, [{
      code: "unsafe_rollback_path",
      path: backupPath,
      message: "Rollback backupPath must stay inside the target root backup directory for the installed skill.",
    }]);
  }

  const backupStats = await lstatOptional(backupPath);
  if (backupStats === undefined) {
    return blockedRollbackResult(result, [{
      code: "backup_missing",
      path: backupPath,
      message: "Rollback backupPath does not exist.",
    }]);
  }
  if (backupStats.isSymbolicLink() || !backupStats.isDirectory()) {
    return blockedRollbackResult(result, [{
      code: backupStats.isSymbolicLink() ? "symlink_rejected" : "backup_not_directory",
      path: backupPath,
      message: "Rollback backupPath must be a real directory.",
    }]);
  }

  const targetStats = await lstatOptional(targetPath);
  if (targetStats?.isSymbolicLink()) {
    return blockedRollbackResult(result, [symlinkIssue(targetPath)]);
  }
  if (targetStats !== undefined && !targetStats.isDirectory()) {
    return blockedRollbackResult(result, [{
      code: "target_not_directory",
      path: targetPath,
      message: "Rollback targetPath must be a directory when it exists.",
    }]);
  }
  if (targetStats !== undefined) {
    const installedTargetMatches = await directoriesEquivalentWithoutSymlinks(sourcePath, targetPath).catch(() => false);
    if (!installedTargetMatches) {
      return blockedRollbackResult(result, [{
        code: "target_changed",
        path: targetPath,
        message: "Rollback target no longer matches the installed source package; refusing to remove unrelated files.",
      }]);
    }
    const currentHashes = await readSkillHashes(targetPath);
    if (
      currentHashes === undefined ||
      currentHashes.contentHash !== result.contentHash ||
      currentHashes.bodyHash !== result.bodyHash ||
      currentHashes.metadataHash !== result.metadataHash
    ) {
      return blockedRollbackResult(result, [{
        code: "target_changed",
        path: targetPath,
        message: "Rollback target has changed since install; refusing to remove unrelated files.",
      }]);
    }
  }

  const rollbackTempPath = targetStats === undefined
    ? undefined
    : await fs.mkdtemp(path.join(targetRootPath, `.agentarbor-skill-rollback-${result.skillName ?? "skill"}-`));
  try {
    if (rollbackTempPath !== undefined) {
      await fs.rmdir(rollbackTempPath);
      await fs.rename(targetPath, rollbackTempPath);
    }
    await fs.rename(backupPath, targetPath);
    if (rollbackTempPath !== undefined) {
      await rmIfExists(rollbackTempPath);
    }
    return {
      status: "rolled_back",
      skillName: result.skillName,
      version: result.version,
      provenance: result.provenance,
      sourcePath: result.sourcePath,
      targetPath,
      backupPath,
      contentHash: result.contentHash,
      bodyHash: result.bodyHash,
      metadataHash: result.metadataHash,
      issues: [],
    };
  } catch (error) {
    if (rollbackTempPath !== undefined && await pathExists(rollbackTempPath) && !await pathExists(targetPath)) {
      await fs.rename(rollbackTempPath, targetPath).catch(() => undefined);
    }
    return blockedRollbackResult(result, [
      issueFromError(error, "rollback_failed", "Skill package rollback failed."),
    ]);
  }
}

async function readSourcePackageFacts(sourcePath: string, targetRootPath: string): Promise<SourcePackageFacts> {
  const packageName = path.basename(sourcePath);
  const baseFacts = {
    skillName: packageName.length > 0 ? packageName : undefined,
    sourcePath,
    targetPath: path.join(targetRootPath, packageName),
    contentHash: undefined,
    bodyHash: undefined,
    metadataHash: undefined,
  };
  if (packageName.length === 0) {
    return {
      ...baseFacts,
      issues: [{
        code: "unsafe_path",
        path: sourcePath,
        message: "sourcePackagePath must point to a package directory.",
      }],
    };
  }

  const sourceStats = await lstatOptional(sourcePath);
  if (sourceStats === undefined) {
    return {
      ...baseFacts,
      issues: [{
        code: "source_not_found",
        path: sourcePath,
        message: "Skill source package does not exist.",
      }],
    };
  }
  if (sourceStats.isSymbolicLink()) {
    return {
      ...baseFacts,
      issues: [symlinkIssue(sourcePath)],
    };
  }
  if (!sourceStats.isDirectory()) {
    return {
      ...baseFacts,
      issues: [{
        code: "source_not_directory",
        path: sourcePath,
        message: "Skill source package must be a directory.",
      }],
    };
  }

  const skillPath = path.join(sourcePath, "SKILL.md");
  const skillStats = await lstatOptional(skillPath);
  if (skillStats === undefined) {
    return {
      ...baseFacts,
      issues: [{
        code: "missing_skill_md",
        path: skillPath,
        message: "Skill source package must contain SKILL.md.",
      }],
    };
  }
  if (skillStats.isSymbolicLink()) {
    return {
      ...baseFacts,
      issues: [symlinkIssue(skillPath)],
    };
  }
  if (!skillStats.isFile()) {
    return {
      ...baseFacts,
      issues: [{
        code: "skill_md_not_file",
        path: skillPath,
        message: "SKILL.md must be a regular file.",
      }],
    };
  }

  const raw: string | Error = await fs.readFile(skillPath, "utf8").catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  );
  if (raw instanceof Error) {
    return {
      ...baseFacts,
      issues: [{
        code: "skill_read_failed",
        path: skillPath,
        message: `Failed to read SKILL.md: ${errorMessage(raw)}`,
      }],
    };
  }

  const parsed = parseSkillMarkdown(raw);
  const frontmatter = normalizeSkillFrontmatter(parsed.frontmatter);
  const skillName = frontmatter.name ?? packageName;
  const issues = [
    ...validateSkillFrontmatter({ packageName, frontmatter }),
    ...validateSkillOptionalFrontmatter(parsed.frontmatter),
  ];
  return {
    skillName,
    version: frontmatter.version,
    provenance: frontmatter.provenance,
    sourcePath,
    targetPath: path.join(targetRootPath, skillName),
    contentHash: parsed.contentHash,
    bodyHash: parsed.bodyHash,
    metadataHash: parsed.metadataHash,
    issues,
  };
}

async function copyDirectoryWithoutSymlinks(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStats = await fs.lstat(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    throw new SkillInstallerIssueError(symlinkIssue(sourcePath));
  }
  if (!sourceStats.isDirectory()) {
    throw new SkillInstallerIssueError({
      code: "source_not_directory",
      path: sourcePath,
      message: "Skill source package must be a directory.",
    });
  }
  await fs.mkdir(targetPath, { recursive: true, mode: sourceStats.mode });
  const entries = await fs.readdir(sourcePath);
  for (const entry of entries) {
    const sourceChildPath = path.join(sourcePath, entry);
    const targetChildPath = path.join(targetPath, entry);
    const childStats = await fs.lstat(sourceChildPath);
    if (childStats.isSymbolicLink()) {
      throw new SkillInstallerIssueError(symlinkIssue(sourceChildPath));
    }
    if (childStats.isDirectory()) {
      await copyDirectoryWithoutSymlinks(sourceChildPath, targetChildPath);
      continue;
    }
    if (!childStats.isFile()) {
      throw new SkillInstallerIssueError({
        code: "unsupported_source_entry",
        path: sourceChildPath,
        message: "Skill source package may only contain regular files and directories.",
      });
    }
    await fs.copyFile(sourceChildPath, targetChildPath);
    await fs.chmod(targetChildPath, childStats.mode).catch(() => undefined);
  }
}

async function findFirstSymlink(rootPath: string): Promise<string | undefined> {
  const stats = await fs.lstat(rootPath);
  if (stats.isSymbolicLink()) {
    return rootPath;
  }
  if (!stats.isDirectory()) {
    return undefined;
  }
  const entries = await fs.readdir(rootPath);
  for (const entry of entries) {
    const childPath = path.join(rootPath, entry);
    const symlinkPath = await findFirstSymlink(childPath);
    if (symlinkPath !== undefined) {
      return symlinkPath;
    }
  }
  return undefined;
}

async function readSkillHashes(skillPackagePath: string): Promise<{
  readonly contentHash: string;
  readonly bodyHash: string;
  readonly metadataHash: string;
} | undefined> {
  const skillPath = path.join(skillPackagePath, "SKILL.md");
  const stats = await lstatOptional(skillPath);
  if (stats === undefined || stats.isSymbolicLink() || !stats.isFile()) {
    return undefined;
  }
  const raw = await fs.readFile(skillPath, "utf8").catch(() => undefined);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = parseSkillMarkdown(raw);
  return {
    contentHash: parsed.contentHash,
    bodyHash: parsed.bodyHash,
    metadataHash: parsed.metadataHash,
  };
}

async function ensureDirectoryPath(directoryPath: string, label: string): Promise<SkillValidationIssue | undefined> {
  const stats = await lstatOptional(directoryPath);
  if (stats === undefined) {
    try {
      await fs.mkdir(directoryPath, { recursive: true });
    } catch (error) {
      return {
        code: `${label}_create_failed`,
        path: directoryPath,
        message: `Failed to create ${label.replace(/_/g, " ")}: ${errorMessage(error)}`,
      };
    }
    return undefined;
  }
  if (stats.isSymbolicLink()) {
    return symlinkIssue(directoryPath);
  }
  if (!stats.isDirectory()) {
    return {
      code: `${label}_not_directory`,
      path: directoryPath,
      message: `${label.replace(/_/g, " ")} must be a directory.`,
    };
  }
  return undefined;
}

async function nextAvailableBackupPath(backupRootPath: string, skillName: string, now: Date): Promise<string> {
  const basePath = path.join(backupRootPath, `${skillName}-${backupTimestamp(now)}`);
  if (!await pathExists(basePath)) {
    return basePath;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${basePath}-${index}`;
    if (!await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new SkillInstallerIssueError({
    code: "backup_path_unavailable",
    path: basePath,
    message: "Could not allocate a unique skill backup path.",
  });
}

async function directoriesEquivalentWithoutSymlinks(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStats, rightStats] = await Promise.all([fs.lstat(leftPath), fs.lstat(rightPath)]);
  if (leftStats.isSymbolicLink() || rightStats.isSymbolicLink()) {
    return false;
  }
  if (leftStats.isDirectory() || rightStats.isDirectory()) {
    if (!leftStats.isDirectory() || !rightStats.isDirectory()) {
      return false;
    }
    const [leftEntries, rightEntries] = await Promise.all([fs.readdir(leftPath), fs.readdir(rightPath)]);
    leftEntries.sort();
    rightEntries.sort();
    if (leftEntries.length !== rightEntries.length) {
      return false;
    }
    for (let index = 0; index < leftEntries.length; index += 1) {
      const leftEntry = leftEntries[index]!;
      const rightEntry = rightEntries[index]!;
      if (leftEntry !== rightEntry) {
        return false;
      }
      if (!await directoriesEquivalentWithoutSymlinks(path.join(leftPath, leftEntry), path.join(rightPath, rightEntry))) {
        return false;
      }
    }
    return true;
  }
  if (!leftStats.isFile() || !rightStats.isFile() || leftStats.size !== rightStats.size) {
    return false;
  }
  const [leftHash, rightHash] = await Promise.all([hashFile(leftPath), hashFile(rightPath)]);
  return leftHash === rightHash;
}

async function hashFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function backupTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function installPathRelationIssue(sourcePath: string, targetPath: string): SkillValidationIssue | undefined {
  if (isSubpathOrEqual(sourcePath, targetPath) || isSubpathOrEqual(targetPath, sourcePath)) {
    return {
      code: "unsafe_install_path",
      path: targetPath,
      message: "Skill source and target paths must not overlap.",
    };
  }
  return undefined;
}

function resolveSafePath(value: string, label: string): SafePathResult {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    return {
      ok: false,
      displayPath: value,
      issue: {
        code: "unsafe_path",
        path: label,
        message: `${label} must be a non-empty filesystem path without NUL bytes.`,
      },
    };
  }
  return {
    ok: true,
    resolvedPath: path.resolve(value),
  };
}

function blockedInstallResult(input: Partial<SourcePackageFacts> & {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly backupPath?: string;
  readonly issues: readonly SkillValidationIssue[];
}): SkillPackageInstallResult {
  return {
    status: "blocked",
    skillName: input.skillName,
    version: input.version,
    provenance: input.provenance,
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    backupPath: input.backupPath,
    contentHash: input.contentHash,
    bodyHash: input.bodyHash,
    metadataHash: input.metadataHash,
    issues: input.issues,
  };
}

function blockedRollbackResult(
  result: SkillPackageInstallResult,
  issues: readonly SkillValidationIssue[]
): SkillPackageRollbackResult {
  return {
    status: "blocked",
    skillName: result.skillName,
    version: result.version,
    provenance: result.provenance,
    sourcePath: result.sourcePath,
    targetPath: result.targetPath,
    backupPath: result.backupPath,
    contentHash: result.contentHash,
    bodyHash: result.bodyHash,
    metadataHash: result.metadataHash,
    issues,
  };
}

function symlinkIssue(symlinkPath: string): SkillValidationIssue {
  return {
    code: "symlink_rejected",
    path: symlinkPath,
    message: "Skill package installation refuses symlinks.",
  };
}

function issueFromError(error: unknown, code: string, fallbackMessage: string): SkillValidationIssue {
  if (error instanceof SkillInstallerIssueError) {
    return error.issue;
  }
  return {
    code,
    message: `${fallbackMessage} ${errorMessage(error)}`,
  };
}

async function lstatOptional(candidatePath: string): Promise<import("node:fs").Stats | undefined> {
  return fs.lstat(candidatePath).catch((error: unknown) => {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  });
}

async function pathExists(candidatePath: string): Promise<boolean> {
  return lstatOptional(candidatePath).then((stats) => stats !== undefined);
}

async function rmIfExists(candidatePath: string): Promise<void> {
  await fs.rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
}

function isSubpathOrEqual(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || error.name;
  }
  return String(error);
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}
