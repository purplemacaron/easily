import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Checkpoints (H-011/H-012), minimal version: before the first write to a file in a turn, the
 * original is copied to `<base>/<session>/<turn>/<n>.bak` (or recorded as "did not exist").
 * `rewind(session, turn)` puts every file touched in that turn — and any later turn — back.
 *
 * TODO(P2): shadow-git snapshots for non-tool changes, and rewinding the conversation too.
 */
interface FileEntry {
  path: string;
  existed: boolean;
  backup?: string;
}
interface TurnEntry {
  turnId: string;
  ts: number;
  files: FileEntry[];
}

export interface CheckpointInfo {
  turnId: string;
  ts: number;
  files: string[];
}

export class CheckpointStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(private readonly baseDir: string) {}

  private serial<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(sessionId, next.catch(() => undefined));
    return next;
  }

  private manifestPath(sessionId: string): string {
    return path.join(this.baseDir, safeSegment(sessionId), "turns.json");
  }

  private async load(sessionId: string): Promise<TurnEntry[]> {
    try {
      return JSON.parse(await readFile(this.manifestPath(sessionId), "utf8")) as TurnEntry[];
    } catch {
      return [];
    }
  }

  private async save(sessionId: string, turns: TurnEntry[]): Promise<void> {
    const p = this.manifestPath(sessionId);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(`${p}.tmp`, JSON.stringify(turns), "utf8");
    await rename(`${p}.tmp`, p);
  }

  /** Back up `absPaths` (once per turn). Call before writing. */
  snapshot(sessionId: string, turnId: string, absPaths: string[]): Promise<void> {
    return this.serial(sessionId, async () => {
      const turns = await this.load(sessionId);
      let turn = turns.find((t) => t.turnId === turnId);
      if (!turn) {
        turn = { turnId, ts: Date.now(), files: [] };
        turns.push(turn);
      }
      for (const abs of absPaths) {
        if (turn.files.some((f) => f.path === abs)) continue;
        if (existsSync(abs)) {
          const dir = path.join(this.baseDir, safeSegment(sessionId), safeSegment(turnId));
          await mkdir(dir, { recursive: true });
          const backup = path.join(dir, `${turn.files.length}.bak`);
          await copyFile(abs, backup);
          turn.files.push({ path: abs, existed: true, backup });
        } else {
          turn.files.push({ path: abs, existed: false });
        }
      }
      await this.save(sessionId, turns);
    });
  }

  async list(sessionId: string): Promise<CheckpointInfo[]> {
    return (await this.load(sessionId)).filter((t) => t.files.length > 0).map((t) => ({ turnId: t.turnId, ts: t.ts, files: t.files.map((f) => f.path) }));
  }

  /** Restore files changed in `turnId` and every later turn, newest first. */
  rewind(sessionId: string, turnId: string): Promise<{ restored: string[]; removed: string[] }> {
    return this.serial(sessionId, async () => {
      const turns = await this.load(sessionId);
      const idx = turns.findIndex((t) => t.turnId === turnId);
      if (idx === -1) throw new Error(`No checkpoint for turn ${turnId}`);
      const restored: string[] = [];
      const removed: string[] = [];
      for (const turn of turns.slice(idx).reverse()) {
        for (const f of [...turn.files].reverse()) {
          if (f.existed && f.backup) {
            await mkdir(path.dirname(f.path), { recursive: true });
            await copyFile(f.backup, f.path);
            restored.push(f.path);
          } else if (!f.existed) {
            await rm(f.path, { force: true });
            removed.push(f.path);
          }
        }
        await rm(path.join(this.baseDir, safeSegment(sessionId), safeSegment(turn.turnId)), { recursive: true, force: true });
      }
      await this.save(sessionId, turns.slice(0, idx));
      return { restored, removed };
    });
  }
}

function safeSegment(s: string): string {
  return s.replace(/[^\w.-]/g, "_");
}
