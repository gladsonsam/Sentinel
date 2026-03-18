import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tell Vite where the Tauri app source is (relative to dist)
  base: "./",
  build: {
    // Put output where tauri.conf.json expects it
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
