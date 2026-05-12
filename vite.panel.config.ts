import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/app/panel-ui",
  plugins: [react()],
  build: {
    outDir: "../../../dist/app/panel-ui",
    emptyOutDir: true,
    sourcemap: true,
  },
});
