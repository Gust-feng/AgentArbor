import { existsSync, promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(repoRoot, "scripts", "initial-pytorch-note.html");
const outputPath = path.join(repoRoot, "src", "app", "panel-server", "initial-workbench-assets", "PyTorch 入门笔记.pdf");

const chromePath = process.env.CHROME_PATH
  ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((candidate) => {
    return existsSync(candidate);
  });
if (chromePath === undefined) throw new Error("找不到 Chromium，请设置 CHROME_PATH。");

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agentarbor-pytorch-pdf-"));
const temporaryPdf = path.join(temporaryDirectory, "pytorch-note.pdf");
try {
  await run(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${path.join(temporaryDirectory, "profile")}`,
    `--print-to-pdf=${temporaryPdf}`,
    "--no-pdf-header-footer",
    pathToFileURL(htmlPath).href,
  ]);
  await fs.copyFile(temporaryPdf, outputPath);
  const stat = await fs.stat(outputPath);
  console.log(`generated ${outputPath} (${stat.size} bytes)`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Chromium exited with code ${code}`)));
  });
}
