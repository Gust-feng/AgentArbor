import { parsePanelArgs } from "./panel-args.js";
import { startLocalPanelServer } from "./panel-server.js";

await main();

async function main(): Promise<void> {
  const args = parsePanelArgs(process.argv.slice(2));
  const server = await startLocalPanelServer({
    host: args.host,
    port: args.port,
    configDirectory: args.configDirectory,
  });

  console.log(`AgentArbor 本地面板：${server.url}`);
  if (server.configDirectory !== undefined) {
    console.log(`配置目录：${server.configDirectory}`);
  }

  if (args.smoke) {
    await server.close();
    return;
  }

  process.on("SIGINT", () => {
    server
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  });
}
