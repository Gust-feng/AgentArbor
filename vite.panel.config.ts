import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/app/panel-ui",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../../dist/app/panel-ui",
    emptyOutDir: true,
    sourcemap: true,
  },
});
