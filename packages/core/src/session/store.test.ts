import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeCostUsd } from "../providers/cost.js";
import { SessionStore } from "./store.js";

let dir: string;
let store: SessionStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-sessions-"));
  store = new SessionStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("SessionStore", () => {
  it("creates, lists (newest first), renames and deletes", async () => {
    const a = await store.create({ cwd: "/w", mode: "ask" });
    const b = await store.create({ cwd: "/w", mode: "plan", title: "Second" });
    await store.update(a.id, { title: "Renamed" });
    const list = await store.list();
    expect(list.map((s) => s.title)).toEqual(["Renamed", "Second"]);
    await store.delete(b.id);
    expect(await store.get(b.id)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it("appends messages in order and survives a torn last line", async () => {
    const s = await store.create({ cwd: "/w", mode: "ask" });
    await store.appendMessage(s.id, "t1", { role: "user", content: "hi" });
    await store.appendMessage(s.id, "t1", { role: "assistant", content: [{ type: "text", text: "hello" }] });
    await appendFile(path.join(dir, `${s.id}.jsonl`), '{"t":"msg","turn');
    const msgs = await store.messages(s.id);
    expect(msgs.map((m) => m.message.role)).toEqual(["user", "assistant"]);
    expect(msgs[0]?.turnId).toBe("t1");
  });

  it("accumulates usage and cost per session; unpriced models are counted, not guessed", async () => {
    const s = await store.create({ cwd: "/w", mode: "ask" });
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 };
    await store.appendUsage(s.id, { turnId: "t1", ts: 1, model: "claude-opus-5-5", usage, costUsd: computeCostUsd("claude-opus-5-5", usage) });
    await store.appendUsage(s.id, { turnId: "t1", ts: 2, model: "mystery", usage, costUsd: computeCostUsd("mystery", usage) });
    const meta = (await store.get(s.id))!;
    expect(meta.totals.costUsd).toBeCloseTo(4 + 2); // $4/M input + $20/M output * 0.1M
    expect(meta.totals.unpricedCalls).toBe(1);
    expect(meta.totals.inputTokens).toBe(2_000_000);
    expect(await store.usage(s.id)).toHaveLength(2);
  });

  it("rejects ids that could escape the directory", async () => {
    await expect(store.get("../x")).resolves.toBeNull();
    await expect(store.appendMessage("../x", "t", { role: "user", content: "x" })).rejects.toThrow(/Invalid session id/);
  });
});
