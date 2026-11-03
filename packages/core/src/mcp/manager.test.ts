import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { McpManager, toolNameFor } from "./manager.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, "fixtures", "echo-server.mjs");

const registry = new ToolRegistry();
const manager = new McpManager(registry);
afterAll(() => manager.closeAll());

describe("McpManager (real stdio server)", () => {
  it("connects, health-checks with tools/list and registers mcp__<server>__<tool> tools", async () => {
    const status = await manager.connect({ id: "echo", name: "Echo", spec: { type: "stdio", command: process.execPath, args: [server] } });
    expect(status.state).toBe("connected");
    expect(status.toolCount).toBe(2);
    expect(status.latencyMs).toBeLessThan(20_000);
    expect(registry.names()).toEqual(["mcp__echo__echo", "mcp__echo__fail"]);
    const def = registry.definitions().find((d) => d.name === "mcp__echo__echo")!;
    expect(def.input_schema).toMatchObject({ type: "object", properties: { msg: { type: "string" } } });
  }, 60_000);

  it("calls tools through the registry entry (risk network)", async () => {
    const tool = registry.get("mcp__echo__echo")!;
    expect(tool.risk).toBe("network");
    const ac = new AbortController();
    const ctx = { cwd: ".", sessionId: "s", signal: ac.signal, beforeWrite: async () => undefined };
    expect(await tool.run({ msg: "hi" }, ctx)).toEqual({ content: "echo: hi", isError: false });
    expect((await registry.get("mcp__echo__fail")!.run({}, ctx)).isError).toBe(true);
  });

  it("removes tools on disconnect", async () => {
    await manager.disconnect("echo");
    expect(registry.names()).toEqual([]);
    expect(manager.status()).toEqual([]);
  });

  it("reports a missing executable as an error status instead of throwing", async () => {
    const status = await manager.connect({ id: "bad", name: "Bad", spec: { type: "stdio", command: "definitely-not-a-real-command-xyz", args: [] } });
    expect(status.state).toBe("error");
    expect(status.error).toBeTruthy();
  }, 30_000);

  it("sanitises tool names to the API pattern and length", () => {
    expect(toolNameFor("my server", "do.thing")).toBe("mcp__my_server__do_thing");
    expect(toolNameFor("s", "x".repeat(100))).toHaveLength(64);
  });
});
