import { readFile } from "node:fs/promises";
import { z } from "zod";
import { normPath, PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";

const MAX_LINES = 2000;
/** The read tool caps its own output (it is exempt from spilling so spilled files stay readable). */
const MAX_CHARS = 30_000;

const input = z.object({
  path: z.string().describe("Path relative to the workspace root, or absolute inside it"),
  offset: z.number().int().min(0).optional().describe("0-based line to start at"),
  limit: z.number().int().min(1).max(MAX_LINES).optional().describe("Number of lines to return"),
});

export const readTool: Tool<typeof input> = {
  name: "read",
  description:
    "Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files instead of reading everything.",
  input,
  risk: "read",
  parallelSafe: true,
  summarize: (i) => normPath(i.path),
  async run({ path: p, offset = 0, limit = MAX_LINES }, ctx) {
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx, p, "read");
    } catch (e) {
      if (e instanceof PathRefusedError) return { content: e.message, isError: true };
      throw e;
    }
    let text: string;
    try {
      text = await readFile(abs, "utf8");
    } catch (e) {
      return { content: `Cannot read ${p}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, isError: true };
    }
    if (text.includes("\u0000")) return { content: `${p} looks like a binary file; not shown.`, isError: true };
    const lines = text.split(/\r?\n/);
    const slice = lines.slice(offset, offset + limit);
    let body = slice.map((l, i) => `${String(offset + i + 1).padStart(6)}\t${l}`).join("\n");
    let note = "";
    if (body.length > MAX_CHARS) {
      body = body.slice(0, MAX_CHARS);
      note = `\n… output cut at ${MAX_CHARS} characters; read again with a smaller limit/offset`;
    }
    const rest = lines.length - offset - limit;
    return { content: body + note + (rest > 0 ? `\n… ${rest} more lines` : "") };
  },
};
