import { readFileSync } from "node:fs";

let cachedAgentArborPackageVersion: string | undefined;

export function readAgentArborPackageVersion(): string {
  if (cachedAgentArborPackageVersion !== undefined) {
    return cachedAgentArborPackageVersion;
  }
  try {
    const parsed = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
      readonly version?: unknown;
    };
    cachedAgentArborPackageVersion =
      typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : "unknown";
  } catch {
    cachedAgentArborPackageVersion = "unknown";
  }
  return cachedAgentArborPackageVersion;
}
