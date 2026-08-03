import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app/mobile-ui",
  plugins: [react()],
  server: { host: "0.0.0.0", port: 4311 },
  build: {
    outDir: "../../../dist/app/mobile-ui",
    emptyOutDir: true,
    sourcemap: true,
  },
});
