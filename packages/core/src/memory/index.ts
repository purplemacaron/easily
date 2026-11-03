import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Memory (X-005..X-009). One fact per markdown file with frontmatter, plus a MEMORY.md index
 * that is always in context. Relevant files are recalled per turn and injected after the
 * last cache breakpoint so the cached prefix is untouched.
 *
 *   memory/
 *   ├─ MEMORY.md                       - [Title](file.md) — one-line hook
 *   ├─ user-prefers-korean.md
 *   └─ project-release-freeze.md
 */
export type MemoryType = "user" | "feedback" | "project" | "reference";

export const MEMORY_TYPES: readonly MemoryType[] = ["user", "feedback", "project", "reference"];

export interface MemoryFile {
  name: string; // slug, also the file name
  description: string; // used for relevance ranking
  type: MemoryType;
  body: string;
  /** [[other-name]] links found in the body. */
  links: string[];
  updatedAt: number;
}

export interface MemoryStore {
  index(): Promise<string>;
  list(): Promise<MemoryFile[]>;
  recall(query: string, limit?: number): Promise<MemoryFile[]>;
  upsert(file: Omit<MemoryFile, "links" | "updatedAt">): Promise<void>;
  remove(name: string): Promise<void>;
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;

export function assertMemoryName(name: string): void {
  if (!NAME_RE.test(name) || name.toUpperCase() === "MEMORY") {
    throw new Error(`Invalid memory name "${name}": use letters, digits, "-" and "_" (max 80)`);
  }
}

/** Markdown + frontmatter files in a directory (X-006). */
export class FileMemoryStore implements MemoryStore {
  constructor(private readonly dir: string) {}

  async index(): Promise<string> {
    try {
      return await readFile(path.join(this.dir, "MEMORY.md"), "utf8");
    } catch {
      return "";
    }
  }

  async list(): Promise<MemoryFile[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: MemoryFile[] = [];
    for (const f of names) {
      if (!f.endsWith(".md") || f === "MEMORY.md") continue;
      const parsed = parseMemory(f.slice(0, -3), await readFile(path.join(this.dir, f), "utf8").catch(() => ""));
      if (parsed) out.push(parsed);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async upsert(file: Omit<MemoryFile, "links" | "updatedAt">): Promise<void> {
    assertMemoryName(file.name);
    if (!MEMORY_TYPES.includes(file.type)) throw new Error(`Invalid memory type: ${file.type}`);
    await mkdir(this.dir, { recursive: true });
    const text = serializeMemory({ ...file, updatedAt: Date.now() });
    const target = path.join(this.dir, `${file.name}.md`);
    await writeFile(`${target}.tmp`, text, "utf8");
    await rename(`${target}.tmp`, target);
    await this.rebuildIndex();
  }

  async remove(name: string): Promise<void> {
    assertMemoryName(name);
    await rm(path.join(this.dir, `${name}.md`), { force: true });
    await this.rebuildIndex();
  }

  async recall(query: string, limit = 5): Promise<MemoryFile[]> {
    const files = await this.list();
    return bm25Rank(files, query).slice(0, limit);
  }

  private async rebuildIndex(): Promise<void> {
    const files = (await this.list()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const lines = files.map((f) => `- [${f.name}](${f.name}.md) — ${f.description.replace(/\s+/g, " ").trim()}`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, "MEMORY.md"), lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  }
}

// ── frontmatter ────────────────────────────────────────────────────────────
function serializeMemory(f: Omit<MemoryFile, "links">): string {
  const desc = f.description.replace(/\r?\n/g, " ");
  return `---\nname: ${f.name}\ndescription: ${desc}\ntype: ${f.type}\nupdatedAt: ${f.updatedAt}\n---\n${f.body.trimEnd()}\n`;
}

export function parseMemory(name: string, text: string): MemoryFile | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const type = MEMORY_TYPES.find((t) => t === meta.type) ?? "project";
  const body = m[2]!.trim();
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]!.trim());
  return { name, description: meta.description ?? "", type, body, links, updatedAt: Number(meta.updatedAt) || 0 };
}

// ── BM25 recall (X-007) ────────────────────────────────────────────────────
/** Words plus character bigrams for CJK runs, so Korean/Japanese/Chinese queries match without a segmenter. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    out.push(w);
    if (/[぀-ヿ㐀-鿿가-힯]/.test(w) && w.length > 1) {
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
    }
  }
  return out;
}

export function bm25Rank(files: MemoryFile[], query: string, k1 = 1.5, b = 0.75): MemoryFile[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0 || files.length === 0) return [];
  // name and description count triple: they are the curated relevance hints.
  const docs = files.map((f) => tokenize(`${f.name} ${f.name} ${f.name} ${f.description} ${f.description} ${f.description} ${f.body}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const scored = files.map((f, i) => {
    const d = docs[i]!;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const n = df.get(t) ?? 0;
      const freq = tf.get(t) ?? 0;
      if (!freq) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * (freq * (k1 + 1))) / (freq + k1 * (1 - b + (b * d.length) / avg));
    }
    return { f, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).map((s) => s.f);
}
