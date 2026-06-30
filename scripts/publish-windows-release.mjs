import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = String(packageJson.version);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? `v${version}`;
const releaseDirectory = join(process.cwd(), "release");
const assets = [
  findReleaseAsset((name) => /^AgentArbor-Setup-.+\.exe$/.test(name)),
  findReleaseAsset((name) => /^AgentArbor-Setup-.+\.exe\.blockmap$/.test(name)),
  join(releaseDirectory, "latest.yml"),
];
const target = process.env.GITHUB_SHA ?? readGitHead();

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
    `AgentArbor ${tag}`,
    "--target",
    target,
  ]);
}

function findReleaseAsset(predicate) {
  const entry = readdirSync(releaseDirectory).find(predicate);
  if (entry === undefined) {
    throw new Error("Missing Windows desktop release assets.");
  }
  return join(releaseDirectory, entry);
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
