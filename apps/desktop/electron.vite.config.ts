import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@easily/core", "@easily/mcp-catalog"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: { "@renderer": resolve("src/renderer/src") },
    },
    plugins: [react()],
    // Fonts live in the pnpm store, which may sit outside the workspace (see CLAUDE.md, Windows notes).
    // The dev server only listens on localhost for the Electron window.
    server: { fs: { strict: false } },
  },
});
