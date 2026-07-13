import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Resolve and validate the release tag before any GitHub release side effect.
 * The package version is the only supported release identity.
 */
export function resolveReleaseTag({ version, argumentTag, environmentTag }) {
  const expectedTag = `v${String(version)}`;
  const suppliedArgument = argumentTag === undefined ? undefined : String(argumentTag);
  const suppliedEnvironment = environmentTag === undefined ? undefined : String(environmentTag);

  if (suppliedArgument !== undefined && suppliedEnvironment !== undefined && suppliedArgument !== suppliedEnvironment) {
    throw new Error(
      `Release tag sources disagree: argument=${suppliedArgument}, GITHUB_REF_NAME=${suppliedEnvironment}.`,
    );
  }

  const tag = suppliedArgument ?? suppliedEnvironment ?? expectedTag;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match package.json version; expected ${expectedTag}.`);
  }
  return tag;
}

/**
 * Locate one versioned installer and its blockmap, then verify that
 * electron-builder's update manifest points to the same versioned installer.
 */
export function validateWindowsReleaseArtifacts({ releaseDirectory, version }) {
  const packageVersion = String(version);
  const entries = readdirSync(releaseDirectory);
  const installerPrefix = `AgentArbor-Setup-${packageVersion}-`;
  const expectedInstallerName = `${installerPrefix}x64.exe`;
  const installers = entries.filter((entry) =>
    entry.startsWith(installerPrefix) && entry.endsWith(".exe"),
  );

  if (installers.length !== 1 || installers[0] !== expectedInstallerName) {
    throw new Error(
      `Expected exactly one Windows x64 installer named ${expectedInstallerName}; found ${installers.join(", ") || "none"}.`,
    );
  }

  const installerName = installers[0];
  const installerPath = join(releaseDirectory, installerName);
  const blockmapName = `${installerName}.blockmap`;
  const blockmapPath = join(releaseDirectory, blockmapName);
  if (!entries.includes(blockmapName)) {
    throw new Error(`Missing blockmap for Windows installer ${installerName}.`);
  }

  const latestPath = join(releaseDirectory, "latest.yml");
  if (!existsSync(latestPath)) {
    throw new Error("Missing release/update manifest latest.yml.");
  }

  let manifest;
  try {
    manifest = parseYaml(readFileSync(latestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to parse release/update manifest latest.yml: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    );
  }

  if (!isRecord(manifest) || manifest.version !== packageVersion) {
    throw new Error(
      `latest.yml version does not match package.json version ${packageVersion}.`,
    );
  }

  if (releaseReferenceName(manifest.path) !== installerName) {
    throw new Error(`latest.yml path does not reference ${installerName}.`);
  }

  const installerFile = Array.isArray(manifest.files)
    ? manifest.files.find((file) => isRecord(file) && releaseReferenceName(file.url) === installerName)
    : undefined;
  if (!isRecord(installerFile)) {
    throw new Error(`latest.yml files do not reference ${installerName}.`);
  }

  const installerBytes = readFileSync(installerPath);
  const installerSize = statSync(installerPath).size;
  const installerSha512 = createHash("sha512").update(installerBytes).digest("base64");
  if (installerFile.size !== installerSize) {
    throw new Error(`latest.yml size does not match ${installerName}.`);
  }
  if (installerFile.sha512 !== installerSha512 || manifest.sha512 !== installerSha512) {
    throw new Error(`latest.yml sha512 does not match ${installerName}.`);
  }

  return { installerPath, blockmapPath, latestPath, installerName, blockmapName };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function releaseReferenceName(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.replaceAll("\\", "/").split("#", 1)[0].split("?", 1)[0];
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
