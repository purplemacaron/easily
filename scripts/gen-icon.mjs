// Renders site/favicon.svg (white "E" on the accent rounded square) to the app icon:
//   node scripts/gen-icon.mjs   →   apps/desktop/build/icon.png (1024×1024)
// electron-builder derives .ico / .icns from this PNG.
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "site", "favicon.svg"), "utf8");
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();

const out = join(root, "apps", "desktop", "build", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
