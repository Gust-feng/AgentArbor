import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installSkillPackage,
  rollbackSkillPackageInstall,
} from "./skill-installer.js";

test("installSkillPackage installs a valid local skill package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-install-"));
  try {
    const source = path.join(root, "source", "writer");
    const targetRoot = path.join(root, "target");
    await writeSkillPackage(source, {
      name: "writer",
      description: "Writes concise drafts when a writing task needs a reusable skill.",
      body: "Writer body.",
      extraFiles: [["references/guide.md", "Guide body."]],
    });

    const result = await installSkillPackage({
      sourcePackagePath: source,
      targetRootPath: targetRoot,
    });

    assert.equal(result.status, "installed");
    assert.equal(result.skillName, "writer");
    assert.equal(result.version, undefined);
    assert.equal(result.backupPath, undefined);
    assert.match(result.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.match(result.bodyHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.match(result.metadataHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(result.issues, []);
    assert.equal(await readText(path.join(targetRoot, "writer", "SKILL.md")), await readText(path.join(source, "SKILL.md")));
    assert.equal(await readText(path.join(targetRoot, "writer", "references", "guide.md")), "Guide body.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage rejects source directory and name mismatch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-mismatch-"));
  try {
    const source = path.join(root, "source", "actual-name");
    await writeSkillPackage(source, {
      name: "other-name",
      description: "Invalid because the frontmatter name does not match the package directory.",
      body: "Body.",
    });

    const result = await installSkillPackage({
      sourcePackagePath: source,
      targetRootPath: path.join(root, "target"),
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.skillName, "other-name");
    assert.equal(result.issues.some((issue) => issue.code === "name_directory_mismatch"), true);
    assert.equal(await pathExists(path.join(root, "target", "other-name")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage rejects invalid skill names, unsafe package paths, and missing SKILL.md", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-unsafe-"));
  try {
    const targetRoot = path.join(root, "target");
    const invalidNameSource = path.join(root, "source", "Bad_Name");
    await writeSkillPackage(invalidNameSource, {
      name: "Bad_Name",
      description: "Invalid because skill names must be lowercase package identifiers.",
      body: "Body.",
    });
    const invalidName = await installSkillPackage({
      sourcePackagePath: invalidNameSource,
      targetRootPath: targetRoot,
    });
    const unsafe = await installSkillPackage({
      sourcePackagePath: "\0",
      targetRootPath: targetRoot,
    });
    const missingSkill = await installSkillPackage({
      sourcePackagePath: path.join(root, "missing-skill"),
      targetRootPath: targetRoot,
    });

    assert.equal(invalidName.status, "blocked");
    assert.equal(invalidName.issues.some((issue) => issue.code === "invalid_name"), true);
    assert.equal(await pathExists(path.join(targetRoot, "Bad_Name")), false);
    assert.equal(unsafe.status, "blocked");
    assert.equal(unsafe.issues[0]?.code, "unsafe_path");
    assert.equal(missingSkill.status, "blocked");
    assert.equal(missingSkill.issues[0]?.code, "source_not_found");

    const sourceWithoutSkill = path.join(root, "source", "no-skill");
    await fs.mkdir(sourceWithoutSkill, { recursive: true });
    const noSkill = await installSkillPackage({
      sourcePackagePath: sourceWithoutSkill,
      targetRootPath: targetRoot,
    });
    assert.equal(noSkill.status, "blocked");
    assert.equal(noSkill.issues[0]?.code, "missing_skill_md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage rejects overwrite without explicit flag", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-overwrite-"));
  try {
    const source = path.join(root, "source", "reviewer");
    const targetRoot = path.join(root, "target");
    await writeSkillPackage(source, {
      name: "reviewer",
      description: "Reviews code when a local skill should be installed.",
      body: "Reviewer body v1.",
    });

    const first = await installSkillPackage({ sourcePackagePath: source, targetRootPath: targetRoot });
    const second = await installSkillPackage({ sourcePackagePath: source, targetRootPath: targetRoot });

    assert.equal(first.status, "installed");
    assert.equal(second.status, "blocked");
    assert.equal(second.issues[0]?.code, "target_exists");
    assert.equal(await readText(path.join(targetRoot, "reviewer", "SKILL.md")), await readText(path.join(source, "SKILL.md")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage reports target root preparation failures as blocked results", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-target-root-"));
  try {
    const source = path.join(root, "source", "blocked-target");
    const targetRoot = path.join(root, "target-file");
    await writeSkillPackage(source, {
      name: "blocked-target",
      description: "Reports target root failures without throwing.",
      body: "Body.",
    });
    await fs.writeFile(targetRoot, "not a directory", "utf8");

    const result = await installSkillPackage({
      sourcePackagePath: source,
      targetRootPath: targetRoot,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.issues[0]?.code, "target_root_not_directory");
    assert.equal(await readText(targetRoot), "not a directory");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage replace creates backup and rollback restores old package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-rollback-"));
  try {
    const targetRoot = path.join(root, "target");
    const oldSource = path.join(root, "old", "auditor");
    const newSource = path.join(root, "new", "auditor");
    await writeSkillPackage(oldSource, {
      name: "auditor",
      description: "Audits existing changes with the old package.",
      body: "Old body.",
      extraFiles: [["references/state.txt", "old reference"]],
    });
    await writeSkillPackage(newSource, {
      name: "auditor",
      description: "Audits existing changes with the new package.",
      version: "2.0.0",
      provenance: ["registry: local", "revision: 2"],
      body: "New body.",
      extraFiles: [["references/state.txt", "new reference"]],
    });

    const initial = await installSkillPackage({
      sourcePackagePath: oldSource,
      targetRootPath: targetRoot,
      now: new Date("2026-06-21T00:00:00.000Z"),
    });
    const replaced = await installSkillPackage({
      sourcePackagePath: newSource,
      targetRootPath: targetRoot,
      replace: true,
      now: new Date("2026-06-21T00:00:01.000Z"),
    });

    assert.equal(initial.status, "installed");
    assert.equal(replaced.status, "installed");
    assert.equal(replaced.version, "2.0.0");
    assert.deepEqual(replaced.provenance, { registry: "local", revision: 2 });
    assert.match(replaced.backupPath ?? "", /auditor-2026-06-21T00-00-01-000Z$/);
    assert.equal(await readText(path.join(targetRoot, "auditor", "references", "state.txt")), "new reference");
    assert.equal(await readText(path.join(replaced.backupPath!, "references", "state.txt")), "old reference");

    const rollback = await rollbackSkillPackageInstall(replaced);

    assert.equal(rollback.status, "rolled_back");
    assert.equal(await readText(path.join(targetRoot, "auditor", "references", "state.txt")), "old reference");
    assert.equal((await readText(path.join(targetRoot, "auditor", "SKILL.md"))).includes("Old body."), true);
    assert.equal(await pathExists(replaced.backupPath!), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rollbackSkillPackageInstall blocks when installed target changed after replace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-rollback-changed-"));
  try {
    const targetRoot = path.join(root, "target");
    const oldSource = path.join(root, "old", "auditor");
    const newSource = path.join(root, "new", "auditor");
    await writeSkillPackage(oldSource, {
      name: "auditor",
      description: "Audits existing changes with the old package.",
      body: "Old body.",
      extraFiles: [["references/state.txt", "old reference"]],
    });
    await writeSkillPackage(newSource, {
      name: "auditor",
      description: "Audits existing changes with the new package.",
      body: "New body.",
      extraFiles: [["references/state.txt", "new reference"]],
    });

    await installSkillPackage({ sourcePackagePath: oldSource, targetRootPath: targetRoot });
    const replaced = await installSkillPackage({
      sourcePackagePath: newSource,
      targetRootPath: targetRoot,
      replace: true,
    });
    await fs.writeFile(path.join(targetRoot, "auditor", "references", "state.txt"), "external edit", "utf8");

    const rollback = await rollbackSkillPackageInstall(replaced);

    assert.equal(rollback.status, "blocked");
    assert.equal(rollback.issues[0]?.code, "target_changed");
    assert.equal(await readText(path.join(targetRoot, "auditor", "references", "state.txt")), "external edit");
    assert.equal(await pathExists(replaced.backupPath!), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installSkillPackage rejects symlinks in source package when platform supports them", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentarbor-skill-symlink-"));
  try {
    const source = path.join(root, "source", "linked");
    await writeSkillPackage(source, {
      name: "linked",
      description: "Rejects source packages that contain symlinks.",
      body: "Body.",
    });
    const outside = path.join(root, "outside.txt");
    const link = path.join(source, "references-link.md");
    await fs.writeFile(outside, "outside", "utf8");
    try {
      await fs.symlink(outside, link);
    } catch {
      t.skip("This platform or filesystem does not allow creating symlinks.");
      return;
    }

    const result = await installSkillPackage({
      sourcePackagePath: source,
      targetRootPath: path.join(root, "target"),
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.issues[0]?.code, "symlink_rejected");
    assert.equal(result.issues[0]?.path, link);
    assert.equal(await pathExists(path.join(root, "target", "linked")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function writeSkillPackage(inputPath: string, input: {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly provenance?: readonly string[];
  readonly body: string;
  readonly extraFiles?: readonly (readonly [string, string])[];
}): Promise<void> {
  await fs.mkdir(inputPath, { recursive: true });
  const lines = [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
  ];
  if (input.version !== undefined) {
    lines.push(`version: ${input.version}`);
  }
  if (input.provenance !== undefined) {
    lines.push("provenance:");
    lines.push(...input.provenance.map((line) => `  ${line}`));
  }
  lines.push("---", "", input.body);
  await fs.writeFile(path.join(inputPath, "SKILL.md"), lines.join("\n"), "utf8");
  for (const [relativePath, content] of input.extraFiles ?? []) {
    const filePath = path.join(inputPath, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

async function readText(inputPath: string): Promise<string> {
  return fs.readFile(inputPath, "utf8");
}

async function pathExists(inputPath: string): Promise<boolean> {
  return fs.stat(inputPath).then(
    () => true,
    () => false
  );
}
