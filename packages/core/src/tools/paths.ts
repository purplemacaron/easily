import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ToolContext } from "./types.js";

/** Thrown for paths outside the allowed roots; tools turn it into an error result. */
export class PathRefusedError extends Error {}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolves symlinks of the deepest existing ancestor so a link cannot smuggle a path out. */
function realish(p: string): string {
  let cur = p;
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return p;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(realpathSync(cur), ...tail);
}

export function allowedRoots(ctx: ToolContext, mode: "read" | "write"): string[] {
  const roots = [ctx.cwd, ...(ctx.extraRoots ?? [])];
  if (mode === "read" && ctx.spillDir) roots.push(ctx.spillDir);
  return roots.map((r) => path.resolve(r));
}

/**
 * Resolve a tool-supplied path against the workspace and refuse anything that escapes it
 * (".." segments, absolute paths elsewhere, symlinks pointing out).
 */
export function resolveInWorkspace(ctx: ToolContext, p: string, mode: "read" | "write" = "read"): string {
  const abs = path.resolve(ctx.cwd, p);
  const real = realish(abs);
  for (const root of allowedRoots(ctx, mode)) {
    if (isInside(root, abs) && isInside(realish(root), real)) return abs;
  }
  throw new PathRefusedError(`Refused: ${p} is outside the workspace`);
}

/** Path as matched by permission rules: forward slashes, no leading "./". */
export function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
