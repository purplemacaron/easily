import { randomUUID } from "node:crypto";
import type { SessionService, TurnResult } from "../agent/service.js";
import type { CheckpointStore } from "../checkpoints/index.js";
import type { SessionStore } from "../session/store.js";
import type { Job, RunReason } from "./index.js";
import type { JobStore, RunRecord } from "./store.js";

export type JobEvent =
  | { type: "run_start"; run: RunRecord }
  | { type: "run_end"; run: RunRecord }
  | { type: "queued"; jobId: string; position: number };

export interface JobRunnerDeps {
  jobs: JobStore;
  sessions: SessionStore;
  service: SessionService;
  checkpoints: CheckpointStore;
  onEvent(e: JobEvent): void;
  /** OS notification etc.; called after every finished run when the job delivers "notify". */
  notify?(run: RunRecord, job: Job): void;
  /** Max jobs running at once; the rest wait in a FIFO queue (S-018). */
  maxConcurrent?: number;
  /** Base for retry backoff in ms (tests shrink it). */
  backoffMs?: number;
}

const STATUS_BY_REASON: Record<TurnResult["reason"], RunRecord["status"]> = {
  end_turn: "ok",
  max_tokens: "error",
  error: "error",
  aborted: "aborted",
  refusal: "refusal",
  budget: "budget",
  timeout: "timeout",
};

/**
 * Runs scheduled jobs headlessly (S-009..S-012, S-018). Each run is a normal persisted
 * session (source "job") driven through SessionService with the job's permission profile:
 * `plan` = read-only, `auto-edit` = writes allowed in cwd + writableDirs; anything that
 * would need a human (shell, network unless allowed) is denied instead of waiting forever.
 */
export class JobRunner {
  private active = new Set<string>();
  private queue: Array<() => void> = [];
  private aborts = new Map<string, AbortController>();

  constructor(private readonly deps: JobRunnerDeps) {}

  isRunning(jobId: string): boolean {
    return this.active.has(jobId);
  }
  runningJobIds(): string[] {
    return [...this.active];
  }

  stop(jobId: string): void {
    this.aborts.get(jobId)?.abort();
  }

  /** Entry point used by the Scheduler and by "run now". Resolves when the run (and retries) finished. */
  async run(jobOrId: Job | string, reason: RunReason): Promise<RunRecord | undefined> {
    const id = typeof jobOrId === "string" ? jobOrId : jobOrId.id;
    if (this.active.has(id)) return undefined; // protect: never overlap a job with itself
    this.active.add(id); // claim synchronously, before any await
    try {
      const job = await this.deps.jobs.get(id);
      if (!job) return undefined;
      await this.acquireSlot(id);
      try {
        return await this.execute(job, reason);
      } finally {
        this.releaseSlot();
      }
    } finally {
      this.active.delete(id);
    }
  }

  private running = 0;
  private acquireSlot(jobId: string): Promise<void> {
    const max = this.deps.maxConcurrent ?? 2;
    if (this.running < max) {
      this.running++;
      return Promise.resolve();
    }
    this.deps.onEvent({ type: "queued", jobId, position: this.queue.length + 1 });
    return new Promise((resolve) => this.queue.push(() => (this.running++, resolve())));
  }
  private releaseSlot(): void {
    this.running = Math.max(0, this.running - 1);
    this.queue.shift()?.();
  }

  private async execute(job: Job, reason: RunReason): Promise<RunRecord> {
    const abort = new AbortController();
    this.aborts.set(job.id, abort);
    let run: RunRecord = { id: randomUUID(), jobId: job.id, jobName: job.name, reason, startedAt: Date.now(), status: "running", attempt: 1, costUsd: 0, changedFiles: [] };
    let totalCost = 0;

    try {
      for (let attempt = 1; attempt <= job.limits.retries + 1; attempt++) {
        const session = await this.deps.sessions.create({ title: `[예약] ${job.name}`, cwd: job.cwd, mode: job.profile.mode, source: "job", jobId: job.id });
        run = { ...run, attempt, sessionId: session.id, status: "running", startedAt: attempt === 1 ? run.startedAt : Date.now() };
        await this.deps.jobs.saveRun(run);
        this.deps.onEvent({ type: "run_start", run });

        const result = await this.deps.service.send(session.id, job.prompt, {
          mode: job.profile.mode,
          extraRoots: job.profile.writableDirs,
          denyNetwork: !job.profile.allowNetwork,
          askPermission: async () => false, // nobody is watching: deny instead of hanging
          maxUsd: job.limits.maxUsd !== undefined ? Math.max(0, job.limits.maxUsd - totalCost) : undefined,
          maxMinutes: job.limits.maxMinutes,
          signal: abort.signal,
        });
        totalCost += result.costUsd;
        const changed = (await this.deps.checkpoints.list(session.id)).flatMap((c) => c.files);
        run = {
          ...run,
          finishedAt: Date.now(),
          status: STATUS_BY_REASON[result.reason],
          detail: result.detail,
          summary: result.text,
          costUsd: totalCost,
          changedFiles: [...new Set(changed)],
        };
        await this.deps.jobs.saveRun(run);
        // Retry only genuine failures, with exponential backoff; never after budget/abort.
        if (run.status !== "error" || attempt > job.limits.retries || abort.signal.aborted) break;
        await sleep((this.deps.backoffMs ?? 5_000) * 2 ** (attempt - 1));
      }
    } catch (e) {
      run = { ...run, finishedAt: Date.now(), status: "error", detail: e instanceof Error ? e.message : String(e), costUsd: totalCost };
      await this.deps.jobs.saveRun(run);
    } finally {
      this.aborts.delete(job.id);
    }

    await this.deps.jobs.update(job.id, { lastRunAt: run.startedAt }).catch(() => undefined);
    this.deps.onEvent({ type: "run_end", run });
    if (job.deliver.includes("notify")) this.deps.notify?.(run, job);
    return run;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
