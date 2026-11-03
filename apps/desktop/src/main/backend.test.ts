import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryVault } from "@easily/core";
import type { PushChannel, PushPayloads } from "../shared/ipc";
import { createHandlers } from "./handlers";
import { createServices, type Services } from "./services";

/** Backend integration: real services + handlers, fake OpenAI-compatible server, no Electron. */
let server: Server;
let baseURL = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) return void res.end(JSON.stringify({ data: [{ id: "fake-1" }] }));
      const j = JSON.parse(body || "{}") as { stream?: boolean; messages: Array<{ role: string; content: unknown }> };
      if (!j.stream) return void res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "fake-1", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
      res.setHeader("content-type", "text/event-stream");
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const last = j.messages.at(-1)!;
      if (last.role === "tool") {
        send({ model: "fake-1", choices: [{ index: 0, delta: { content: "done: " + String(last.content) } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      } else if (String(last.content).includes("write")) {
        send({ model: "fake-1", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "write", arguments: '{"path":"out.txt","content":"hi"}' } }] } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        send({ model: "fake-1", choices: [{ index: 0, delta: { content: "plain" } }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

let dir: string;
let ws: string;
let svc: Services;
let h: ReturnType<typeof createHandlers>;
let pushes: Array<[string, unknown]>;
let loginItem: boolean | undefined;
const vault = new MemoryVault();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-be-"));
  ws = await mkdtemp(path.join(tmpdir(), "easily-bews-"));
  pushes = [];
  loginItem = undefined;
  svc = await createServices({
    dataDir: dir,
    vault,
    send: <C extends PushChannel>(c: C, p: PushPayloads[C]) => void pushes.push([c, p]),
    notify: () => undefined,
    hasCommand: () => false,
  });
  h = createHandlers(svc, {
    openExternal: async () => undefined,
    pickFolder: async () => null,
    setLoginItem: (o) => (loginItem = o),
    appInfo: () => ({ version: "0", platform: "test", secretsAvailable: true }),
  });
});
afterEach(async () => {
  await svc.shutdown();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await rm(ws, { recursive: true, force: true });
});
const bind = async () => {
  const c = await h["provider:connect"]({ presetId: "custom-openai", label: "fake", baseURL, extra: {} });
  await h["provider:setRole"]({ role: "main", connectionId: c.id, model: "fake-1" });
  return c;
};

describe("backend through the IPC handlers", () => {
  it("defaults: launch-at-login is OFF and settings round-trip", async () => {
    expect((await h["settings:get"]({})).launchAtLogin).toBe(false);
    const s = await h["settings:set"]({ theme: "dark", launchAtLogin: true, permissionMode: "auto-edit" });
    expect(s).toMatchObject({ theme: "dark", launchAtLogin: true, permissionMode: "auto-edit" });
    expect(loginItem).toBe(true);
    expect((await h["settings:set"]({ effort: "low" })).theme).toBe("dark"); // untouched keys survive
  });

  it("provider flow: connect → role → send, with permission card, checkpoint and rewind", async () => {
    await bind();
    const s = await h["session:create"]({ cwd: ws });
    const turn = h["session:send"]({ sessionId: s.id, text: "please write a file" });
    const deadline = Date.now() + 5000;
    let asked: { id: string; summary: string } | undefined;
    while (!asked && Date.now() < deadline) {
      const ev = pushes.map(([, p]) => p as { event: { type: string; id?: string; summary?: string } }).find((p) => p.event?.type === "permission_request");
      if (ev) asked = { id: ev.event.id!, summary: ev.event.summary! };
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(asked?.summary).toBe("out.txt");
    expect((await h["session:get"]({ sessionId: s.id })).pendingPermissions).toHaveLength(1);
    expect(await h["permission:answer"]({ requestId: asked!.id, allow: true })).toEqual({ found: true });

    const res = await turn;
    expect(res.reason).toBe("end_turn");
    expect(await readFile(path.join(ws, "out.txt"), "utf8")).toBe("hi");

    const detail = await h["session:get"]({ sessionId: s.id });
    expect(detail.meta.title).toBe("please write a file");
    expect(detail.messages.map((m) => m.message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(detail.pendingPermissions).toEqual([]);

    const cps = await h["session:checkpoints"]({ sessionId: s.id });
    const rewound = await h["session:rewind"]({ sessionId: s.id, turnId: cps[0]!.turnId });
    expect(rewound.removed).toEqual([path.join(ws, "out.txt")]);
  });

  it("never returns API keys to the renderer", async () => {
    const c = await h["provider:connect"]({ presetId: "custom-openai", label: "k", baseURL, apiKey: "sk-super-secret-value-9999", extra: {} });
    const listing = JSON.stringify(await h["provider:list"]({}));
    expect(listing).not.toContain("sk-super-secret");
    expect(c.keyLast4).toBe("9999");
    expect(JSON.stringify(c)).not.toContain("secret");
    await h["provider:delete"]({ connectionId: c.id });
    expect(vault.get(`conn:${c.id}`)).toBeUndefined();
  });

  it("deleting a connection clears the role bindings that used it", async () => {
    const c = await bind();
    await h["provider:delete"]({ connectionId: c.id });
    expect((await h["provider:list"]({})).roles).toEqual({});
  });

  it("memory CRUD", async () => {
    await h["memory:upsert"]({ name: "fact-one", description: "d", type: "user", body: "b" });
    expect((await h["memory:list"]({})).map((m) => m.name)).toEqual(["fact-one"]);
    expect(await h["memory:delete"]({ name: "fact-one" })).toEqual([]);
  });

  it("jobs: validate cron, schedule, list with next run, run now, delete", async () => {
    await bind();
    const input = { name: "j", enabled: true, trigger: { type: "cron" as const, expr: "0 9 * * 1-5" }, prompt: "say hi", cwd: ws, profile: { mode: "plan" as const, writableDirs: [], allowNetwork: false }, limits: { retries: 0 }, deliver: ["notify" as const], catchUp: true };
    await expect(h["jobs:create"]({ ...input, trigger: { type: "cron", expr: "nonsense" } })).rejects.toThrow();
    const job = await h["jobs:create"](input);
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
    expect(svc.scheduler.armed()).toEqual([job.id]);

    expect(await h["jobs:runNow"]({ jobId: job.id })).toEqual({ started: true });
    const deadline = Date.now() + 8000;
    let runs = await h["jobs:runs"]({ jobId: job.id });
    while (runs[0]?.status !== "ok" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      runs = await h["jobs:runs"]({ jobId: job.id });
    }
    expect(runs[0]).toMatchObject({ status: "ok", summary: "plain", reason: "manual" });
    expect(pushes.filter(([c]) => c === "job:event").map(([, e]) => (e as { type: string }).type)).toEqual(["run_start", "run_end"]);

    await h["jobs:update"]({ jobId: job.id, patch: { enabled: false } });
    expect(svc.scheduler.armed()).toEqual([]);
    await h["jobs:delete"]({ jobId: job.id });
    expect(await h["jobs:list"]({})).toEqual([]);
  });

  it("MCP: custom stdio server connects, exposes mcp__ tools, can be disabled and removed", async () => {
    const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/core/src/mcp/fixtures/echo-server.mjs");
    const added = await h["mcp:addCustom"]({ name: "Echo", command: process.execPath, args: [fixture] });
    expect(added.status).toMatchObject({ state: "connected", toolCount: 2 });
    expect(svc.tools.names()).toContain(`mcp__${added.id.replace(/[^a-zA-Z0-9_-]/g, "_")}__echo`);

    const off = await h["mcp:setEnabled"]({ serverId: added.id, enabled: false });
    expect(off.status.state).toBe("disabled");
    expect(svc.tools.names().filter((n) => n.startsWith("mcp__"))).toEqual([]);
    const on = await h["mcp:setEnabled"]({ serverId: added.id, enabled: true });
    expect(on.status.state).toBe("connected");

    await h["mcp:remove"]({ serverId: added.id });
    expect(await h["mcp:list"]({})).toEqual([]);
    expect(svc.tools.names().filter((n) => n.startsWith("mcp__"))).toEqual([]);
  }, 60_000);

  it("MCP catalog install: reports missing runtimes and unsupported OAuth entries; nothing is left behind", async () => {
    const cat = await h["mcp:catalog"]({});
    expect(cat.find((c) => c.id === "github")).toMatchObject({ supported: false });
    expect(cat.find((c) => c.id === "filesystem")?.runtime).toEqual({ command: "npx", available: false }); // hasCommand stubbed to false
    await expect(h["mcp:install"]({ catalogId: "filesystem", inputs: { folders: ws } })).rejects.toThrow(/npx/);
    await expect(h["mcp:install"]({ catalogId: "nope", inputs: {} })).rejects.toThrow();
    expect(await h["mcp:list"]({})).toEqual([]);
    expect(pushes.some(([c, p]) => c === "mcp:event" && (p as { type: string; state?: string }).state === "failed")).toBe(true);
  });

  it("app handlers", async () => {
    expect(await h["app:info"]({})).toMatchObject({ platform: "test", dataDir: dir });
    await expect(h["app:openExternal"]({ url: "file:///etc/passwd" })).rejects.toThrow();
  });
});
