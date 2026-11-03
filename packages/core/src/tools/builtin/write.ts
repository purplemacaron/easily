import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { normPath, PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";

const input = z.object({
  path: z.string().describe("Path relative to the workspace root, or absolute inside it"),
  content: z.string().describe("Full new content of the file"),
});

/** T-002: create a file or overwrite it completely. Prefer `edit` for small changes. */
export const writeTool: Tool<typeof input> = {
  name: "write",
  description:
    "Create a file or overwrite it with the given content (parent folders are created). For changing part of an existing file use `edit` instead.",
  input,
  risk: "write",
  parallelSafe: false,
  summarize: (i) => normPath(i.path),
  async run({ path: p, content }, ctx) {
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx, p, "write");
    } catch (e) {
      if (e instanceof PathRefusedError) return { content: e.message, isError: true };
      throw e;
    }
    await ctx.beforeWrite([abs]);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { content: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${normPath(p)}` };
  },
};
