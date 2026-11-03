import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { z } from "zod";
import { killTree } from "../util/process.js";

/**
 * Hooks (H-004..H-006). A hook is either a shell command (receives JSON on stdin, may print JSON)
 * or a JS module exporting a default function. Both can block, modify input, or inject context.
 *
 * Config lives in settings.json under "hooks", merged global → project → local:
 *   { "PreToolUse": [{ "matcher": "shell", "command": "node .easily/hooks/guard.mjs" }] }
 *
 * Command protocol: stdin = {"event": "...", "cwd": "...", ...payload}.
 *   exit 2                         → block, stderr is the reason
 *   stdout JSON {"decision":"block","reason":"..."} | {"block":{"reason":"..."}}
 *                                  → block
 *   stdout JSON {"updatedInput": {...}}      → replace tool input (PreToolUse)
 *   stdout JSON {"additionalContext": "..."} → extra text for the model
 *   any other exit code / non-JSON stdout    → ignored (hooks must not break the agent)
 */
export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "PreCompact";

export interface HookOutcome {
  /** Stop the action. For PreToolUse the reason is returned to the model as an error result. */
  block?: { reason: string };
  /** Replacement tool input (PreToolUse only). */
  updatedInput?: unknown;
  /** Extra text appended for the model (UserPromptSubmit, SessionStart, PostToolUse). */
  additionalContext?: string;
}

export const HookSpecSchema = z.object({
  matcher: z.string().optional(),
  command: z.string().optional(),
  module: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type HookSpec = z.infer<typeof HookSpecSchema>;

export const HookConfigSchema = z.record(z.array(HookSpecSchema));
export type HookConfig = Partial<Record<HookEvent, HookSpec[]>>;

const DEFAULT_TIMEOUT_MS = 30_000;

const OutputSchema = z
  .object({
    decision: z.string().optional(),
    reason: z.string().optional(),
    block: z.union([z.boolean(), z.object({ reason: z.string().optional() })]).optional(),
    updatedInput: z.unknown().optional(),
    additionalContext: z.string().optional(),
  })
  .passthrough();

export class HookRunner {
  constructor(
    private readonly config: HookConfig,
    private readonly opts: { cwd?: string } = {},
  ) {}

  hasHooks(event: HookEvent): boolean {
    return (this.config[event]?.length ?? 0) > 0;
  }

  async run(event: HookEvent, payload: Record<string, unknown>): Promise<HookOutcome> {
    const specs = this.config[event] ?? [];
    const merged: HookOutcome = {};
    const contexts: string[] = [];
    for (const spec of specs) {
      if (spec.matcher && payload.tool !== undefined && !safeRegex(spec.matcher).test(String(payload.tool))) continue;
      let outcome: HookOutcome;
      try {
        outcome = spec.command
          ? await this.runCommand(spec, event, payload)
          : spec.module
            ? await this.runModule(spec, event, payload)
            : {};
      } catch {
        continue; // a broken hook never takes the agent down
      }
      if (outcome.block && !merged.block) merged.block = outcome.block;
      if (outcome.updatedInput !== undefined) merged.updatedInput = outcome.updatedInput;
      if (outcome.additionalContext) contexts.push(outcome.additionalContext);
      if (merged.block) break;
    }
    if (contexts.length) merged.additionalContext = contexts.join("\n");
    return merged;
  }

  private runCommand(spec: HookSpec, event: HookEvent, payload: Record<string, unknown>): Promise<HookOutcome> {
    return new Promise((resolve) => {
      const child = spawn(spec.command!, { shell: true, cwd: this.opts.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const done = (o: HookOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(o);
      };
      const timer = setTimeout(() => {
        killTree(child);
        done({});
      }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", () => done({}));
      child.on("close", (code) => {
        if (code === 2) return done({ block: { reason: stderr.trim() || "Blocked by hook" } });
        done(parseOutput(stdout));
      });
      child.stdin.on("error", () => undefined); // hook may exit without reading stdin
      child.stdin.end(JSON.stringify({ event, cwd: this.opts.cwd, ...payload }));
    });
  }

  private async runModule(spec: HookSpec, event: HookEvent, payload: Record<string, unknown>): Promise<HookOutcome> {
    const file = path.resolve(this.opts.cwd ?? process.cwd(), spec.module!);
    const mod = (await import(pathToFileURL(file).href)) as { default?: (e: HookEvent, p: Record<string, unknown>) => unknown };
    if (typeof mod.default !== "function") return {};
    const out = await Promise.race([
      Promise.resolve(mod.default(event, payload)),
      new Promise((r) => setTimeout(() => r(undefined), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    ]);
    return normalize(out);
  }
}

function safeRegex(src: string): RegExp {
  try {
    return new RegExp(src);
  } catch {
    return /^$/;
  }
}

function parseOutput(stdout: string): HookOutcome {
  const text = stdout.trim();
  if (!text) return {};
  try {
    return normalize(JSON.parse(text));
  } catch {
    return {};
  }
}

function normalize(raw: unknown): HookOutcome {
  const p = OutputSchema.safeParse(raw);
  if (!p.success) return {};
  const v = p.data;
  const out: HookOutcome = {};
  if (v.decision === "block" || v.decision === "deny") out.block = { reason: v.reason ?? "Blocked by hook" };
  else if (v.block) out.block = { reason: typeof v.block === "object" ? (v.block.reason ?? v.reason ?? "Blocked by hook") : (v.reason ?? "Blocked by hook") };
  if (v.updatedInput !== undefined) out.updatedInput = v.updatedInput;
  if (v.additionalContext) out.additionalContext = v.additionalContext;
  return out;
}
