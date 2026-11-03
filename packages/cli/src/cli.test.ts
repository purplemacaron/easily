import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Runs the real CLI entry (via tsx) against a fake Anthropic Messages server. */
let server: Server;
let baseURL = "";
const requests: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw || "{}") as Record<string, unknown>);
      res.setHeader("content-type", "text/event-stream");
      const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1_000_000, output_tokens: 1 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello from the fake model" } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      ev("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

function run(args: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: undefined, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe("easily CLI", () => {
  it("exits 2 with usage when no prompt is given", async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  it("exits 1 without ANTHROPIC_API_KEY", async () => {
    const r = await run(["-p", "hi"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY");
  });

  it("rejects an unknown mode", async () => {
    expect((await run(["-p", "hi", "--mode", "chaos"], { ANTHROPIC_API_KEY: "k" })).code).toBe(2);
  });

  it("prints the model's answer (text mode) using the default model", async () => {
    const r = await run(["-p", "say hello"], { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: baseURL });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Hello from the fake model");
    const body = requests.at(-1)!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.thinking).toMatchObject({ type: "adaptive" });
    expect((body.tools as unknown[]).length).toBeGreaterThan(0);
  }, 30_000);

  it("--json emits NDJSON events and a final result line with cost", async () => {
    const r = await run(["-p", "say hello", "--json", "--cwd", "."], { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: baseURL });
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as { type: string; text?: string; reason?: string; costUsd?: number });
    expect(lines.some((l) => l.type === "text_delta")).toBe(true);
    const result = lines.at(-1)!;
    expect(result).toMatchObject({ type: "result", reason: "end_turn", text: "Hello from the fake model" });
    expect(result.costUsd).toBeGreaterThan(4); // 1M input tokens at $4/M
  }, 30_000);
});
