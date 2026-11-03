import { describe, expect, it } from "vitest";
import type { MessageParam } from "../types.js";
import { mapFinishReason, OpenAIStreamAssembler, toOpenAIMessages, toOpenAITools } from "./openai.js";

describe("toOpenAIMessages", () => {
  it("prepends the system prompt and keeps plain strings", () => {
    const out = toOpenAIMessages("sys", [{ role: "user", content: "hi" }]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("turns tool_use into tool_calls and drops thinking blocks", () => {
    const messages: MessageParam[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        ],
      },
    ];
    const [m] = toOpenAIMessages("", messages);
    expect(m).toMatchObject({
      role: "assistant",
      content: "Let me look.",
      tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: '{"path":"a.md"}' } }],
    });
  });

  it("uses null content for tool-call-only assistant messages", () => {
    const [m] = toOpenAIMessages("", [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] }]);
    expect((m as { content: unknown }).content).toBeNull();
  });

  it("emits tool results as role:tool messages before remaining user content", () => {
    const out = toOpenAIMessages("", [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "ok" },
          { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true },
          { type: "text", text: "thanks" },
        ],
      },
    ]);
    expect(out).toEqual([
      { role: "tool", tool_call_id: "t1", content: "ok" },
      { role: "tool", tool_call_id: "t2", content: "Error: boom" },
      { role: "user", content: "thanks" },
    ]);
  });

  it("converts base64 images to data URIs", () => {
    const out = toOpenAIMessages("", [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "text", text: "what is this" },
        ],
      },
    ]);
    expect(out[0]).toMatchObject({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "text", text: "what is this" },
      ],
    });
  });
});

describe("toOpenAITools", () => {
  it("wraps definitions as function tools", () => {
    const [t] = toOpenAITools([{ name: "read", description: "d", input_schema: { type: "object", properties: {} } }]);
    expect(t).toEqual({ type: "function", function: { name: "read", description: "d", parameters: { type: "object", properties: {} } } });
  });
});

describe("mapFinishReason", () => {
  it("maps the documented reasons", () => {
    expect(mapFinishReason("stop", false)).toBe("end_turn");
    expect(mapFinishReason("tool_calls", false)).toBe("tool_use");
    expect(mapFinishReason("length", false)).toBe("max_tokens");
    expect(mapFinishReason("content_filter", false)).toBe("refusal");
    expect(mapFinishReason(null, false)).toBe("end_turn");
  });
  it("prefers tool_use when tool calls are present even if the server says stop", () => {
    expect(mapFinishReason("stop", true)).toBe("tool_use");
  });
});

describe("OpenAIStreamAssembler", () => {
  it("assembles streamed text, tool calls and usage into an Anthropic message", () => {
    const a = new OpenAIStreamAssembler("m");
    const events = [
      ...a.push({ id: "c1", model: "m-1", choices: [{ delta: { content: "Hel" } }] }),
      ...a.push({ choices: [{ delta: { content: "lo" } }] }),
      ...a.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "read", arguments: '{"pa' } }] } }] }),
      ...a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] } }] }),
      ...a.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ...a.push({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 40 } } }),
    ];
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(2);
    expect(events.find((e) => e.type === "tool_use_start")).toMatchObject({ toolUseId: "call_a", name: "read" });

    const msg = a.finalMessage();
    expect(msg.stop_reason).toBe("tool_use");
    expect(msg.model).toBe("m-1");
    expect(msg.content).toEqual([
      expect.objectContaining({ type: "text", text: "Hello" }),
      expect.objectContaining({ type: "tool_use", id: "call_a", name: "read", input: { path: "x" } }),
    ]);
    expect(msg.usage.input_tokens).toBe(60);
    expect(msg.usage.cache_read_input_tokens).toBe(40);
    expect(msg.usage.output_tokens).toBe(7);
  });

  it("maps length to max_tokens and tolerates broken tool arguments", () => {
    const a = new OpenAIStreamAssembler("m");
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "t", arguments: "{oops" } }] }, finish_reason: "length" }] });
    const msg = a.finalMessage();
    expect(msg.content[0]).toMatchObject({ type: "tool_use", input: {} });

    const b = new OpenAIStreamAssembler("m");
    b.push({ choices: [{ delta: { content: "cut" }, finish_reason: "length" }] });
    expect(b.finalMessage().stop_reason).toBe("max_tokens");
  });
});
