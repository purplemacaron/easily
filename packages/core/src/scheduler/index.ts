import { Cron } from "croner";

/**
 * Scheduler (PLAN Phase 4, S-001..S-018). Pure logic — the Electron main process owns the
 * lifetime (tray, login item, powerMonitor) and calls `catchUp()` on resume/startup.
 */
export type Trigger =
  | { type: "cron"; expr: string; tz?: string }
  | { type: "once"; at: number }
  | { type: "file"; glob: string; events: Array<"add" | "change" | "unlink"> }
  | { type: "webhook"; path: string }
  | { type: "app_start" }
  | { type: "resume" };

export interface Job {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  prompt: string;
  cwd: string;
  /** Permission profile for unattended runs — read-only + listed folders by default (S-009). */
  profile: { mode: "plan" | "auto-edit"; writableDirs: string[]; allowNetwork: boolean };
  limits: { maxUsd?: number; maxMinutes?: number; retries: number };
  deliver: Array<"notify" | "inbox" | "file" | "mcp">;
  /** Run once on startup/resume if a fire time was missed while asleep (S-005). */
  catchUp: boolean;
  lastRunAt?: number;
}

export type RunJob = (job: Job, reason: "scheduled" | "catch_up" | "manual" | "trigger") => Promise<void>;

export class Scheduler {
  private timers = new Map<string, Cron>();

  constructor(private readonly run: RunJob) {}

  load(jobs: Job[]): void {
    this.stopAll();
    for (const job of jobs) if (job.enabled) this.arm(job);
  }

  /** Call on app start and on powerMonitor 'resume'. */
  async catchUp(jobs: Job[], now = Date.now()): Promise<void> {
    for (const job of jobs) {
      if (!job.enabled || !job.catchUp || job.trigger.type !== "cron" || !job.lastRunAt) continue;
      const next = new Cron(job.trigger.expr, { timezone: job.trigger.tz }).nextRun(new Date(job.lastRunAt));
      if (next && next.getTime() < now) await this.run(job, "catch_up");
    }
  }

  stopAll(): void {
    for (const t of this.timers.values()) t.stop();
    this.timers.clear();
  }

  private arm(job: Job): void {
    const t = job.trigger;
    if (t.type === "cron") {
      this.timers.set(job.id, new Cron(t.expr, { timezone: t.tz, protect: true }, () => void this.run(job, "scheduled")));
    } else if (t.type === "once" && t.at > Date.now()) {
      this.timers.set(job.id, new Cron(new Date(t.at), () => void this.run(job, "scheduled")));
    }
    // TODO(P4): file (chokidar), webhook (local http server), app_start, resume triggers.
  }
}
