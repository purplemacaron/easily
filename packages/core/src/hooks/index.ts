/**
 * Hooks (H-004..H-006). A hook is either a shell command (receives JSON on stdin, may print JSON)
 * or a JS/TS module exporting a function. Both can block, modify input, or inject context.
 *
 * Config lives in settings.json under "hooks", merged global → project → local:
 *   { "PreToolUse": [{ "matcher": "shell", "command": "node .easily/hooks/guard.mjs" }] }
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

export interface HookSpec {
  matcher?: string;
  command?: string;
  module?: string;
  timeoutMs?: number;
}

export class HookRunner {
  constructor(private readonly config: Partial<Record<HookEvent, HookSpec[]>>) {}

  async run(event: HookEvent, payload: Record<string, unknown>): Promise<HookOutcome> {
    const specs = this.config[event] ?? [];
    const merged: HookOutcome = {};
    for (const spec of specs) {
      if (spec.matcher && payload.tool && !new RegExp(spec.matcher).test(String(payload.tool))) continue;
      // TODO(P2): execute spec.command via child_process (JSON stdin/stdout) or import spec.module.
      void spec;
    }
    return merged;
  }
}
