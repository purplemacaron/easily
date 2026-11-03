import type Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HookRunner } from "../hooks/index.js";
import { decide, type PermissionMode, type PermissionRules } from "../permissions/index.js";
import { describeProviderError, type Effort, type MessageParam, type Provider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext, ToolResult, ToolRisk } from "../tools/types.js";

/** Everything the UI / CLI / scheduler can observe about a running turn. */
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  /** The model started writing a tool call (arguments still streaming). */
  | { type: "tool_pending"; id: string; name: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; result: ToolResult; ms: number }
  | { type: "permission_request"; id: string; name: string; input: unknown; risk: ToolRisk; summary: string }
  | { type: "usage"; usage: Anthropic.Usage; model: string }
  /** A message was appended to the history (user prompt, assistant reply, tool results). */
  | { type: "message"; message: MessageParam }
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
  /** Output limit per model call. */
  maxTokens?: number;
  /** Tool results longer than this are written to disk and replaced by a summary (H-021). */
  spillThreshold?: number;
}

const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_SPILL_THRESHOLD = 30_000;
const CONTINUE_PROMPT = "[Your previous reply was cut off by the output limit. Continue exactly where you stopped; do not repeat what you already wrote.]";

/** Minimal async queue so tool events can be yielded while tools are still running. */
class EventQueue<T> {
  private items: T[] = [];
  private waiter?: () => void;
  private closed = false;
  private error?: unknown;

  push(item: T): void {
    this.items.push(item);
    this.wake();
  }
  close(error?: unknown): void {
    this.closed = true;
    this.error = error;
    this.wake();
  }
  private wake(): void {
    this.waiter?.();
    this.waiter = undefined;
  }
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) break;
      await new Promise<void>((r) => (this.waiter = r));
    }
    if (this.error) throw this.error;
  }
}

/**
 * The manual agent loop (A-001..A-009). Append-only: `history` is only ever pushed to,
 * never edited, so thinking blocks stay valid and the prompt cache prefix is preserved.
 *
 * Returns the new messages produced by this turn (the caller persists them, or listens for
 * the `message` events as they happen).
 */
export async function* runTurn(
  history: MessageParam[],
  userInput: MessageParam["content"],
  opts: TurnOptions,
): AsyncGenerator<AgentEvent, MessageParam[]> {
  const produced: MessageParam[] = [];
  const push = (m: MessageParam): AgentEvent => {
    history.push(m);
    produced.push(m);
    return { type: "message", message: m };
  };

  const pre = await opts.hooks.run("UserPromptSubmit", { prompt: userInput });
  if (pre.block) {
    yield { type: "stopped", reason: "error", detail: pre.block.reason };
    return produced;
  }
  let content = userInput;
  if (pre.additionalContext) {
    const extra = { type: "text" as const, text: pre.additionalContext };
    content = typeof userInput === "string" ? [{ type: "text", text: userInput }, extra] : [...userInput, extra];
  }
  yield push({ role: "user", content });

  let continued = false; // auto-continue after max_tokens happens at most once per turn
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  for (let i = 0; i < (opts.maxIterations ?? 200); i++) {
    if (opts.signal.aborted) {
      yield { type: "stopped", reason: "aborted" };
      return produced;
    }

    const toolsOn = opts.provider.connection.capabilities.tools;
    let final: Anthropic.Message | undefined;
    try {
      for await (const ev of opts.provider.stream({
        model: opts.model,
        system: opts.system,
        messages: history,
        tools: toolsOn ? opts.tools.definitions() : [],
        maxTokens,
        effort: opts.effort,
        signal: opts.signal,
      })) {
        if (ev.type === "text_delta" || ev.type === "thinking_delta") yield ev;
        else if (ev.type === "tool_use_start") yield { type: "tool_pending", id: ev.toolUseId, name: ev.name };
        else if (ev.type === "message") final = ev.message;
      }
    } catch (e) {
      if (opts.signal.aborted) {
        yield { type: "stopped", reason: "aborted" };
        return produced;
      }
      yield { type: "stopped", reason: "error", detail: describeProviderError(e).message };
      return produced;
    }
    if (!final) {
      yield { type: "stopped", reason: "error", detail: "provider ended without a final message" };
      return produced;
    }

    yield { type: "usage", usage: final.usage, model: opts.model };
    // An empty assistant message cannot be replayed to the API; substitute a placeholder block.
    yield push({ role: "assistant", content: final.content.length ? final.content : [{ type: "text", text: "(no output)" }] });

    const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    switch (final.stop_reason) {
      case "pause_turn":
        continue; // server tool still working — re-send as-is
      case "refusal":
        yield { type: "stopped", reason: "refusal", detail: final.stop_details?.explanation ?? undefined };
        return produced;
      case "model_context_window_exceeded":
        yield { type: "stopped", reason: "error", detail: "The context window is full. Start a new session or compact the conversation." };
        return produced;
      case "max_tokens": {
        if (continued) {
          yield { type: "stopped", reason: "max_tokens" };
          return produced;
        }
        continued = true;
        if (calls.length > 0) {
          // Truncated tool calls cannot run; answer them so the history stays valid, and let the model retry.
          yield push({
            role: "user",
            content: calls.map((c) => ({
              type: "tool_result" as const,
              tool_use_id: c.id,
              is_error: true,
              content: "Your output hit the length limit before this tool call was complete, so it was not run. Retry with smaller content (e.g. write the file in several steps).",
            })),
          });
        } else {
          yield push({ role: "user", content: CONTINUE_PROMPT });
        }
        continue;
      }
      case "tool_use":
        if (calls.length > 0) break;
      // falls through: a "tool_use" stop without tool blocks has nothing to run
      default: {
        await opts.hooks.run("Stop", {});
        yield { type: "stopped", reason: "end_turn" };
        return produced;
      }
    }

    // Tool events are yielded live while the tools run.
    const queue = new EventQueue<AgentEvent>();
    const running = executeCalls(calls, opts, (e) => queue.push(e)).then(
      (r) => {
        queue.close();
        return r;
      },
      (err) => {
        queue.close(err);
        throw err;
      },
    );
    running.catch(() => undefined); // surfaced by drain() below
    yield* queue.drain();
    const results = await running;
    // All tool_result blocks go back in ONE user message (keeps parallel tool use working).
    yield push({ role: "user", content: results });
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
    if (opts.signal.aborted) return err("Aborted by the user before this tool ran.");

    const tool = opts.tools.get(call.name);
    if (!tool) return err(`Unknown tool: ${call.name}`);

    let parsed = tool.input.safeParse(call.input);
    if (!parsed.success) return err(`Invalid input: ${parsed.error.message}`);

    const summarize = (v: unknown): string => {
      try {
        return tool.summarize?.(v) ?? JSON.stringify(v).slice(0, 200);
      } catch {
        return "";
      }
    };
    const argSummary = summarize(parsed.data);
    const decision = decide(opts.mode, opts.rules, { tool: call.name, risk: tool.risk, argSummary });
    if (decision.kind === "deny") return err(`Permission denied (${decision.reason})`);
    if (decision.kind === "ask") {
      emit({ type: "permission_request", id: call.id, name: call.name, input: parsed.data, risk: tool.risk, summary: argSummary });
      if (!(await opts.askPermission({ id: call.id, name: call.name, input: parsed.data }))) {
        return err("The user declined this action.");
      }
    }

    const hook = await opts.hooks.run("PreToolUse", { tool: call.name, input: parsed.data });
    if (hook.block) return err(`Blocked by hook: ${hook.block.reason}`);
    if (hook.updatedInput !== undefined) {
      parsed = tool.input.safeParse(hook.updatedInput);
      if (!parsed.success) return err(`Hook returned invalid input: ${parsed.error.message}`);
    }
    const input = parsed.data;

    emit({ type: "tool_start", id: call.id, name: call.name, input });
    const started = Date.now();
    let result: ToolResult;
    try {
      result = await tool.run(input, ctx);
    } catch (e) {
      result = { content: e instanceof Error ? e.message : String(e), isError: true };
    }
    if (call.name !== "read") result = await spillIfLarge(result, call.id, ctx, opts.spillThreshold ?? DEFAULT_SPILL_THRESHOLD);
    emit({ type: "tool_end", id: call.id, name: call.name, result, ms: Date.now() - started });

    const post = await opts.hooks.run("PostToolUse", { tool: call.name, input, result });
    const text = post.additionalContext ? `${result.content}\n\n[hook] ${post.additionalContext}` : result.content;
    return { type: "tool_result", tool_use_id: call.id, content: text, ...(result.isError ? { is_error: true } : {}) };
  };

  // Parallel-safe tools run concurrently; the rest run in order afterwards (A-002).
  const parallel = calls.filter((c) => opts.tools.get(c.name)?.parallelSafe);
  const serial = calls.filter((c) => !opts.tools.get(c.name)?.parallelSafe);
  const out = new Map<string, Anthropic.ToolResultBlockParam>();
  for (const r of await Promise.all(parallel.map(runOne))) out.set(r.tool_use_id, r);
  for (const c of serial) out.set(c.id, await runOne(c));
  return calls.map((c) => out.get(c.id)!);
}

/** H-021: huge outputs go to a file; the model gets the head plus instructions to page through it. */
async function spillIfLarge(result: ToolResult, toolUseId: string, ctx: ToolContext, threshold: number): Promise<ToolResult> {
  if (result.content.length <= threshold || !ctx.spillDir) return result;
  const dir = path.join(ctx.spillDir, ctx.sessionId.replace(/[^\w-]/g, "_"));
  const file = path.join(dir, `${toolUseId.replace(/[^\w-]/g, "_")}.txt`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, result.content, "utf8");
  const head = result.content.slice(0, 2000);
  return {
    isError: result.isError,
    spilledToPath: file,
    content: `${head}\n\n… [output was ${result.content.length} characters, too long to show. Full output saved to ${file} — use the read tool with offset/limit, or grep, to look at specific parts.]`,
  };
}
