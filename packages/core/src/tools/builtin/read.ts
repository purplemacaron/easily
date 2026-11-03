import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool } from "../types.js";

const MAX_LINES = 2000;

const input = z.object({
  path: z.string().describe("Path relative to the workspace root, or absolute inside it"),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_LINES).optional(),
});

/** Reference built-in tool. Copy this shape for write/edit/glob/grep/shell/todo (T-002..T-007). */
export const readTool: Tool<typeof input> = {
  name: "read",
  description:
    "Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files instead of reading everything.",
  input,
  risk: "read",
  parallelSafe: true,
  summarize: (i) => i.path,
  async run({ path: p, offset = 0, limit = MAX_LINES }, ctx) {
    const root = path.resolve(ctx.cwd);
    const abs = path.resolve(root, p);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return { content: `Refused: ${p} is outside the workspace`, isError: true };
    }
    const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
    const slice = lines.slice(offset, offset + limit);
    const body = slice.map((l, i) => `${String(offset + i + 1).padStart(6)}\t${l}`).join("\n");
    const rest = lines.length - offset - limit;
    return { content: rest > 0 ? `${body}\n… ${rest} more lines` : body };
  },
};
