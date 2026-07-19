import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  resolveReleaseTag,
  validateWindowsReleaseArtifacts,
} from "./windows-release-validation.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = String(packageJson.version);
const tag = resolveReleaseTag({
  version,
  argumentTag: process.argv[2],
  environmentTag: process.env.GITHUB_REF_NAME,
});
const releaseDirectory = join(process.cwd(), "release");
const releaseArtifacts = validateWindowsReleaseArtifacts({ releaseDirectory, version });
const assets = [
  releaseArtifacts.installerPath,
  releaseArtifacts.blockmapPath,
  releaseArtifacts.latestPath,
];
const target = process.env.GITHUB_SHA ?? readGitHead();
const releaseNotesPath = join(process.cwd(), ".github", "release-notes", `${tag}.md`);
const releaseNotes = existsSync(releaseNotesPath)
  ? readFileSync(releaseNotesPath, "utf8").trim()
  : `AgentArbor ${tag}`;

if (runGh(["release", "view", tag], { allowFailure: true }) === 0) {
  runGh(["release", "upload", tag, ...assets, "--clobber"]);
} else {
  runGh([
    "release",
    "create",
    tag,
    ...assets,
    "--title",
    tag,
    "--notes",
    releaseNotes,
    "--generate-notes",
    "--target",
    target,
  ]);
}

function runGh(args, options = {}) {
  const result = spawnSync("gh", args, {
    stdio: options.allowFailure === true ? "ignore" : "inherit",
    env: process.env,
  });
  if (result.error !== undefined && options.allowFailure !== true) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0 && options.allowFailure !== true) {
    process.exit(result.status ?? 1);
  }
  return result.status ?? 1;
}

function readGitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return "HEAD";
  }
  return result.stdout.trim();
}
