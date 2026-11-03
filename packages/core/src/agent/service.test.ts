import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "../checkpoints/index.js";
import { JobRunner, type JobEvent } from "../scheduler/runner.js";
import { JobStore } from "../scheduler/store.js";
import { SessionStore } from "../session/store.js";
import { registerBuiltinTools } from "../tools/builtin/index.js";
import { ToolRegistry } from "../tools/registry.js";
import { UNKNOWN_CAPABILITIES, type Connection, type Provider, type ProviderEvent } from "../providers/types.js";
import { SessionService, type SessionEventEnvelope } from "./service.js";

type Reply = { content: Array<Record<string, unknown>>; stop_reason: string };
const msg = (r: Reply) => ({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", ...r, stop_sequence: null, stop_details: null, usage: { input_tokens: 1000, output_tokens: 100 } });

function scripted(replies: Reply[]): Provider {
  let i = 0;
  const connection: Connection = { id: "c", presetId: "anthropic", kind: "anthropic", label: "t", baseURL: "", extra: {}, models: [], capabilities: UNKNOWN_CAPABILITIES, createdAt: 0 };
  return {
    connection,
    async *stream(): AsyncIterable<ProviderEvent> {
      const r = replies[i++] ?? { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" };
      for (const b of r.content) if (b.type === "text") yield { type: "text_delta", text: String(b.text) };
      yield { type: "message", message: msg(r) as never };
    },
    listModels: async () => [],
    probe: async () => UNKNOWN_CAPABILITIES,
  };
}

let dir: string;
let ws: string;
let events: SessionEventEnvelope[];
let store: SessionStore;
let checkpoints: CheckpointStore;
let tools: ToolRegistry;

function service(replies: Reply[]) {
  const provider = scripted(replies);
  return new SessionService({
    store,
    checkpoints,
    tools,
    resolveModel: async () => ({ provider, connection: provider.connection, model: "claude-opus-5-5" }),
    settings: () => ({ rules: { allow: [], deny: [] }, hooks: {}, effort: "high" }),
    spillDir: path.join(dir, "spill"),
    onEvent: (e) => events.push(e),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-svc-"));
  ws = await mkdtemp(path.join(tmpdir(), "easily-ws-"));
  events = [];
  store = new SessionStore(path.join(dir, "sessions"));
  checkpoints = new CheckpointStore(path.join(dir, "checkpoints"));
  tools = new ToolRegistry();
  registerBuiltinTools(tools);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(ws, { recursive: true, force: true });
});

describe("SessionService", () => {
  it("persists messages, usage and cost, sets the title, and emits envelopes", async () => {
    const s = await store.create({ cwd: ws, mode: "ask" });
    const svc = service([{ content: [{ type: "text", text: "hello there" }], stop_reason: "end_turn" }]);
    const res = await svc.send(s.id, "안녕하세요 요약해줘");
    expect(res.reason).toBe("end_turn");
    expect(res.text).toBe("hello there");
    expect(res.costUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6);

    const msgs = await store.messages(s.id);
    expect(msgs.map((m) => m.message.role)).toEqual(["user", "assistant"]);
    const meta = (await store.get(s.id))!;
    expect(meta.title).toBe("안녕하세요 요약해줘");
    expect(meta.turnCount).toBe(1);
    expect(meta.totals.costUsd).toBeCloseTo(res.costUsd);

    const types = events.map((e) => e.event.type);
    expect(types[0]).toBe("turn_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("cost");
    expect(types.at(-1)).toBe("turn_end");
    expect(new Set(events.map((e) => e.turnId)).size).toBe(1);
  });

  it("asks the UI for permission, applies 'always allow', and checkpoints writes", async () => {
    const s = await store.create({ cwd: ws, mode: "ask" });
    const write = (id: string, p: string) => ({ content: [{ type: "tool_use", id, name: "write", input: { path: p, content: p } }], stop_reason: "tool_use" });
    const svc = service([write("w1", "a.txt"), write("w2", "b.txt"), { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }]);

    const answered: string[] = [];
    const answerer = setInterval(() => {
      for (const e of events) {
        if (e.event.type === "permission_request" && !answered.includes(e.event.id)) {
          answered.push(e.event.id);
          svc.answerPermission(e.event.id, true, e.event.id === "w1"); // "always" on the first
        }
      }
    }, 10);
    const res = await svc.send(s.id, "write two files");
    clearInterval(answerer);

    expect(res.reason).toBe("end_turn");
    expect(answered).toEqual(["w1"]); // the second write was covered by the session rule
    expect(await readFile(path.join(ws, "b.txt"), "utf8")).toBe("b.txt");
    const cps = await checkpoints.list(s.id);
    expect(cps[0]?.turnId).toBe(res.turnId);
    await svc.rewind(s.id, res.turnId);
    await expect(readFile(path.join(ws, "a.txt"), "utf8")).rejects.toThrow();
  });

  it("abort resolves pending permission prompts and ends the turn as aborted", async () => {
    const s = await store.create({ cwd: ws, mode: "ask" });
    const svc = service([{ content: [{ type: "tool_use", id: "w1", name: "write", input: { path: "x.txt", content: "x" } }], stop_reason: "tool_use" }]);
    const p = svc.send(s.id, "go");
    await new Promise((r) => setTimeout(r, 200));
    expect(svc.isRunning(s.id)).toBe(true);
    svc.abort(s.id);
    const res = await p;
    expect(res.reason).toBe("aborted");
    expect(svc.isRunning(s.id)).toBe(false);
  });

  it("refuses to run two turns at once and reports a missing session", async () => {
    const svc = service([]);
    await expect(svc.send("nope", "x")).rejects.toThrow(/not found/);
  });

  it("enforces a USD budget", async () => {
    const s = await store.create({ cwd: ws, mode: "auto-edit" });
    const loopTool = { content: [{ type: "tool_use", id: "t", name: "glob", input: { pattern: "*" } }], stop_reason: "tool_use" };
    const svc = service([loopTool, loopTool, loopTool, loopTool]);
    const res = await svc.send(s.id, "go", { maxUsd: 0.005 });
    expect(res.reason).toBe("budget");
  });
});

describe("JobRunner", () => {
  it("runs a job headlessly in plan mode, records history, notifies, and denies writes", async () => {
    const jobs = new JobStore(path.join(dir, "data"));
    const job = await jobs.create({
      name: "daily",
      enabled: true,
      trigger: { type: "cron", expr: "30 8 * * 1-5" },
      prompt: "write a file",
      cwd: ws,
      profile: { mode: "plan", writableDirs: [], allowNetwork: false },
      limits: { retries: 0 },
      deliver: ["notify"],
      catchUp: true,
    });
    const svc = service([
      { content: [{ type: "tool_use", id: "w", name: "write", input: { path: "out.md", content: "x" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "could not write; here is the summary" }], stop_reason: "end_turn" },
    ]);
    const jobEvents: JobEvent[] = [];
    const notified: string[] = [];
    const runner = new JobRunner({ jobs, sessions: store, service: svc, checkpoints, onEvent: (e) => jobEvents.push(e), notify: (r) => notified.push(r.status) });

    const run = await runner.run(job.id, "manual");
    expect(run?.status).toBe("ok");
    expect(run?.summary).toContain("summary");
    await expect(readFile(path.join(ws, "out.md"), "utf8")).rejects.toThrow(); // plan = read-only
    expect(notified).toEqual(["ok"]);
    expect(jobEvents.map((e) => e.type)).toEqual(["run_start", "run_end"]);
    expect((await jobs.listRuns(job.id))[0]?.status).toBe("ok");
    expect((await jobs.get(job.id))?.lastRunAt).toBeTruthy();
    const sessions = await store.list();
    expect(sessions[0]).toMatchObject({ source: "job", jobId: job.id });
  });

  it("auto-edit profile may write inside cwd but shell is denied without a human", async () => {
    const jobs = new JobStore(path.join(dir, "data"));
    const job = await jobs.create({
      name: "writer", enabled: true, trigger: { type: "once", at: Date.now() + 1e9 }, prompt: "go", cwd: ws,
      profile: { mode: "auto-edit", writableDirs: [], allowNetwork: false }, limits: { retries: 0 }, deliver: [], catchUp: false,
    });
    const svc = service([
      { content: [{ type: "tool_use", id: "w", name: "write", input: { path: "out.md", content: "hi" } }, { type: "tool_use", id: "s", name: "shell", input: { command: "echo hi" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ]);
    const runner = new JobRunner({ jobs, sessions: store, service: svc, checkpoints, onEvent: () => undefined });
    const run = await runner.run(job.id, "manual");
    expect(await readFile(path.join(ws, "out.md"), "utf8")).toBe("hi");
    expect(run?.changedFiles).toEqual([path.join(ws, "out.md")]);
    const sid = run!.sessionId!;
    const results = JSON.stringify((await store.messages(sid)).map((m) => m.message));
    expect(results).toContain("The user declined this action.");
  });

  it("does not overlap a job with itself", async () => {
    const jobs = new JobStore(path.join(dir, "data"));
    const job = await jobs.create({ name: "x", enabled: true, trigger: { type: "app_start" }, prompt: "go", cwd: ws, profile: { mode: "plan", writableDirs: [], allowNetwork: false }, limits: { retries: 0 }, deliver: [], catchUp: false });
    await writeFile(path.join(ws, "f"), "");
    const svc = service([{ content: [{ type: "text", text: "a" }], stop_reason: "end_turn" }]);
    const runner = new JobRunner({ jobs, sessions: store, service: svc, checkpoints, onEvent: () => undefined });
    const [a, b] = await Promise.all([runner.run(job.id, "manual"), runner.run(job.id, "manual")]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
