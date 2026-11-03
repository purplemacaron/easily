// Tiny OpenAI-compatible server for driving the app by hand or over CDP (no network, no key).
//   node scripts/fake-openai.mjs [port]      → http://127.0.0.1:4599/v1
// A user message mentioning "hello.txt" makes it call the `write` tool once; after the tool
// result it answers with a short markdown reply. "느리게" streams slowly (to test Esc/abort).
// Anything else gets a plain streamed reply.
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const port = Number(process.argv[2] ?? process.env.FAKE_PORT ?? 4599);
const MODEL = "fake-model";

function plan(body) {
  const msgs = body.messages ?? [];
  const last = msgs[msgs.length - 1];
  const hasTools = Array.isArray(body.tools) && body.tools.some((t) => t.function?.name === "write");
  if (last?.role === "tool") {
    return {
      text: "`hello.txt` 파일을 만들었습니다.\n\n- 경로: `hello.txt`\n- 내용: `hello`\n\n| 항목 | 값 |\n|---|---|\n| 크기 | 5 B |\n\n```txt\nhello\n```",
    };
  }
  if (hasTools && last?.role === "user" && typeof last.content === "string" && last.content.includes("hello.txt")) {
    return {
      text: "파일을 만들겠습니다.",
      tool: { id: "call_1", name: "write", args: JSON.stringify({ path: "hello.txt", content: "hello" }) },
    };
  }
  if (last?.role === "user" && typeof last.content === "string" && last.content.includes("느리게")) {
    return { text: "천천히 ".repeat(60), slow: true };
  }
  return { text: "안녕하세요! 무엇을 도와드릴까요?" };
}

const chunk = (delta, finish = null) => ({
  id: "chatcmpl-fake",
  object: "chat.completion.chunk",
  created: 0,
  model: MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

async function stream(res, p) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send(chunk({ role: "assistant", content: "" }));
  const words = p.text.match(/\S+\s*/g) ?? [];
  for (const w of words) {
    send(chunk({ content: w }));
    await sleep(p.slow ? 250 : 25);
    if (res.destroyed || res.writableEnded) return;
  }
  if (p.tool) {
    send(chunk({ tool_calls: [{ index: 0, id: p.tool.id, type: "function", function: { name: p.tool.name, arguments: "" } }] }));
    send(chunk({ tool_calls: [{ index: 0, function: { arguments: p.tool.args } }] }));
  }
  send(chunk({}, p.tool ? "tool_calls" : "stop"));
  send({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL, choices: [], usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 } });
  res.end("data: [DONE]\n\n");
}

function whole(res, p) {
  const message = { role: "assistant", content: p.text };
  if (p.tool) message.tool_calls = [{ id: p.tool.id, type: "function", function: { name: p.tool.name, arguments: p.tool.args } }];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-fake",
      object: "chat.completion",
      created: 0,
      model: MODEL,
      choices: [{ index: 0, message, finish_reason: p.tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 },
    }),
  );
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model", created: 0, owned_by: "fake" }] }));
    return;
  }
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // fall through with an empty body
      }
      const p = plan(body);
      if (body.stream) void stream(res, p);
      else whole(res, p);
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `not found: ${url.pathname}` } }));
}).listen(port, "127.0.0.1", () => console.log(`fake openai listening on http://127.0.0.1:${port}/v1`));
