import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookRunner } from "../hooks/index.js";
import { UNKNOWN_CAPABILITIES, type CompletionRequest, type MessageParam, type Provider, type ProviderEvent } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import { runTurn, type AgentEvent, type TurnOptions } from "./loop.js";

type Block = Record<string, unknown>;
const reply = (content: Block[], stop_reason: string) => ({
  id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const text = (t: string): Block => ({ type: "text", text: t });
const call = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });

/** A provider that plays back scripted responses and records every request. */
function fakeProvider(script: Array<ReturnType<typeof reply> | Error>, caps = UNKNOWN_CAPABILITIES): Provider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  let i = 0;
  return {
    requests,
    connection: { id: "c", presetId: "p", kind: "openai-compatible", label: "f", baseURL: "", extra: {}, models: [], capabilities: caps, createdAt: 0 },
    async *stream(req): AsyncIterable<ProviderEvent> {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const next = script[i++];
      if (!next) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      for (const b of next.content) {
        if (b.type === "text") yield { type: "text_delta", text: String(b.text) };
        if (b.type === "tool_use") yield { type: "tool_use_start", toolUseId: String(b.id), name: String(b.name) };
      }
      yield { type: "message", message: next as never };
    },
    async listModels() {
      return [];
    },
    async probe() {
      return UNKNOWN_CAPABILITIES;
    },
  };
}

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), "easily-loop-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

function opts(provider: Provider, tools: ToolRegistry, over: Partial<TurnOptions> = {}): TurnOptions {
  return {
    provider,
    model: "fake",
    system: "sys",
    tools,
    hooks: new HookRunner({}),
    mode: "ask",
    rules: { allow: [], deny: [] },
    toolContext: { cwd: dir, sessionId: "s", beforeWrite: async () => undefined, spillDir: path.join(dir, "spill") },
    askPermission: async () => true,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<AgentEvent, MessageParam[]>): Promise<{ events: AgentEvent[]; produced: MessageParam[] }> {
  const events: AgentEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { events, produced: r.value };
    events.push(r.value);
  }
}

function tool(name: string, run: Tool["run"], over: Partial<Tool> = {}): Tool {
  return { name, description: name, input: z.object({ v: z.string().optional() }), risk: "read", parallelSafe: true, run, ...over };
}

describe("runTurn", () => {
  it("runs a tool call and returns all results in ONE user message", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("a", async () => ({ content: "A" })));
    reg.register(tool("b", async () => ({ content: "B" })));
    const provider = fakeProvider([reply([text("ok"), call("1", "a", {}), call("2", "b", {})], "tool_use"), reply([text("done")], "end_turn")]);
    const history: MessageParam[] = [];
    const { events, produced } = await collect(runTurn(history, "go", opts(provider, reg)));

    const results = produced[2]!;
    expect(results.role).toBe("user");
    expect((results.content as unknown as Block[]).map((b) => [b.tool_use_id, b.content])).toEqual([["1", "A"], ["2", "B"]]);
    expect(produced.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(history).toEqual(produced);
    expect(events.at(-1)).toEqual({ type: "stopped", reason: "end_turn" });
    expect(events.filter((e) => e.type === "tool_pending")).toHaveLength(2);
  });

  it("yields tool events live, before slower tools finish", async () => {
    const reg = new ToolRegistry();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    reg.register(tool("fast", async () => ({ content: "f" })));
    reg.register(tool("slow", async () => (await gate, { content: "s" })));
    const provider = fakeProvider([reply([call("1", "fast", {}), call("2", "slow", {})], "tool_use"), reply([text("x")], "end_turn")]);
    const gen = runTurn([], "go", opts(provider, reg));
    const seen: string[] = [];
    for (;;) {
      const r = await gen.next();
      if (r.done) break;
      seen.push(r.value.type + (r.value.type === "tool_end" ? ":" + r.value.name : ""));
      if (r.value.type === "tool_end" && r.value.name === "fast") {
        expect(seen).not.toContain("tool_end:slow"); // fast result arrived while slow is still running
        release();
      }
    }
    expect(seen).toContain("tool_end:slow");
  });

  it("asks for permission on writes and reports a decline back to the model", async () => {
    const reg = new ToolRegistry();
    let ran = 0;
    reg.register(tool("w", async () => (ran++, { content: "wrote" }), { risk: "write", parallelSafe: false }));
    const provider = fakeProvider([reply([call("1", "w", {})], "tool_use"), reply([text("ok")], "end_turn")]);
    const { events, produced } = await collect(runTurn([], "go", opts(provider, reg, { askPermission: async () => false })));
    expect(ran).toBe(0);
    expect(events.some((e) => e.type === "permission_request")).toBe(true);
    expect((produced[2]!.content as unknown as Block[])[0]).toMatchObject({ is_error: true, content: "The user declined this action." });
  });

  it("plan mode denies writes without asking", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("w", async () => ({ content: "wrote" }), { risk: "write", parallelSafe: false }));
    const provider = fakeProvider([reply([call("1", "w", {})], "tool_use"), reply([text("ok")], "end_turn")]);
    const { events, produced } = await collect(runTurn([], "go", opts(provider, reg, { mode: "plan" })));
    expect(events.some((e) => e.type === "permission_request")).toBe(false);
    expect(JSON.stringify(produced[2])).toContain("plan mode is read-only");
  });

  it("validates tool input with zod and reports unknown tools", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("a", async () => ({ content: "A" }), { input: z.object({ n: z.number() }) }));
    const provider = fakeProvider([reply([call("1", "a", { n: "x" }), call("2", "ghost", {})], "tool_use"), reply([text("ok")], "end_turn")]);
    const { produced } = await collect(runTurn([], "go", opts(provider, reg)));
    const r = produced[2]!.content as unknown as Block[];
    expect(String(r[0]!.content)).toMatch(/Invalid input/);
    expect(r[1]!.content).toBe("Unknown tool: ghost");
  });

  it("auto-continues once after max_tokens, then surfaces it", async () => {
    const reg = new ToolRegistry();
    const provider = fakeProvider([reply([text("part one")], "max_tokens"), reply([text("part two")], "max_tokens")]);
    const { events, produced } = await collect(runTurn([], "go", opts(provider, reg)));
    expect(produced.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(events.at(-1)).toEqual({ type: "stopped", reason: "max_tokens" });
    expect(provider.requests).toHaveLength(2);
  });

  it("answers truncated tool calls after max_tokens so the history stays valid", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("a", async () => ({ content: "A" })));
    const provider = fakeProvider([reply([call("1", "a", {})], "max_tokens"), reply([text("retry ok")], "end_turn")]);
    const { produced } = await collect(runTurn([], "go", opts(provider, reg)));
    expect((produced[2]!.content as unknown as Block[])[0]).toMatchObject({ type: "tool_result", tool_use_id: "1", is_error: true });
  });

  it("surfaces refusals with the reason", async () => {
    const r = reply([text("no")], "refusal");
    (r as Record<string, unknown>).stop_details = { type: "refusal", category: "cyber", explanation: "policy" };
    const { events } = await collect(runTurn([], "go", opts(fakeProvider([r]), new ToolRegistry())));
    expect(events.at(-1)).toEqual({ type: "stopped", reason: "refusal", detail: "policy" });
  });

  it("re-sends after pause_turn", async () => {
    const provider = fakeProvider([reply([text("working")], "pause_turn"), reply([text("done")], "end_turn")]);
    const { events } = await collect(runTurn([], "go", opts(provider, new ToolRegistry())));
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.messages.at(-1)?.role).toBe("assistant");
    expect(events.at(-1)).toEqual({ type: "stopped", reason: "end_turn" });
  });

  it("stops on abort, still answering in-flight tool calls", async () => {
    const reg = new ToolRegistry();
    const ac = new AbortController();
    reg.register(tool("a", async (_i, ctx) => new Promise((res) => ctx.signal.addEventListener("abort", () => res({ content: "stopped", isError: true })))));
    const provider = fakeProvider([reply([call("1", "a", {})], "tool_use"), reply([text("never")], "end_turn")]);
    const p = collect(runTurn([], "go", opts(provider, reg, { signal: ac.signal })));
    setTimeout(() => ac.abort(), 50);
    const { events, produced } = await p;
    expect(events.at(-1)).toEqual({ type: "stopped", reason: "aborted" });
    expect(produced.at(-1)?.role).toBe("user"); // tool_result for the interrupted call is present
    expect(provider.requests).toHaveLength(1);
  });

  it("turns provider errors into a stopped:error event", async () => {
    const { events } = await collect(runTurn([], "go", opts(fakeProvider([new Error("boom sk-ant-abcdefghijklmnop")]), new ToolRegistry())));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: "stopped", reason: "error" });
    expect(JSON.stringify(last)).not.toContain("abcdefghijklmnop");
  });

  it("runs text-only when the connection has no tool support", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("a", async () => ({ content: "A" })));
    const provider = fakeProvider([reply([text("hi")], "end_turn")], { ...UNKNOWN_CAPABILITIES, tools: false });
    await collect(runTurn([], "go", opts(provider, reg)));
    expect(provider.requests[0]!.tools).toEqual([]);
  });

  it("spills huge tool output to disk and keeps the read tool exempt", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("big", async () => ({ content: "x".repeat(50_000) })));
    const provider = fakeProvider([reply([call("t/1", "big", {})], "tool_use"), reply([text("ok")], "end_turn")]);
    const { produced, events } = await collect(runTurn([], "go", opts(provider, reg)));
    const content = String((produced[2]!.content as unknown as Block[])[0]!.content);
    expect(content.length).toBeLessThan(5000);
    const end = events.find((e) => e.type === "tool_end");
    const spilled = end && end.type === "tool_end" ? end.result.spilledToPath : undefined;
    expect(spilled).toBeTruthy();
    expect((await readFile(spilled!, "utf8")).length).toBe(50_000);
  });
});
