import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import { UNKNOWN_CAPABILITIES, type Connection, type ProviderEvent } from "./types.js";

let server: Server;
let baseURL = "";
const bodies: Array<Record<string, unknown>> = [];
const headers: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as Record<string, unknown>;
      bodies.push(body);
      headers.push(req.headers);
      res.setHeader("content-type", "text/event-stream");
      const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", {
        message: {
          id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello" } });
      ev("content_block_stop", { index: 0 });
      ev("content_block_start", { index: 1, content_block: { type: "tool_use", id: "tu_1", name: "read", input: {} } });
      ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } });
      ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '"a.md"}' } });
      ev("content_block_stop", { index: 1 });
      ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } });
      ev("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

function conn(kind: Connection["kind"], extra: Record<string, string> = {}): Connection {
  return { id: "c", presetId: "p", kind, label: "t", baseURL, extra, models: [], capabilities: UNKNOWN_CAPABILITIES, createdAt: 0 };
}

const req = {
  model: "claude-opus-5-5",
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  tools: [{ name: "read", description: "r", input_schema: { type: "object" as const, properties: {} } }],
  maxTokens: 1000,
  effort: "high" as const,
};

async function collect(p: AnthropicProvider): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of p.stream(req)) out.push(e);
  return out;
}

describe("AnthropicProvider (against a local fake SSE server)", () => {
  it("official kind: streams events, sends adaptive thinking + effort + eager tool streaming, no sampling params", async () => {
    const events = await collect(new AnthropicProvider(conn("anthropic"), "sk-test"));
    expect(events.map((e) => e.type)).toEqual([
      "text_delta", "tool_use_start", "tool_input_delta", "tool_input_delta", "message",
    ]);
    const last = events.at(-1);
    if (last?.type === "message") {
      expect(last.message.stop_reason).toBe("tool_use");
      expect(last.message.content[1]).toMatchObject({ type: "tool_use", input: { path: "a.md" } });
    }
    const body = bodies.at(-1)!;
    expect(body.thinking).toMatchObject({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect((body.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ eager_input_streaming: true });
    for (const k of ["temperature", "top_p", "tool_choice"]) expect(body).not.toHaveProperty(k);
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(headers.at(-1)?.authorization).toBe("Bearer sk-test");
  });

  it("anthropic-compatible: no thinking/effort/eager streaming unless probed; bearer auth honoured", async () => {
    await collect(new AnthropicProvider(conn("anthropic-compatible", { authStyle: "bearer" }), "tok"));
    const body = bodies.at(-1)!;
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("output_config");
    expect((body.tools as Array<Record<string, unknown>>)[0]).not.toHaveProperty("eager_input_streaming");
    expect(headers.at(-1)?.authorization).toBe("Bearer tok");
    expect(headers.at(-1)?.["x-api-key"]).toBeUndefined();
  });

  it("anthropic-compatible default auth style sends x-api-key", async () => {
    await collect(new AnthropicProvider(conn("anthropic-compatible"), "key1"));
    expect(headers.at(-1)?.["x-api-key"]).toBe("key1");
    expect(headers.at(-1)?.authorization).toBeUndefined();
  });
});
