import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  resolveReleaseTag,
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
