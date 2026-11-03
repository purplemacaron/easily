import { describe, expect, it } from "vitest";
import type { SessionDetailDTO, SessionEventDTO, SessionMetaDTO } from "../../../shared/types";
import {
  EMPTY_TOTALS,
  addError,
  applyEvent,
  emptySession,
  fromDetail,
  markPermission,
  pendingPermissions,
  toolSummary,
  userTextOf,
  type LiveSession,
} from "./session-events";

const env = (event: SessionEventDTO, turnId = "t1") => ({ sessionId: "s1", turnId, ts: 0, event });
const run = (events: SessionEventDTO[], from: LiveSession = emptySession()) => events.reduce((s, e) => applyEvent(s, env(e)), from);

const meta: SessionMetaDTO = {
  id: "s1",
  title: "t",
  cwd: "/w",
  createdAt: 0,
  updatedAt: 0,
  mode: "ask",
  effort: "high",
  turnCount: 1,
  totals: EMPTY_TOTALS,
  todos: [],
  source: "user",
  running: false,
};

describe("applyEvent", () => {
  it("streams text deltas into one assistant item", () => {
    const s = run([
      { type: "turn_start", text: "hi" },
      { type: "text_delta", text: "안" },
      { type: "text_delta", text: "녕" },
    ]);
    expect(s.running).toBe(true);
    expect(s.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(s.items[1]).toMatchObject({ text: "안녕", live: true });
  });

  it("closes streaming text when a tool starts and opens a new item afterwards", () => {
    const s = run([
      { type: "turn_start", text: "x" },
      { type: "text_delta", text: "a" },
      { type: "tool_pending", id: "c1", name: "shell" },
      { type: "text_delta", text: "b" },
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(s.items[1]).toMatchObject({ text: "a", live: false });
  });

  it("tracks a tool call from pending to done with output and duration", () => {
    const s = run([
      { type: "tool_pending", id: "c1", name: "shell" },
      { type: "tool_start", id: "c1", name: "shell", input: { command: "ls" } },
      { type: "tool_end", id: "c1", name: "shell", result: { content: "a.txt" }, ms: 42 },
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "tool", status: "done", output: "a.txt", ms: 42, input: { command: "ls" } });
  });

  it("marks failed tools as errors", () => {
    const s = run([
      { type: "tool_start", id: "c1", name: "shell", input: {} },
      { type: "tool_end", id: "c1", name: "shell", result: { content: "boom", isError: true }, ms: 1 },
    ]);
    expect(s.items[0]).toMatchObject({ status: "error" });
  });

  it("adds a permission card once and lets it be answered", () => {
    const req: SessionEventDTO = { type: "permission_request", id: "p1", name: "shell", input: { command: "rm x" }, risk: "exec", summary: "rm x" };
    let s = run([req, req]);
    expect(pendingPermissions(s)).toHaveLength(1);
    s = markPermission(s, "p1", true);
    expect(pendingPermissions(s)).toHaveLength(0);
    expect(s.items[0]).toMatchObject({ kind: "permission", state: "allowed" });
  });

  it("falls back to the final message when the provider did not stream", () => {
    const s = run([
      { type: "turn_start", text: "q" },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
    ]);
    expect(s.items[1]).toMatchObject({ kind: "assistant", text: "answer", live: false });
  });

  it("does not duplicate streamed text when the final message arrives", () => {
    const s = run([
      { type: "turn_start", text: "q" },
      { type: "text_delta", text: "answer" },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
    ]);
    expect(s.items.filter((i) => i.kind === "assistant")).toHaveLength(1);
  });

  it("records cost, context and totals", () => {
    const totals = { ...EMPTY_TOTALS, costUsd: 0.5 };
    const s = run([{ type: "cost", model: "m", costUsd: 0.1, turnCostUsd: 0.1, session: totals, contextTokens: 1234, contextWindow: 200000 }]);
    expect(s.contextTokens).toBe(1234);
    expect(s.contextWindow).toBe(200000);
    expect(s.totals.costUsd).toBe(0.5);
    expect(s.lastTurnCost).toBe(0.1);
  });

  it("ends a turn with a footer carrying cost and the stop reason", () => {
    const s = run([
      { type: "turn_start", text: "q" },
      { type: "cost", model: "m", costUsd: 0.02, turnCostUsd: 0.02, session: EMPTY_TOTALS, contextTokens: 1 },
      { type: "stopped", reason: "refusal", detail: "정책상 거부" },
      { type: "turn_end", reason: "refusal" },
    ]);
    expect(s.running).toBe(false);
    expect(s.items[s.items.length - 1]).toMatchObject({ kind: "turn", costUsd: 0.02, reason: "refusal", detail: "정책상 거부" });
  });

  it("fails dangling tool calls and permission cards when a turn is aborted", () => {
    const s = run([
      { type: "tool_pending", id: "c1", name: "shell" },
      { type: "permission_request", id: "p1", name: "shell", input: {}, risk: "exec", summary: "x" },
      { type: "turn_end", reason: "aborted" },
    ]);
    expect(s.items.find((i) => i.kind === "tool")).toMatchObject({ status: "error" });
    expect(s.items.find((i) => i.kind === "permission")).toMatchObject({ state: "denied" });
  });

  it("keeps todos", () => {
    const s = run([{ type: "todos", todos: [{ content: "a", status: "in_progress" }] }]);
    expect(s.todos).toHaveLength(1);
  });

  it("appends send errors", () => {
    expect(addError(emptySession(), "연결된 모델이 없습니다.").items[0]).toMatchObject({ kind: "error" });
  });
});

describe("fromDetail", () => {
  const detail: SessionDetailDTO = {
    meta,
    messages: [
      // the extra trailing block is recalled memory, not the user's words
      { turnId: "t1", ts: 1, message: { role: "user", content: [{ type: "text", text: "파일 보여줘" }, { type: "text", text: "<memory>secret</memory>" }] } },
      {
        turnId: "t1",
        ts: 2,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "생각" },
            { type: "text", text: "확인할게요" },
            { type: "tool_use", id: "c1", name: "shell", input: { command: "ls" } },
          ],
        },
      },
      { turnId: "t1", ts: 3, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "a.txt", is_error: false }, { type: "text", text: "hook ctx" }] } },
      { turnId: "t1", ts: 4, message: { role: "assistant", content: "끝" } },
    ],
    usage: [
      { turnId: "t1", ts: 2, model: "m", usage: { input_tokens: 100, cache_read_input_tokens: 50 }, costUsd: 0.01 },
      { turnId: "t1", ts: 4, model: "m", usage: { input_tokens: 120, output_tokens: 5 }, costUsd: 0.02 },
    ],
    pendingPermissions: [{ id: "p9", name: "shell", input: {}, risk: "exec", summary: "x" }],
  };

  it("renders only the first text block of a user message", () => {
    const s = fromDetail(detail);
    const users = s.items.filter((i) => i.kind === "user");
    expect(users).toEqual([expect.objectContaining({ text: "파일 보여줘" })]);
    expect(JSON.stringify(s.items)).not.toContain("secret");
    expect(JSON.stringify(s.items)).not.toContain("hook ctx");
  });

  it("attaches tool results to their calls and sums the turn cost", () => {
    const s = fromDetail(detail);
    expect(s.items.find((i) => i.kind === "tool")).toMatchObject({ name: "shell", status: "done", output: "a.txt" });
    const foot = s.items.find((i) => i.kind === "turn");
    expect(foot).toMatchObject({ turnId: "t1" });
    expect((foot as { costUsd: number }).costUsd).toBeCloseTo(0.03);
    expect(s.contextTokens).toBe(120);
  });

  it("restores pending permission cards", () => {
    expect(pendingPermissions(fromDetail(detail))).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("userTextOf handles strings and tool-result messages", () => {
    expect(userTextOf("plain")).toBe("plain");
    expect(userTextOf([{ type: "tool_result", tool_use_id: "x", content: "y" }, { type: "text", text: "z" }])).toBeNull();
  });
  it("toolSummary prefers the meaningful field", () => {
    expect(toolSummary({ command: "ls -la", cwd: "/" })).toBe("ls -la");
    expect(toolSummary({ path: "a.md", content: "x" })).toBe("a.md");
    expect(toolSummary({ n: 1 })).toBe('{"n":1}');
    expect(toolSummary(undefined)).toBe("");
  });
});
