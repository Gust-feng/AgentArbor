import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app/mobile-ui",
  base: "./",
  // .env 统一放仓库根目录（与 .env.example 同级）；root 指向 app 子目录时
  // Vite 默认只从该子目录读 .env，会导致 VITE_AGENTARBOR_RELAY_URL 注入失效。
  envDir: import.meta.dirname,
  plugins: [react()],
  server: { host: "0.0.0.0", port: 4311 },
  build: {
    target: "chrome74",
    outDir: "../../../dist/app/mobile-ui",
    emptyOutDir: true,
    sourcemap: true,
  },
});
