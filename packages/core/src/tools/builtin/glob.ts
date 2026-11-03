import fg from "fast-glob";
import { z } from "zod";
import { normPath, PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";

const MAX_RESULTS = 500;
export const DEFAULT_IGNORES = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**", "**/.next/**"];

const input = z.object({
  pattern: z.string().describe('Glob pattern, e.g. "**/*.md" or "src/**/*.ts"'),
  path: z.string().optional().describe("Directory to search in (default: workspace root)"),
});

/** T-003: file name search. */
export const globTool: Tool<typeof input> = {
  name: "glob",
  description: "Find files by glob pattern inside the workspace. Returns paths relative to the search directory, at most 500.",
  input,
  risk: "read",
  parallelSafe: true,
  summarize: (i) => normPath(i.path ? `${i.path}/${i.pattern}` : i.pattern),
  async run({ pattern, path: dir }, ctx) {
    let base: string;
    try {
      base = resolveInWorkspace(ctx, dir ?? ".", "read");
    } catch (e) {
      if (e instanceof PathRefusedError) return { content: e.message, isError: true };
      throw e;
    }
    const files = await fg(pattern, { cwd: base, ignore: DEFAULT_IGNORES, dot: false, onlyFiles: true, followSymbolicLinks: false });
    files.sort();
    if (files.length === 0) return { content: "No files matched." };
    const shown = files.slice(0, MAX_RESULTS);
    const more = files.length - shown.length;
    return { content: shown.join("\n") + (more > 0 ? `\n… ${more} more (narrow the pattern)` : "") };
  },
};
