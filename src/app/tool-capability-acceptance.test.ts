import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { modelVisibleToolDescription } from "../domain/tools/index.js";
import { createDesktopBasicToolRegistry } from "./basic-agent-runtime/index.js";
import { ensurePidExited } from "./tool-center/adapters/background-process-test-utils.js";

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
  let backgroundPid: number | undefined;
  let shellBackgroundStopCommand: string | undefined;
  let shellBackgroundPid: number | undefined;
  let serverPid: number | undefined;

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
      "list_context_attachments",
      "read_context_attachment_text",
      "read_context_attachment_pdf_text",
      "read_context_attachment_image",
      "inspect_context_attachment_table",
      "read_context_attachment_table",
      "inspect_context_attachment_archive",
      "list_context_attachment_files",
      "search_context_attachment_files",
      "http_request",
    ]);
    assert.equal(toolNames.includes("create_directory"), false);
    assert.equal(toolNames.includes("http_request"), true);
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

    const commandFailure = await executeTool("call-command-failure", "shell_command", {
      command: process.execPath,
      args: ["-e", "console.error('structured command failure'); process.exit(7);"],
    });
    const commandFailureContent = commandFailure.projection?.agentContent as {
      readonly exitCode?: number;
      readonly stderr?: string;
    };
    assert.equal(commandFailure.status, "completed");
    assert.equal(commandFailureContent.exitCode, 7);
    assert.match(commandFailureContent.stderr ?? "", /structured command failure/);

    const port = await reserveFreePort();
    const serverSource = [
      "import { createServer } from 'node:http';",
      "const port = Number(process.argv[2]);",
      "const server = createServer((req, res) => {",
      "  if (req.url === '/ready') {",
      "    res.writeHead(200, { 'content-type': 'text/plain' });",
      "    res.end('demo-ready');",
      "    return;",
      "  }",
      "  res.writeHead(404, { 'content-type': 'text/plain' });",
      "  res.end('demo-missing');",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`HTTP_READY:${port}`));",
      "",
    ].join("\n");
    const writeServer = await executeTool("call-write-server", "write_file", {
      path: "demo/server.mjs",
      content: serverSource,
    });
    assert.equal(writeServer.status, "completed");

    const server = await executeTool("call-start-server", "shell_command", {
      commandLine: `${process.execPath} server.mjs ${port}`,
      command: process.execPath,
      args: ["server.mjs", String(port)],
      cwd: "demo",
      background: true,
      backgroundWaitMs: 1_000,
      waitForPort: port,
      waitForPortTimeoutMs: 5_000,
    });
    const serverContent = server.projection?.agentContent as {
      readonly background?: boolean;
      readonly portReady?: boolean;
      readonly waitForPort?: number;
      readonly stopCommand?: string;
      readonly pid?: number;
      readonly stdout?: string;
    };
    backgroundStopCommand = serverContent.stopCommand;
    serverPid = serverContent.pid;
    assert.equal(server.status, "completed");
    assert.equal(serverContent.background, true);
    assert.equal(serverContent.waitForPort, port);
    assert.equal(serverContent.portReady, true);
    assert.equal(typeof serverContent.stopCommand, "string");
    assert.match(serverContent.stdout ?? "", new RegExp(`HTTP_READY:${port}|Port ${port} is ready`));

    const httpOk = await executeTool("call-http-ok", "http_request", {
      url: `http://127.0.0.1:${port}/ready`,
      timeoutMs: 2_000,
    });
    const httpOkContent = httpOk.projection?.agentContent as {
      readonly statusCode?: number;
      readonly body?: string;
      readonly method?: string;
    };
    assert.equal(httpOk.status, "completed");
    assert.equal(httpOkContent.method, "GET");
    assert.equal(httpOkContent.statusCode, 200);
    assert.match(httpOkContent.body ?? "", /demo-ready/);

    const httpNotFound = await executeTool("call-http-not-found", "http_request", {
      url: `http://127.0.0.1:${port}/missing`,
      timeoutMs: 2_000,
    });
    const httpNotFoundContent = httpNotFound.projection?.agentContent as {
      readonly statusCode?: number;
      readonly body?: string;
    };
    assert.equal(httpNotFound.status, "completed");
    assert.equal(httpNotFoundContent.statusCode, 404);
    assert.match(httpNotFoundContent.body ?? "", /demo-missing/);

    const stoppedServer = await executeTool("call-stop-server", "shell_command", {
      commandLine: backgroundStopCommand,
      timeoutMs: 2_000,
    });
    backgroundStopCommand = undefined;
    await ensurePidExited(serverPid, 5_000);
    serverPid = undefined;
    assert.equal(stoppedServer.status, "completed");
    await waitUntil(async () => !(await canConnectToLocalhostPort(port)), 5_000);

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
    assert.equal((largeContent.stdout?.length ?? 0) <= 16_000, true);

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
    backgroundPid = backgroundContent.pid;
    assert.equal(background.status, "completed");
    assert.equal(backgroundContent.background, true);
    assert.equal(typeof backgroundContent.pid, "number");
    assert.equal(typeof backgroundContent.logPath, "string");
    assert.equal(typeof backgroundContent.stopCommand, "string");
    assert.match(backgroundContent.stdout ?? "", /Started background process/);
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
    await ensurePidExited(backgroundPid, 5_000);
    backgroundPid = undefined;
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
    shellBackgroundPid = shellBackgroundContent.pid;
    assert.equal(shellBackground.status, "completed");
    assert.equal(shellBackgroundContent.background, true);
    assert.equal(typeof shellBackgroundContent.pid, "number");
    assert.equal(typeof shellBackgroundContent.logPath, "string");
    assert.equal(typeof shellBackgroundContent.stopCommand, "string");
    assert.match(shellBackgroundContent.stdout ?? "", /Started background process/);
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
    await ensurePidExited(shellBackgroundPid, 5_000);
    shellBackgroundPid = undefined;
    assert.equal(shellBackgroundStopped.status, "completed");
    await delay(100);
  } finally {
    if (shellBackgroundStopCommand !== undefined) {
      await executeTool("call-stop-shell-native-background-finally", "shell_command", {
        commandLine: shellBackgroundStopCommand,
        timeoutMs: 2_000,
      }).catch(() => undefined);
      await ensurePidExited(shellBackgroundPid, 5_000).catch(() => undefined);
      await delay(50);
    }
    if (backgroundStopCommand !== undefined) {
      await executeTool("call-stop-background-finally", "shell_command", {
        commandLine: backgroundStopCommand,
        timeoutMs: 2_000,
      }).catch(() => undefined);
      await ensurePidExited(backgroundPid ?? serverPid, 5_000).catch(() => undefined);
      await delay(50);
    }
    await removeTempTree(workspace);
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

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
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

async function removeTempTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}

async function reserveFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  if (port === undefined) {
    throw new Error("Failed to reserve a free local port.");
  }
  return port;
}

function canConnectToLocalhostPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}
