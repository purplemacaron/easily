import type { ToolRisk } from "../tools/types.js";

/**
 * Permission system (H-001..H-003).
 *
 *   ask        every write/exec/network call asks; reads are free
 *   auto-edit  file writes inside the workspace are free; exec/network ask
 *   plan       read-only: write/exec are denied, the agent must produce a plan
 *   yolo       everything allowed except deny rules (explicit opt-in, red badge in UI)
 *
 * Rules are evaluated deny → allow → mode. Patterns: "shell(git *)", "write(src/**)", "mcp__github__*".
 */
export type PermissionMode = "ask" | "auto-edit" | "plan" | "yolo";

export interface PermissionRules {
  allow: string[];
  deny: string[];
}

export type Decision = { kind: "allow" } | { kind: "deny"; reason: string } | { kind: "ask" };

export function decide(
  mode: PermissionMode,
  rules: PermissionRules,
  call: { tool: string; risk: ToolRisk; argSummary: string },
): Decision {
  const key = `${call.tool}(${call.argSummary})`;
  if (rules.deny.some((p) => matches(p, call.tool, key))) return { kind: "deny", reason: "deny rule" };
  if (rules.allow.some((p) => matches(p, call.tool, key))) return { kind: "allow" };

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

function matches(pattern: string, tool: string, key: string): boolean {
  // TODO(P1): real glob matching (picomatch) for argument patterns.
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(pattern.includes("(") ? key : tool);
}
