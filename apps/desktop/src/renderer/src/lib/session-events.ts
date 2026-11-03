/**
 * Pure transcript model for one session: builds chat items from stored messages (`session:get`)
 * and folds live `session:event` pushes into them. No React, no IPC — unit tested.
 */
import type {
  ContentBlockDTO,
  PermissionRequestDTO,
  SessionDetailDTO,
  SessionEventEnvelopeDTO,
  TodoDTO,
  ToolRisk,
  TotalsDTO,
  TurnReason,
  UsageRecordDTO,
} from "../../../shared/types";

export type ToolStatus = "pending" | "running" | "done" | "error";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; live: boolean }
  | { kind: "thinking"; id: string; text: string; live: boolean }
  | { kind: "tool"; id: string; name: string; input?: unknown; status: ToolStatus; output?: string; ms?: number }
  | { kind: "permission"; id: string; name: string; input: unknown; risk: ToolRisk; summary: string; state: "pending" | "allowed" | "denied" }
  | { kind: "turn"; id: string; turnId: string; costUsd: number | null; reason?: TurnReason; detail?: string }
  | { kind: "error"; id: string; text: string };

export interface LiveSession {
  items: ChatItem[];
  running: boolean;
  turnId?: string;
  sawText: boolean;
  sawThinking: boolean;
  contextTokens: number;
  contextWindow?: number;
  totals: TotalsDTO;
  todos: TodoDTO[];
  lastTurnCost: number | null;
  stopped?: { reason: TurnReason; detail?: string };
  seq: number;
}

export const EMPTY_TOTALS: TotalsDTO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedCalls: 0 };

export function emptySession(): LiveSession {
  return {
    items: [],
    running: false,
    sawText: false,
    sawThinking: false,
    contextTokens: 0,
    totals: EMPTY_TOTALS,
    todos: [],
    lastTurnCost: null,
    seq: 0,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

type NewItem = ChatItem extends infer T ? (T extends { id: string } ? Omit<T, "id"> & { id?: string } : never) : never;

/** Append an item, closing the previous streaming item if it is of another kind. */
function push(s: LiveSession, item: NewItem): LiveSession {
  const seq = s.seq + 1;
  const items = s.items.slice();
  const last = items[items.length - 1];
  if (last && (last.kind === "assistant" || last.kind === "thinking") && last.live && last.kind !== item.kind) {
    items[items.length - 1] = { ...last, live: false };
  }
  items.push({ ...item, id: item.id ?? `${item.kind}-${seq}` } as ChatItem);
  return { ...s, items, seq };
}

function patchItem(s: LiveSession, index: number, patch: Partial<ChatItem>): LiveSession {
  const items = s.items.slice();
  items[index] = { ...items[index], ...patch } as ChatItem;
  return { ...s, items };
}

function findTool(s: LiveSession, id: string): number {
  return s.items.findIndex((i) => i.kind === "tool" && i.id === id);
}

function closeLive(s: LiveSession): LiveSession {
  if (!s.items.some((i) => (i.kind === "assistant" || i.kind === "thinking") && i.live)) return s;
  return { ...s, items: s.items.map((i) => ((i.kind === "assistant" || i.kind === "thinking") && i.live ? { ...i, live: false } : i)) };
}

/** Text of a tool_result `content` (string or array of text blocks). */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

export function userTextOf(content: string | ContentBlockDTO[]): string | null {
  if (typeof content === "string") return content;
  // Extra trailing text blocks are recalled memory / hook context — only the first one is the user's words.
  if (content.some((b) => b.type === "tool_result")) return null;
  const first = content.find((b) => b.type === "text");
  return first && typeof first.text === "string" ? first.text : null;
}

export function inputTokensOf(u: UsageRecordDTO["usage"]): number {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}

// ── stored history ───────────────────────────────────────────────────────

export function fromDetail(detail: SessionDetailDTO): LiveSession {
  let s = emptySession();
  s = { ...s, totals: detail.meta.totals, todos: detail.meta.todos, running: detail.meta.running };

  const costByTurn = new Map<string, { usd: number; priced: boolean }>();
  for (const u of detail.usage) {
    const cur = costByTurn.get(u.turnId) ?? { usd: 0, priced: false };
    if (u.costUsd !== null) {
      cur.usd += u.costUsd;
      cur.priced = true;
    }
    costByTurn.set(u.turnId, cur);
  }
  const lastUsage = detail.usage[detail.usage.length - 1];
  if (lastUsage) s = { ...s, contextTokens: inputTokensOf(lastUsage.usage) };

  const msgs = detail.messages;
  msgs.forEach((m, idx) => {
    const blocks: ContentBlockDTO[] = typeof m.message.content === "string" ? [{ type: "text", text: m.message.content }] : m.message.content;
    if (m.message.role === "user") {
      for (const b of blocks) {
        if (b.type !== "tool_result") continue;
        const at = findTool(s, String(b.tool_use_id));
        if (at >= 0) s = patchItem(s, at, { status: b.is_error ? "error" : "done", output: resultText(b.content) });
      }
      const text = userTextOf(m.message.content);
      if (text !== null) s = push(s, { kind: "user", text });
    } else {
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string" && b.text) s = push(s, { kind: "assistant", text: b.text, live: false });
        else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking) s = push(s, { kind: "thinking", text: b.thinking, live: false });
        else if (b.type === "tool_use") s = push(s, { kind: "tool", id: String(b.id), name: String(b.name), input: b.input, status: "done" });
      }
    }
    const next = msgs[idx + 1];
    if (!next || next.turnId !== m.turnId) {
      const c = costByTurn.get(m.turnId);
      s = push(s, { kind: "turn", turnId: m.turnId, costUsd: c?.priced ? c.usd : null });
    }
  });

  for (const p of detail.pendingPermissions) s = addPermission(s, p);
  return s;
}

function addPermission(s: LiveSession, p: PermissionRequestDTO): LiveSession {
  if (s.items.some((i) => i.kind === "permission" && i.id === p.id)) return s;
  return push(s, { kind: "permission", id: p.id, name: p.name, input: p.input, risk: p.risk, summary: p.summary, state: "pending" });
}

// ── live events ──────────────────────────────────────────────────────────

export function applyEvent(s: LiveSession, env: SessionEventEnvelopeDTO): LiveSession {
  const ev = env.event;
  switch (ev.type) {
    case "turn_start":
      return push({ ...s, running: true, turnId: env.turnId, sawText: false, sawThinking: false, lastTurnCost: null, stopped: undefined }, { kind: "user", text: ev.text });

    case "text_delta": {
      const last = s.items[s.items.length - 1];
      if (last && last.kind === "assistant" && last.live) {
        return { ...patchItem(s, s.items.length - 1, { text: last.text + ev.text }), sawText: true };
      }
      return { ...push(s, { kind: "assistant", text: ev.text, live: true }), sawText: true };
    }

    case "thinking_delta": {
      const last = s.items[s.items.length - 1];
      if (last && last.kind === "thinking" && last.live) {
        return { ...patchItem(s, s.items.length - 1, { text: last.text + ev.text }), sawThinking: true };
      }
      return { ...push(s, { kind: "thinking", text: ev.text, live: true }), sawThinking: true };
    }

    case "tool_pending": {
      if (findTool(s, ev.id) >= 0) return s;
      return push(s, { kind: "tool", id: ev.id, name: ev.name, status: "pending" });
    }

    case "tool_start": {
      const at = findTool(s, ev.id);
      if (at >= 0) return patchItem(s, at, { name: ev.name, input: ev.input, status: "running" });
      return push(s, { kind: "tool", id: ev.id, name: ev.name, input: ev.input, status: "running" });
    }

    case "tool_end": {
      const at = findTool(s, ev.id);
      const patch = { status: (ev.result.isError ? "error" : "done") as ToolStatus, output: ev.result.content, ms: ev.ms };
      if (at >= 0) return patchItem(s, at, patch);
      return push(s, { kind: "tool", id: ev.id, name: ev.name, ...patch });
    }

    case "permission_request": {
      return addPermission(s, { id: ev.id, name: ev.name, input: ev.input, risk: ev.risk, summary: ev.summary });
    }

    case "message": {
      if (ev.message.role !== "assistant") return s;
      let next = closeLive(s);
      const blocks: ContentBlockDTO[] = typeof ev.message.content === "string" ? [{ type: "text", text: ev.message.content }] : ev.message.content;
      // Providers that do not stream deliver their text only here.
      for (const b of blocks) {
        if (b.type === "text" && !next.sawText && typeof b.text === "string" && b.text) next = push(next, { kind: "assistant", text: b.text, live: false });
        else if (b.type === "thinking" && !next.sawThinking && typeof b.thinking === "string" && b.thinking) next = push(next, { kind: "thinking", text: b.thinking, live: false });
        else if (b.type === "tool_use" && findTool(next, String(b.id)) < 0) next = push(next, { kind: "tool", id: String(b.id), name: String(b.name), input: b.input, status: "pending" });
      }
      return { ...next, sawText: false, sawThinking: false };
    }

    case "cost":
      return {
        ...s,
        totals: ev.session,
        contextTokens: ev.contextTokens,
        contextWindow: ev.contextWindow ?? s.contextWindow,
        lastTurnCost: ev.costUsd === null && ev.turnCostUsd === 0 ? null : ev.turnCostUsd,
      };

    case "todos":
      return { ...s, todos: ev.todos };

    case "stopped":
      return { ...s, stopped: { reason: ev.reason, detail: ev.detail } };

    case "turn_end": {
      const reason = ev.reason;
      const detail = ev.detail ?? s.stopped?.detail;
      const items = s.items.map((i): ChatItem => {
        if (i.kind === "tool" && (i.status === "pending" || i.status === "running")) return { ...i, status: reason === "end_turn" ? "done" : "error" };
        if (i.kind === "permission" && i.state === "pending") return { ...i, state: "denied" };
        return i;
      });
      return push({ ...closeLive(s), items, running: false, turnId: undefined }, { kind: "turn", turnId: env.turnId, costUsd: s.lastTurnCost, reason, detail });
    }

    case "usage":
    case "title":
      return s;
  }
}

export function markPermission(s: LiveSession, requestId: string, allowed: boolean): LiveSession {
  const at = s.items.findIndex((i) => i.kind === "permission" && i.id === requestId);
  return at < 0 ? s : patchItem(s, at, { state: allowed ? "allowed" : "denied" });
}

export function addError(s: LiveSession, text: string): LiveSession {
  return push(s, { kind: "error", text });
}

export function pendingPermissions(s: LiveSession): Array<Extract<ChatItem, { kind: "permission" }>> {
  return s.items.filter((i): i is Extract<ChatItem, { kind: "permission" }> => i.kind === "permission" && i.state === "pending");
}

// ── presentation helpers ─────────────────────────────────────────────────

const SUMMARY_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt", "name"];

/** One-line summary of a tool call's input. */
export function toolSummary(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of SUMMARY_KEYS) if (typeof o[k] === "string" && o[k]) return o[k] as string;
    try {
      return JSON.stringify(input);
    } catch {
      return "";
    }
  }
  return String(input);
}
