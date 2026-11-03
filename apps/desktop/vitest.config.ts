import { defineConfig } from "vitest/config";

// Renderer tests render React to static markup in plain node; JSX must use the automatic runtime.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
});
