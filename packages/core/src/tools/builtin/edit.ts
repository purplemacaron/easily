import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { normPath, PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";

const input = z.object({
  path: z.string().describe("Path relative to the workspace root, or absolute inside it"),
  old_string: z.string().min(1).describe("Exact text to replace; must match the file exactly (whitespace included)"),
  new_string: z.string().describe("Replacement text"),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match"),
});

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** T-002: exact string replacement. Fails (instead of guessing) when the match is missing or ambiguous. */
export const editTool: Tool<typeof input> = {
  name: "edit",
  description:
    "Replace an exact string in an existing file. old_string must occur exactly once unless replace_all is true; include enough surrounding context to make it unique.",
  input,
  risk: "write",
  parallelSafe: false,
  summarize: (i) => normPath(i.path),
  async run({ path: p, old_string, new_string, replace_all }, ctx) {
    if (old_string === new_string) return { content: "old_string and new_string are identical; nothing to do.", isError: true };
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx, p, "write");
    } catch (e) {
      if (e instanceof PathRefusedError) return { content: e.message, isError: true };
      throw e;
    }
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch (e) {
      return { content: `Cannot read ${p}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`, isError: true };
    }

    // Models write LF; match against LF text and restore CRLF afterwards.
    const crlf = raw.includes("\r\n");
    const text = crlf ? raw.replace(/\r\n/g, "\n") : raw;
    const oldS = crlf ? old_string.replace(/\r\n/g, "\n") : old_string;
    const newS = crlf ? new_string.replace(/\r\n/g, "\n") : new_string;

    const count = countOccurrences(text, oldS);
    if (count === 0) return { content: `old_string was not found in ${normPath(p)}. Read the file again and copy the text exactly.`, isError: true };
    if (count > 1 && !replace_all) {
      return { content: `old_string occurs ${count} times in ${normPath(p)}. Add more context to make it unique, or set replace_all.`, isError: true };
    }

    const updated = replace_all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
    await ctx.beforeWrite([abs]);
    await writeFile(abs, crlf ? updated.replace(/\n/g, "\r\n") : updated, "utf8");
    return { content: `Edited ${normPath(p)} (${count} replacement${count > 1 ? "s" : ""})` };
  },
};
