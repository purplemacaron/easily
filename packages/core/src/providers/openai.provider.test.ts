import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "./openai.js";
import { UNKNOWN_CAPABILITIES, type Connection, type ProviderEvent } from "./types.js";

/** A tiny fake OpenAI-compatible server: /models, and /chat/completions (stream + tools). */
let server: Server;
let baseURL = "";
let rejectTools = false;
const seen: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ object: "list", data: [{ id: "b-model", object: "model" }, { id: "a-model", object: "model" }] }));
        return;
      }
      const json = JSON.parse(body || "{}") as Record<string, unknown>;
      seen.push(json);
      if (rejectTools && json.tools) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "tools not supported" } }));
        return;
      }
      if (json.stream) {
        res.setHeader("content-type", "text/event-stream");
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        send({ id: "x", model: "a-model", choices: [{ index: 0, delta: { role: "assistant", content: "Hi " } }] });
        send({ choices: [{ index: 0, delta: { content: "there" } }] });
        if (json.tools) {
          send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read", arguments: '{"path":"a"}' } }] } }] });
          send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
        } else {
          send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        }
        send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } });
        res.end("data: [DONE]\n\n");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "a-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

function conn(): Connection {
  return {
    id: "c",
    presetId: "custom-openai",
    kind: "openai-compatible",
    label: "t",
    baseURL,
    extra: {},
    models: [],
    capabilities: UNKNOWN_CAPABILITIES,
    createdAt: 0,
  };
}

describe("OpenAICompatibleProvider (against a local fake server)", () => {
  it("lists models sorted", async () => {
    const p = new OpenAICompatibleProvider(conn(), undefined);
    expect((await p.listModels()).map((m) => m.id)).toEqual(["a-model", "b-model"]);
  });

  it("streams deltas and ends with an Anthropic-shaped message", async () => {
    const p = new OpenAICompatibleProvider(conn(), "k");
    const events: ProviderEvent[] = [];
    for await (const e of p.stream({
      model: "a-model",
      system: "s",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "read", description: "r", input_schema: { type: "object", properties: {} } }],
      maxTokens: 100,
    })) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("")).toBe("Hi there");
    const last = events.at(-1);
    expect(last?.type).toBe("message");
    if (last?.type === "message") {
      expect(last.message.stop_reason).toBe("tool_use");
      expect(last.message.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
      expect(last.message.usage.input_tokens).toBe(12);
    }
    const req = seen.at(-1)!;
    expect(req.max_tokens).toBe(100);
    expect((req.messages as Array<{ role: string }>)[0]?.role).toBe("system");
  });

  it("probe marks tools=false when the endpoint rejects them", async () => {
    rejectTools = true;
    try {
      const caps = await new OpenAICompatibleProvider(conn(), undefined).probe("a-model");
      expect(caps.tools).toBe(false);
    } finally {
      rejectTools = false;
    }
    const caps = await new OpenAICompatibleProvider(conn(), undefined).probe("a-model");
    expect(caps.tools).toBe(true);
  });
});
