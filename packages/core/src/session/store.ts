import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PermissionMode } from "../permissions/index.js";
import type { Effort, MessageParam } from "../providers/types.js";
import type { TodoItem } from "../tools/types.js";
import type { UsageLike } from "../providers/cost.js";

/**
 * Session persistence (PLAN Phase 1 "core/session"). File based on purpose — `better-sqlite3`
 * needs a per-Electron-ABI native rebuild and ARCHITECTURE only asks for local-first storage:
 *
 *   sessions/<id>.json    metadata (title, cwd, mode, totals) — rewritten atomically
 *   sessions/<id>.jsonl   append-only log: one JSON object per line, {t:"msg"} or {t:"usage"}
 *
 * History is never edited: messages are only appended (the thinking-block / prompt-cache rule).
 */
export interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum over priced turns only; see `unpricedCalls`. */
  costUsd: number;
  /** Model calls whose model has no entry in the cost table. */
  unpricedCalls: number;
}

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  mode: PermissionMode;
  effort: Effort;
  turnCount: number;
  totals: Totals;
  todos: TodoItem[];
  /** "job" sessions are created by the scheduler (S-012). */
  source: "user" | "job";
  jobId?: string;
  archived?: boolean;
}

export interface StoredMessage {
  turnId: string;
  ts: number;
  message: MessageParam;
}

export interface UsageRecord {
  turnId: string;
  ts: number;
  model: string;
  usage: UsageLike;
  costUsd: number | null;
}

export interface CreateSessionInput {
  title?: string;
  cwd: string;
  mode: PermissionMode;
  effort?: Effort;
  source?: "user" | "job";
  jobId?: string;
}

export const EMPTY_TOTALS: Totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, unpricedCalls: 0 };

const ID_RE = /^[\w-]{1,80}$/;

export class SessionStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(id, next.catch(() => undefined));
    return next;
  }

  private metaPath(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid session id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }
  private logPath(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid session id: ${id}`);
    return path.join(this.dir, `${id}.jsonl`);
  }

  async create(input: CreateSessionInput): Promise<SessionMeta> {
    const now = Date.now();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: input.title?.trim() || "새 세션",
      cwd: input.cwd,
      createdAt: now,
      updatedAt: now,
      mode: input.mode,
      effort: input.effort ?? "high",
      turnCount: 0,
      totals: { ...EMPTY_TOTALS },
      todos: [],
      source: input.source ?? "user",
      jobId: input.jobId,
    };
    await this.writeMeta(meta);
    return meta;
  }

  private async writeMeta(meta: SessionMeta): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const p = this.metaPath(meta.id);
    await writeFile(`${p}.tmp`, JSON.stringify(meta), "utf8");
    await rename(`${p}.tmp`, p);
  }

  async get(id: string): Promise<SessionMeta | null> {
    try {
      return JSON.parse(await readFile(this.metaPath(id), "utf8")) as SessionMeta;
    } catch {
      return null;
    }
  }

  async list(): Promise<SessionMeta[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const metas = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => this.get(n.slice(0, -5))));
    return metas.filter((m): m is SessionMeta => m !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  update(id: string, patch: Partial<Omit<SessionMeta, "id" | "createdAt">>): Promise<SessionMeta> {
    return this.serial(id, async () => {
      const cur = await this.get(id);
      if (!cur) throw new Error(`Session not found: ${id}`);
      const next = { ...cur, ...patch, updatedAt: patch.updatedAt ?? Date.now() };
      await this.writeMeta(next);
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.serial(id, async () => {
      await rm(this.metaPath(id), { force: true });
      await rm(this.logPath(id), { force: true });
    });
  }

  appendMessage(id: string, turnId: string, message: MessageParam): Promise<void> {
    return this.serial(id, async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.logPath(id), JSON.stringify({ t: "msg", turnId, ts: Date.now(), message }) + "\n", "utf8");
    });
  }

  /** Record one model call and fold it into the session totals. */
  appendUsage(id: string, rec: UsageRecord): Promise<SessionMeta> {
    return this.serial(id, async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.logPath(id), JSON.stringify({ t: "usage", ...rec }) + "\n", "utf8");
      const cur = await this.get(id);
      if (!cur) throw new Error(`Session not found: ${id}`);
      const t = cur.totals;
      const next: SessionMeta = {
        ...cur,
        updatedAt: Date.now(),
        totals: {
          inputTokens: t.inputTokens + (rec.usage.input_tokens ?? 0),
          outputTokens: t.outputTokens + (rec.usage.output_tokens ?? 0),
          cacheReadTokens: t.cacheReadTokens + (rec.usage.cache_read_input_tokens ?? 0),
          cacheWriteTokens: t.cacheWriteTokens + (rec.usage.cache_creation_input_tokens ?? 0),
          costUsd: t.costUsd + (rec.costUsd ?? 0),
          unpricedCalls: t.unpricedCalls + (rec.costUsd === null ? 1 : 0),
        },
      };
      await this.writeMeta(next);
      return next;
    });
  }

  private async readLog(id: string): Promise<Array<Record<string, unknown>>> {
    let raw: string;
    try {
      raw = await readFile(this.logPath(id), "utf8");
    } catch {
      return [];
    }
    const out: Array<Record<string, unknown>> = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // a torn last line after a crash is skipped; everything before it is intact
      }
    }
    return out;
  }

  async messages(id: string): Promise<StoredMessage[]> {
    return (await this.readLog(id)).filter((r) => r.t === "msg") as unknown as StoredMessage[];
  }

  async usage(id: string): Promise<UsageRecord[]> {
    return (await this.readLog(id)).filter((r) => r.t === "usage") as unknown as UsageRecord[];
  }
}
