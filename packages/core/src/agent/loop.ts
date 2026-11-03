import type Anthropic from "@anthropic-ai/sdk";
import type { HookRunner } from "../hooks/index.js";
import { decide, type PermissionMode, type PermissionRules } from "../permissions/index.js";
import type { Effort, MessageParam, Provider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext, ToolResult } from "../tools/types.js";

/** Everything the UI / CLI / scheduler can observe about a running turn. */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; result: ToolResult }
  | { type: "permission_request"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: Anthropic.Usage }
  | { type: "stopped"; reason: "end_turn" | "refusal" | "max_tokens" | "aborted" | "error"; detail?: string };

export interface TurnOptions {
  provider: Provider;
  model: string;
  effort?: Effort;
  system: string;
  tools: ToolRegistry;
  hooks: HookRunner;
  mode: PermissionMode;
  rules: PermissionRules;
  toolContext: Omit<ToolContext, "signal">;
  /** UI resolves this when the user answers a permission card. */
  askPermission(req: { id: string; name: string; input: unknown }): Promise<boolean>;
  signal: AbortSignal;
  maxIterations?: number;
}

/**
 * The manual agent loop (A-001..A-009). Append-only: `history` is only ever pushed to,
 * never edited, so thinking blocks stay valid and the prompt cache prefix is preserved.
 *
 * Returns the new messages produced by this turn (caller persists them).
 */
export async function* runTurn(
  history: MessageParam[],
  userInput: MessageParam["content"],
  opts: TurnOptions,
): AsyncGenerator<AgentEvent, MessageParam[]> {
  const produced: MessageParam[] = [];
  const push = (m: MessageParam) => {
    history.push(m);
    produced.push(m);
  };

  const pre = await opts.hooks.run("UserPromptSubmit", { prompt: userInput });
  if (pre.block) {
    yield { type: "stopped", reason: "error", detail: pre.block.reason };
    return produced;
  }
  push({ role: "user", content: userInput });
  // TODO(P2): pre.additionalContext → append as a mid-conversation system message (append-only).

  for (let i = 0; i < (opts.maxIterations ?? 200); i++) {
    if (opts.signal.aborted) {
      yield { type: "stopped", reason: "aborted" };
      return produced;
    }

    let final: Anthropic.Message | undefined;
    for await (const ev of opts.provider.stream({
      model: opts.model,
      system: opts.system,
      messages: history,
      tools: opts.tools.definitions(),
      maxTokens: 64000,
      effort: opts.effort,
      signal: opts.signal,
    })) {
      if (ev.type === "text_delta") yield ev;
      else if (ev.type === "thinking_delta") yield ev;
      else if (ev.type === "message") final = ev.message;
    }
    if (!final) throw new Error("provider ended without a final message");

    yield { type: "usage", usage: final.usage };
    push({ role: "assistant", content: final.content });

    switch (final.stop_reason) {
      case "pause_turn":
        continue; // server tool still working — re-send as-is
      case "refusal":
        yield { type: "stopped", reason: "refusal", detail: final.stop_details?.explanation ?? undefined };
        return produced;
      case "max_tokens":
        // TODO(P1, A-009): auto-continue once, then surface to the user.
        yield { type: "stopped", reason: "max_tokens" };
        return produced;
      case "tool_use":
        break;
      default: {
        await opts.hooks.run("Stop", {});
        yield { type: "stopped", reason: "end_turn" };
        return produced;
      }
    }

    const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // TODO(P1): stream tool events live (async queue) instead of buffering until all calls finish.
    const events: AgentEvent[] = [];
    const results = await executeCalls(calls, opts, (e) => events.push(e));
    for (const e of events) yield e;
    // All tool_result blocks go back in ONE user message (keeps parallel tool use working).
    push({ role: "user", content: results });
  }

  yield { type: "stopped", reason: "error", detail: "max iterations reached" };
  return produced;
}

async function executeCalls(
  calls: Anthropic.ToolUseBlock[],
  opts: TurnOptions,
  emit: (e: AgentEvent) => void,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const ctx: ToolContext = { ...opts.toolContext, signal: opts.signal };

  const runOne = async (call: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> => {
    const err = (msg: string): Anthropic.ToolResultBlockParam => ({
      type: "tool_result",
      tool_use_id: call.id,
      content: msg,
      is_error: true,
    });

    const tool = opts.tools.get(call.name);
    if (!tool) return err(`Unknown tool: ${call.name}`);

    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) return err(`Invalid input: ${parsed.error.message}`);

    const decision = decide(opts.mode, opts.rules, {
      tool: call.name,
      risk: tool.risk,
      argSummary: tool.summarize?.(parsed.data) ?? JSON.stringify(parsed.data).slice(0, 200),
    });
    if (decision.kind === "deny") return err(`Permission denied (${decision.reason})`);
    if (decision.kind === "ask") {
      emit({ type: "permission_request", id: call.id, name: call.name, input: parsed.data });
      if (!(await opts.askPermission({ id: call.id, name: call.name, input: parsed.data }))) {
        return err("The user declined this action.");
      }
    }

    const hook = await opts.hooks.run("PreToolUse", { tool: call.name, input: parsed.data });
    if (hook.block) return err(`Blocked by hook: ${hook.block.reason}`);
    const input = hook.updatedInput ?? parsed.data;

    emit({ type: "tool_start", id: call.id, name: call.name, input });
    let result: ToolResult;
    try {
      result = await tool.run(input, ctx);
    } catch (e) {
      result = { content: e instanceof Error ? e.message : String(e), isError: true };
    }
    emit({ type: "tool_end", id: call.id, name: call.name, result });
    await opts.hooks.run("PostToolUse", { tool: call.name, input, result });

    return { type: "tool_result", tool_use_id: call.id, content: result.content, is_error: result.isError };
  };

  // Parallel-safe tools run concurrently; the rest run in order afterwards (A-002).
  const parallel = calls.filter((c) => opts.tools.get(c.name)?.parallelSafe);
  const serial = calls.filter((c) => !opts.tools.get(c.name)?.parallelSafe);
  const out = new Map<string, Anthropic.ToolResultBlockParam>();
  for (const r of await Promise.all(parallel.map(runOne))) out.set(r.tool_use_id, r);
  for (const c of serial) out.set(c.id, await runOne(c));
  return calls.map((c) => out.get(c.id)!);
}
