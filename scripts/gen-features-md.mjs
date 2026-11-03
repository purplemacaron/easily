// Generates docs/FEATURES.md from site/data/features.js (the single source of truth).
// Usage: pnpm gen:features
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../site/data/features.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const { categories, items } = sandbox.window.EASILY_FEATURES;

const STATUS = { planned: "", building: "🛠", done: "✅" };
const lines = [
  "# Easily — 기능 카탈로그",
  "",
  "> 자동 생성 파일. 수정은 `site/data/features.js` 에서 하고 `pnpm gen:features` 실행.",
  "",
  `총 **${items.length}개** 기능 · Phase 는 docs/PLAN.md 참조 · 🛠 진행 중 ✅ 완료`,
  "",
];

for (const cat of categories) {
  const rows = items.filter(([id]) => id.startsWith(cat.id + "-"));
  lines.push(`## ${cat.id} · ${cat.name} (${rows.length})`, "", "| ID | P | 기능 | 설명 | 상태 |", "|---|---|---|---|---|");
  for (const [id, phase, name, desc, status = "planned"] of rows) {
    lines.push(`| ${id} | ${phase} | ${name} | ${desc} | ${STATUS[status]} |`);
  }
  lines.push("");
}

writeFileSync(new URL("../docs/FEATURES.md", import.meta.url), lines.join("\n"));
console.log(`docs/FEATURES.md — ${items.length} features`);
