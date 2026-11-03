import { Cron } from "croner";
import { z } from "zod";

/**
 * Scheduler (PLAN Phase 4, S-001..S-018). Pure logic — the Electron main process owns the
 * lifetime (tray, login item, powerMonitor) and calls `catchUp()` on resume/startup.
 *
 * v0.1 triggers: cron (S-003), once (S-004), app_start and resume. File / webhook triggers
 * (S-006/S-007) are not implemented and are rejected by JobSchema.
 */
export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    expr: z.string().refine(isValidCron, "올바른 cron 식이 아닙니다 (예: 30 8 * * 1-5)"),
    tz: z.string().optional(),
  }),
  z.object({ type: z.literal("once"), at: z.number().int().positive() }),
  z.object({ type: z.literal("app_start") }),
  z.object({ type: z.literal("resume") }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const JobSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  enabled: z.boolean(),
  trigger: TriggerSchema,
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  /** Permission profile for unattended runs — read-only + listed folders by default (S-009). */
  profile: z.object({
    mode: z.enum(["plan", "auto-edit"]),
    writableDirs: z.array(z.string()),
    allowNetwork: z.boolean(),
  }),
  limits: z.object({
    maxUsd: z.number().positive().optional(),
    maxMinutes: z.number().positive().optional(),
    retries: z.number().int().min(0).max(5),
  }),
  deliver: z.array(z.enum(["notify", "inbox", "file", "mcp"])),
  /** Run once on startup/resume if a fire time was missed while asleep (S-005). */
  catchUp: z.boolean(),
  createdAt: z.number(),
  lastRunAt: z.number().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export type RunReason = "scheduled" | "catch_up" | "manual" | "trigger";
export type RunJob = (job: Job, reason: RunReason) => Promise<void>;

export function isValidCron(expr: string): boolean {
  try {
    new Cron(expr, { paused: true });
    return true;
  } catch {
    return false;
  }
}

/** Next fire time of a job, for the UI. */
export function nextRunAt(job: Job, now = new Date()): number | undefined {
  if (!job.enabled) return undefined;
  const t = job.trigger;
  if (t.type === "cron") return new Cron(t.expr, { timezone: t.tz, paused: true }).nextRun(now)?.getTime();
  if (t.type === "once") return t.at > now.getTime() && !job.lastRunAt ? t.at : undefined;
  return undefined;
}

export class Scheduler {
  private timers = new Map<string, Cron>();

  constructor(private readonly run: RunJob) {}

  load(jobs: Job[]): void {
    this.stopAll();
    for (const job of jobs) if (job.enabled) this.arm(job);
  }

  /** Call on app start and on powerMonitor 'resume'. Returns the jobs it started. */
  async catchUp(jobs: Job[], now = Date.now()): Promise<Job[]> {
    const started: Job[] = [];
    for (const job of jobs) {
      if (!job.enabled || !job.catchUp) continue;
      const base = job.lastRunAt ?? job.createdAt;
      let missed = false;
      if (job.trigger.type === "cron") {
        const next = new Cron(job.trigger.expr, { timezone: job.trigger.tz, paused: true }).nextRun(new Date(base));
        missed = !!next && next.getTime() < now;
      } else if (job.trigger.type === "once") {
        missed = job.trigger.at < now && !job.lastRunAt;
      }
      if (missed) {
        started.push(job);
        await this.run(job, "catch_up");
      }
    }
    return started;
  }

  /** Fire jobs bound to an app lifecycle event ("app_start" on launch, "resume" after sleep). */
  async fireEvent(type: "app_start" | "resume", jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      if (job.enabled && job.trigger.type === type) await this.run(job, "trigger");
    }
  }

  stopAll(): void {
    for (const t of this.timers.values()) t.stop();
    this.timers.clear();
  }

  armed(): string[] {
    return [...this.timers.keys()];
  }

  private arm(job: Job): void {
    const t = job.trigger;
    if (t.type === "cron") {
      this.timers.set(job.id, new Cron(t.expr, { timezone: t.tz, protect: true }, () => void this.run(job, "scheduled")));
    } else if (t.type === "once" && t.at > Date.now() && !job.lastRunAt) {
      this.timers.set(job.id, new Cron(new Date(t.at), () => void this.run(job, "scheduled")));
    }
  }
}
