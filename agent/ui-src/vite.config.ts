import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    cssMinify: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
