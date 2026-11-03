import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryVault, ProviderHub } from "./hub.js";

let server: Server;
let baseURL = "";
let unauthorized = false;
beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (unauthorized) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        return void res.end(JSON.stringify({ error: { message: "bad key" } }));
      }
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) return void res.end(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }));
      res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "m1", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

let dir: string;
let vault: MemoryVault;
let hub: ProviderHub;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-hub-"));
  vault = new MemoryVault();
  unauthorized = false;
  hub = new ProviderHub(dir, vault, () => ({}));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("ProviderHub", () => {
  it("connects a custom OpenAI-compatible endpoint: lists models, probes, stores the key only in the vault", async () => {
    const c = await hub.connect({ presetId: "custom-openai", label: "Local", baseURL, apiKey: "sk-secret-1234567890abcd", extra: {} });
    expect(c.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(c.capabilities.tools).toBe(true);
    expect(c.keyLast4).toBe("abcd");
    expect(JSON.stringify(c)).not.toContain("sk-secret");
    expect(await readFile(path.join(dir, "connections.json"), "utf8")).not.toContain("sk-secret");
    expect(vault.get(c.secretRef!)).toBe("sk-secret-1234567890abcd");
    expect((await hub.list()).map((x) => x.label)).toEqual(["Local"]);
  });

  it("rejects bad credentials and leaves nothing behind", async () => {
    unauthorized = true;
    await expect(hub.connect({ presetId: "custom-openai", label: "x", baseURL, apiKey: "sk-wrong-key-123456", extra: {} })).rejects.toThrow();
    expect(await hub.list()).toEqual([]);
  });

  it("validates presets, required keys and base URLs", async () => {
    await expect(hub.connect({ presetId: "nope", label: "x", baseURL: "", extra: {} })).rejects.toThrow(/Unknown/);
    await expect(hub.connect({ presetId: "openrouter", label: "x", baseURL: "", extra: {} })).rejects.toThrow(/API 키/);
    await expect(hub.connect({ presetId: "custom-openai", label: "x", baseURL: "", extra: {} })).rejects.toThrow(/Base URL/);
  });

  it("tests a connection (latency + models) and resolves roles", async () => {
    const c = await hub.connect({ presetId: "custom-openai", label: "Local", baseURL, extra: {} });
    const t = await hub.test(c.id);
    expect(t.ok).toBe(true);
    expect(t.models).toHaveLength(2);
    expect(t.latencyMs).toBeGreaterThanOrEqual(0);

    const bound = new ProviderHub(dir, vault, () => ({ main: { connectionId: c.id, model: "m2" } }));
    const r = await bound.resolve("main");
    expect(r.model).toBe("m2");
    expect((await bound.resolve("fast")).model).toBe("m2"); // falls back to main
    await expect(new ProviderHub(dir, vault, () => ({ main: { connectionId: "gone", model: "x" } })).resolve("main")).rejects.toThrow(/삭제/);

    await hub.remove(c.id);
    expect(await hub.list()).toEqual([]);
    await expect(hub.resolve("main")).rejects.toThrow(/연결된 모델이 없습니다/);
  });

  it("defaults the three roles for an Anthropic connection to the documented model IDs", async () => {
    const { ANTHROPIC_DEFAULT_MODELS } = await import("./anthropic.js");
    // Write the connection file directly: creating one would need the real Anthropic API.
    const conn = { id: "a", presetId: "anthropic", kind: "anthropic", label: "A", baseURL: "", secretRef: "conn:a", extra: {}, models: [], capabilities: { streaming: true, tools: true, parallelTools: true, vision: true, thinking: true, promptCaching: true, serverTools: true }, createdAt: 1 };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "connections.json"), JSON.stringify({ connections: [conn] }));
    vault.set("conn:a", "sk-ant-test");
    expect((await hub.resolve("main")).model).toBe(ANTHROPIC_DEFAULT_MODELS.main);
    expect((await hub.resolve("fast")).model).toBe(ANTHROPIC_DEFAULT_MODELS.fast);
    expect((await hub.resolve("subagent")).model).toBe(ANTHROPIC_DEFAULT_MODELS.subagent);
  });
});
