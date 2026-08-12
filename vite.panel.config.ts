import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/app/panel-ui",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: panelDevProxy(),
  },
  build: {
    outDir: "../../../dist/app/panel-ui",
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (!normalized.includes("/node_modules/")) return undefined;
          if (normalized.includes("/prosemirror-")) return "editor-prosemirror";
          if (normalized.includes("/@tiptap+") || normalized.includes("/tiptap-markdown")) return "editor-tiptap";
          if (
            normalized.includes("/markdown-it/")
            || normalized.includes("/linkify-it/")
            || normalized.includes("/linkifyjs/")
            || normalized.includes("/entities/")
            || normalized.includes("/punycode.js/")
            || normalized.includes("/uc.micro/")
          ) return "editor-markdown";
          return undefined;
        },
      },
    },
  },
});

function panelDevProxy(): Record<string, string> {
  const host = process.env.AGENTARBOR_PANEL_API_HOST ?? "127.0.0.1";
  const port = process.env.AGENTARBOR_PANEL_API_PORT ?? "4306";
  const target = `http://${host}:${port}`;
  return {
    "/api": target,
    "/health": target,
    "/favicon.svg": target,
  };
}