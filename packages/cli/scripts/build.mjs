// Bundles the CLI (and the workspace-only @easily/core sources) into dist/index.js.
// Real npm dependencies stay external and are resolved from node_modules at run time.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith("@easily/"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  // dist/index.js starts with the shebang from src/index.ts
});
console.log("built dist/index.js");
