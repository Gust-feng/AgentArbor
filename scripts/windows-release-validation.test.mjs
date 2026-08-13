import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPackage } from "@electron/asar";
import {
  resolveReleaseTag,
  validateWindowsInitialWorkbenchAssets,
  validateWindowsReleaseArtifacts,
} from "./windows-release-validation.mjs";

test("release tag must match the package version from every supplied source", () => {
  assert.equal(resolveReleaseTag({
    version: "0.1.4",
    argumentTag: "v0.1.4",
    environmentTag: "v0.1.4",
  }), "v0.1.4");
  assert.throws(
    () => resolveReleaseTag({ version: "0.1.4", argumentTag: "v0.1.5" }),
    /does not match package\.json version/,
  );
  assert.throws(
    () => resolveReleaseTag({
      version: "0.1.4",
      argumentTag: "v0.1.4",
      environmentTag: "v0.1.5",
    }),
    /sources disagree/,
  );
});

test("release artifacts must identify one installer in latest.yml", () => {
  const root = mkdtempSync(join(os.tmpdir(), "agentarbor-release-gate-"));
  const version = "0.1.4";
  const installerName = `AgentArbor-Setup-${version}-x64.exe`;
  const installerContent = "installer";
  const installerSha512 = createHash("sha512").update(installerContent).digest("base64");
  try {
    writeFileSync(join(root, installerName), installerContent);
    writeFileSync(join(root, `${installerName}.blockmap`), "blockmap");
    writeFileSync(join(root, "latest.yml"), [
      `version: ${version}`,
      "files:",
      `  - url: ${installerName}`,
      `    sha512: ${installerSha512}`,
      `    size: ${Buffer.byteLength(installerContent)}`,
      `path: ${installerName}`,
      `sha512: ${installerSha512}`,
    ].join("\n"));

    const artifacts = validateWindowsReleaseArtifacts({ releaseDirectory: root, version });
    assert.equal(artifacts.installerName, installerName);
    assert.equal(artifacts.blockmapName, `${installerName}.blockmap`);

    writeFileSync(join(root, "latest.yml"), "version: 0.1.5\n");
    assert.throws(
      () => validateWindowsReleaseArtifacts({ releaseDirectory: root, version }),
      /latest\.yml version does not match/,
    );

    writeFileSync(join(root, "latest.yml"), [
      `version: ${version}`,
      "files:",
      `  - url: ${installerName}`,
      "    sha512: invalid",
      `    size: ${Buffer.byteLength(installerContent)}`,
      `path: ${installerName}`,
      "sha512: invalid",
    ].join("\n"));
    assert.throws(
      () => validateWindowsReleaseArtifacts({ releaseDirectory: root, version }),
      /latest\.yml sha512 does not match/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packaged asar must carry every initial Workbench asset byte-for-byte", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "agentarbor-release-gate-assets-"));
  try {
    const sourceAssetDirectory = join(root, "source-assets");
    mkdirSync(join(sourceAssetDirectory, "nested"), { recursive: true });
    writeFileSync(join(sourceAssetDirectory, "笔记.md"), "# 内置笔记");
    writeFileSync(join(sourceAssetDirectory, "nested", "图.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const appRoot = join(root, "app");
    const packedAssetRoot = join(appRoot, "dist", "app", "panel-server", "initial-workbench-assets");
    mkdirSync(join(packedAssetRoot, "nested"), { recursive: true });
    writeFileSync(join(packedAssetRoot, "笔记.md"), "# 内置笔记");
    writeFileSync(join(packedAssetRoot, "nested", "图.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const resourcesDirectory = join(root, "release", "win-unpacked", "resources");
    mkdirSync(resourcesDirectory, { recursive: true });
    await createPackage(appRoot, join(resourcesDirectory, "app.asar"));

    const result = validateWindowsInitialWorkbenchAssets({
      releaseDirectory: join(root, "release"),
      sourceAssetDirectory,
    });
    assert.equal(result.verifiedAssetCount, 2);

    // 源资产新增文件而包里没有：必须失败。
    writeFileSync(join(sourceAssetDirectory, "新增.md"), "后来加的");
    assert.throws(
      () => validateWindowsInitialWorkbenchAssets({ releaseDirectory: join(root, "release"), sourceAssetDirectory }),
      /missing initial Workbench asset 新增\.md/u,
    );
    rmSync(join(sourceAssetDirectory, "新增.md"));

    // 包内字节与源不一致（陈旧 dist）：必须失败。
    writeFileSync(join(packedAssetRoot, "笔记.md"), "# 改过的旧内容");
    await createPackage(appRoot, join(resourcesDirectory, "app.asar"));
    assert.throws(
      () => validateWindowsInitialWorkbenchAssets({ releaseDirectory: join(root, "release"), sourceAssetDirectory }),
      /笔记\.md differs from its source/u,
    );

    // 没有打包产物或源资产为空：必须失败。
    assert.throws(
      () => validateWindowsInitialWorkbenchAssets({ releaseDirectory: join(root, "missing"), sourceAssetDirectory }),
      /Missing packaged application archive/u,
    );
    assert.throws(
      () => validateWindowsInitialWorkbenchAssets({
        releaseDirectory: join(root, "release"),
        sourceAssetDirectory: join(root, "empty-assets"),
      }),
      /has no files/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release artifact gate rejects missing and ambiguous versioned installers", () => {
  const root = mkdtempSync(join(os.tmpdir(), "agentarbor-release-gate-count-"));
  const version = "0.1.4";
  try {
    assert.throws(
      () => validateWindowsReleaseArtifacts({ releaseDirectory: root, version }),
      /Expected exactly one Windows x64 installer.*found none/,
    );

    writeFileSync(join(root, `AgentArbor-Setup-${version}-arm64.exe`), "installer");
    assert.throws(
      () => validateWindowsReleaseArtifacts({ releaseDirectory: root, version }),
      /Expected exactly one Windows x64 installer.*arm64/,
    );

    writeFileSync(join(root, `AgentArbor-Setup-${version}-x64.exe`), "installer");
    assert.throws(
      () => validateWindowsReleaseArtifacts({ releaseDirectory: root, version }),
      /Expected exactly one Windows x64 installer.*arm64.*x64/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
