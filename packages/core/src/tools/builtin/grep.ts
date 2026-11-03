import fg from "fast-glob";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normPath, PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";
import { DEFAULT_IGNORES } from "./glob.js";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 2_000_000;

const input = z.object({
  pattern: z.string().describe("Regular expression (JavaScript syntax)"),
  path: z.string().optional().describe("File or directory to search (default: workspace root)"),
  glob: z.string().optional().describe('Only search files matching this glob, e.g. "**/*.ts"'),
  ignore_case: z.boolean().optional(),
});

/** T-003: content search (pure JS; ripgrep can replace it later without changing the contract). */
export const grepTool: Tool<typeof input> = {
  name: "grep",
  description: "Search file contents with a regular expression. Returns path:line:text for up to 200 matches. Binary and very large files are skipped.",
  input,
  risk: "read",
  parallelSafe: true,
  summarize: (i) => i.pattern,
  async run({ pattern, path: target, glob, ignore_case }, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, ignore_case ? "i" : "");
    } catch (e) {
      return { content: `Invalid regular expression: ${(e as Error).message}`, isError: true };
    }
    let base: string;
    try {
      base = resolveInWorkspace(ctx, target ?? ".", "read");
    } catch (e) {
      if (e instanceof PathRefusedError) return { content: e.message, isError: true };
      throw e;
    }

    let root = base;
    let files: string[];
    const st = await stat(base).catch(() => null);
    if (!st) return { content: `Path not found: ${target}`, isError: true };
    if (st.isFile()) {
      root = path.dirname(base);
      files = [path.basename(base)];
    } else {
      files = await fg(glob ?? "**/*", { cwd: base, ignore: DEFAULT_IGNORES, onlyFiles: true, dot: false, followSymbolicLinks: false });
      files.sort();
    }

    const out: string[] = [];
    let total = 0;
    for (const rel of files) {
      if (ctx.signal.aborted) break;
      const abs = path.join(root, rel);
      const info = await stat(abs).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES) continue;
      const text = await readFile(abs, "utf8").catch(() => null);
      if (text === null || text.includes("\u0000")) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          total++;
          if (out.length < MAX_MATCHES) out.push(`${normPath(path.relative(ctx.cwd, abs))}:${i + 1}:${lines[i]!.slice(0, 300)}`);
        }
      }
    }
    if (total === 0) return { content: "No matches." };
    return { content: out.join("\n") + (total > out.length ? `\n… ${total - out.length} more matches (narrow the search)` : "") };
  },
};
