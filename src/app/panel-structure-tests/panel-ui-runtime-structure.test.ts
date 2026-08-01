import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Panel UI source cannot restore legacy Ordinary run observation paths", async () => {
  const files = await listPanelUiSourceFiles();
  const forbidden = [
    "/api/desktop/runs/",
    "/work-session",
    "safeWorkSession",
    "safeDesktopDetail",
    ".workSession",
    "workSession:",
  ];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const term of forbidden) {
      assert.equal(
        source.includes(term),
        false,
        `${path.relative(process.cwd(), file)} must not use legacy Ordinary run observation term ${term}`,
      );
    }
  }
});

async function listPanelUiSourceFiles(): Promise<readonly string[]> {
  const root = path.join(process.cwd(), "src", "app", "panel-ui", "src");
  const files: string[] = [];
  await collectSourceFiles(root, files);
  return files;
}

async function collectSourceFiles(directory: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, files);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }));
}
