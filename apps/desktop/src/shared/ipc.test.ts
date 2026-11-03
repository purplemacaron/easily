import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "./channels";
import { IPC, JobInput } from "./ipc";

describe("IPC contract", () => {
  it("the preload allow-list matches the zod map exactly", () => {
    expect([...INVOKE_CHANNELS].sort()).toEqual(Object.keys(IPC).sort());
  });

  it("push channels are the four documented ones", () => {
    expect([...PUSH_CHANNELS].sort()).toEqual(["deeplink", "job:event", "mcp:event", "session:event"]);
  });

  it("rejects malformed payloads", () => {
    expect(IPC["session:send"].safeParse({ sessionId: "s", text: "" }).success).toBe(false);
    expect(IPC["app:openExternal"].safeParse({ url: "not a url" }).success).toBe(false);
    expect(IPC["provider:setRole"].safeParse({ role: "main", connectionId: null }).success).toBe(true);
    expect(JobInput.safeParse({ name: "x" }).success).toBe(false);
  });
});
