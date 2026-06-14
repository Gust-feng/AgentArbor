import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { modelVisibleToolDescription } from "../domain/tools/index.js";
import { createDesktopBasicToolRegistry } from "./basic-agent-runtime/index.js";

const context = { callerAgentId: "agent-test", traceId: "trace-test", goalId: "goal-test" };

test("tool capability acceptance supports a demo-building workflow without command micro-tools or hangs", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "agentarbor-tool-acceptance-"));
  const registry = createDesktopBasicToolRegistry({
    env: {},
    workspaceRoot: workspace,
    playwrightAvailable: false,
  });
  const center = registry.createToolCenter("desktop-basic");
  const toolNames = center.list().map((tool) => tool.name);
  let backgroundStopCommand: string | undefined;
  let shellBackgroundStopCommand: string | undefined;

  try {
    assert.deepEqual(toolNames, [
      "search",
      "read",
      "read_file",
      "list_dir",
      "grep_files",
      "create_file",
      "write_file",
      "edit_file",
      "delete_file",
      "shell_command",
    ]);
    assert.equal(toolNames.includes("create_directory"), false);
    assert.equal(toolNames.includes("http_request"), false);
    assert.equal(toolNames.includes("read_binary_file"), false);

    const shellDefinition = center.list().find((tool) => tool.name === "shell_command");
    assert.notEqual(shellDefinition, undefined);
    const shellSyntax = requireShellSyntax(shellDefinition!.metadata?.runtimeHints?.[0]?.syntax);
    assert.equal("background" in shellDefinition!.inputSchema.properties, true);
    assert.equal("backgroundWaitMs" in shellDefinition!.inputSchema.properties, true);
    assert.equal("cwd" in shellDefinition!.inputSchema.properties, true);
    assert.match(modelVisibleToolDescription(shellDefinition!), /background=true/);
    assert.match(modelVisibleToolDescription(shellDefinition!), /dev servers/);

    const mkdir = await executeTool("call-mkdir", "shell_command", { commandLine: platformMakeDirectoryCommand("demo") });
    assert.equal(mkdir.status, "completed");
    assert.equal((await stat(path.join(workspace, "demo"))).isDirectory(), true);

    const html = [
      "<!doctype html>",
      "<html>",
      "  <head><title>AgentArbor Demo</title></head>",
      "  <body><main id=\"app\">demo-ready</main></body>",
      "</html>",
      "",
    ].join("\n");
    const write = await executeTool("call-write", "write_file", { path: "demo/index.html", content: html });
    assert.equal(write.status, "completed");
    assert.equal(((write.output as { result?: { path?: string } }).result?.path), "demo/index.html");
    assert.equal(write.projection?.display?.kind, "file_change_summary");

    const read = await executeTool("call-read", "read_file", { path: "demo/index.html" });
    assert.equal(read.status, "completed");
    assert.match(String((read.projection?.agentContent as { content?: string }).content), /demo-ready/);

    const validate = await executeTool("call-validate", "shell_command", {
      commandLine: `${process.execPath} -e "const fs=require('fs'); console.log(fs.readFileSync('index.html','utf8').includes('demo-ready') ? 'validated' : 'missing')"`,
      command: process.execPath,
      args: ["-e", "const fs=require('fs'); console.log(fs.readFileSync('index.html','utf8').includes('demo-ready') ? 'validated' : 'missing')"],
      cwd: "demo",
    });
    assert.equal(validate.status, "completed");
    assert.equal((validate.projection?.agentContent as { cwd?: string }).cwd, "demo");
    assert.match(String((validate.projection?.agentContent as { stdout?: string }).stdout), /validated/);

    const largeOutput = await executeTool("call-large-output", "shell_command", {
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(140000));"],
    });
    const largeContent = largeOutput.projection?.agentContent as {
      readonly truncated?: boolean;
      readonly stdout?: string;
    };
    assert.equal(largeOutput.status, "completed");
    assert.equal(largeContent.truncated, true);
    assert.equal((largeContent.stdout?.length ?? 0) <= 128_000, true);

    const startedAt = Date.now();
    const timedOut = await executeTool("call-timeout", "shell_command", {
      command: process.execPath,
      args: ["-e", "console.log('before-timeout'); setTimeout(() => {}, 5000);"],
      timeoutMs: 200,
    });
    const timedOutContent = timedOut.projection?.agentContent as {
      readonly timedOut?: boolean;
      readonly exitCode?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    assert.equal(timedOut.status, "completed");
    assert.equal(timedOutContent.timedOut, true);
    assert.equal(timedOutContent.exitCode, 124);
    assert.match(timedOutContent.stdout ?? "", /before-timeout/);
    assert.match(timedOutContent.stderr ?? "", /timed out after 200ms/);
    assert.equal(Date.now() - startedAt < 4_000, true);

    const background = await executeTool("call-background", "shell_command", {
      command: process.execPath,
      args: ["-e", "console.log('server-ready'); setTimeout(() => {}, 5000);"],
      background: true,
      backgroundWaitMs: 1_000,
    });
    const backgroundContent = background.projection?.agentContent as {
      readonly background?: boolean;
      readonly pid?: number;
      readonly logPath?: string;
      readonly stopCommand?: string;
      readonly stdout?: string;
    };
    backgroundStopCommand = backgroundContent.stopCommand;
    assert.equal(background.status, "completed");
    assert.equal(backgroundContent.background, true);
    assert.equal(typeof backgroundContent.pid, "number");
    assert.equal(typeof backgroundContent.logPath, "string");
    assert.equal(typeof backgroundContent.stopCommand, "string");
    assert.match(backgroundContent.stdout ?? "", /Started background process/);
    assert.match(backgroundContent.stdout ?? "", /server-ready/);
    await waitUntil(async () => {
      try {
        return (await readFile(backgroundContent.logPath!, "utf8")).includes("server-ready");
      } catch {
        return false;
      }
    });

    const stopped = await executeTool("call-stop-background", "shell_command", {
      commandLine: backgroundStopCommand,
      timeoutMs: 2_000,
    });
    backgroundStopCommand = undefined;
    assert.equal(stopped.status, "completed");
    await delay(100);

    const shellBackground = await executeTool("call-shell-native-background", "shell_command", {
      commandLine: shellBackgroundLogCommand(shellSyntax),
      background: true,
      backgroundWaitMs: 1_000,
    });
    const shellBackgroundContent = shellBackground.projection?.agentContent as {
      readonly background?: boolean;
      readonly pid?: number;
      readonly logPath?: string;
      readonly stopCommand?: string;
      readonly stdout?: string;
    };
    shellBackgroundStopCommand = shellBackgroundContent.stopCommand;
    assert.equal(shellBackground.status, "completed");
    assert.equal(shellBackgroundContent.background, true);
    assert.equal(typeof shellBackgroundContent.pid, "number");
    assert.equal(typeof shellBackgroundContent.logPath, "string");
    assert.equal(typeof shellBackgroundContent.stopCommand, "string");
    assert.match(shellBackgroundContent.stdout ?? "", /SHELL_BG_READY/);
    await waitUntil(async () => {
      try {
        return (await readFile(shellBackgroundContent.logPath!, "utf8")).includes("SHELL_BG_READY");
      } catch {
        return false;
      }
    });

    const shellBackgroundStopped = await executeTool("call-stop-shell-native-background", "shell_command", {
      commandLine: shellBackgroundStopCommand,
      timeoutMs: 2_000,
    });
    shellBackgroundStopCommand = undefined;
    assert.equal(shellBackgroundStopped.status, "completed");
    await delay(100);
  } finally {
    if (shellBackgroundStopCommand !== undefined) {
      await executeTool("call-stop-shell-native-background-finally", "shell_command", {
        commandLine: shellBackgroundStopCommand,
        timeoutMs: 2_000,
      }).catch(() => undefined);
      await delay(50);
    }
    if (backgroundStopCommand !== undefined) {
      await executeTool("call-stop-background-finally", "shell_command", {
        commandLine: backgroundStopCommand,
        timeoutMs: 2_000,
      }).catch(() => undefined);
      await delay(50);
    }
    await rm(workspace, { recursive: true, force: true });
  }

  async function executeTool(callId: string, toolName: string, input: Record<string, unknown>) {
    return center.execute(
      { callId, toolName, input },
      context,
      {
        callerAgentId: context.callerAgentId,
        allowedTools: toolNames,
        approvedConfirmationIds: [`confirmation-${callId}`],
      }
    );
  }
});

function platformMakeDirectoryCommand(directory: string): string {
  const normalized = process.platform === "win32" ? directory.split("/").join("\\") : directory;
  return process.platform === "win32" ? `mkdir ${normalized}` : `mkdir -p ${quotePath(normalized)}`;
}

function shellBackgroundLogCommand(syntax: "cmd" | "powershell" | "posix"): string {
  if (syntax === "cmd") return "echo SHELL_BG_READY && ping -n 6 127.0.0.1 >nul";
  if (syntax === "powershell") return "Write-Output SHELL_BG_READY; Start-Sleep -Seconds 5";
  return "printf 'SHELL_BG_READY\\n'; sleep 5";
}

function requireShellSyntax(value: unknown): "cmd" | "powershell" | "posix" {
  if (value !== "cmd" && value !== "powershell" && value !== "posix") {
    throw new Error(`Unexpected shell syntax: ${String(value)}`);
  }
  return value;
}

function quotePath(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(25);
  }
}
