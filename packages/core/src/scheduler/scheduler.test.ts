import { afterEach, describe, expect, it } from "vitest";
import { isValidCron, nextRunAt, Scheduler, TriggerSchema, type Job, type RunReason } from "./index.js";

const base: Job = {
  id: "j", name: "n", enabled: true, trigger: { type: "cron", expr: "30 8 * * 1-5", tz: "Asia/Seoul" }, prompt: "p", cwd: "/w",
  profile: { mode: "plan", writableDirs: [], allowNetwork: false }, limits: { retries: 0 }, deliver: [], catchUp: true, createdAt: Date.parse("2026-11-02T00:00:00Z"),
};

const runs: Array<[string, RunReason]> = [];
let sched: Scheduler;
afterEach(() => {
  sched?.stopAll();
  runs.length = 0;
});

describe("cron validation and next run", () => {
  it("validates cron expressions", () => {
    expect(isValidCron("30 8 * * 1-5")).toBe(true);
    expect(isValidCron("nonsense")).toBe(false);
    expect(TriggerSchema.safeParse({ type: "cron", expr: "bad" }).success).toBe(false);
    expect(TriggerSchema.safeParse({ type: "file", glob: "*" }).success).toBe(false); // not in v0.1
  });

  it("computes the next fire time in the job's timezone", () => {
    const next = nextRunAt(base, new Date("2026-11-02T00:00:00Z")); // Monday 09:00 KST already past 08:30 → next is Tue
    expect(new Date(next!).toISOString()).toBe("2026-11-02T23:30:00.000Z");
    expect(nextRunAt({ ...base, enabled: false })).toBeUndefined();
  });
});

describe("Scheduler", () => {
  it("fires a once-job at its time and arms nothing for the past", async () => {
    sched = new Scheduler(async (j, r) => void runs.push([j.id, r]));
    sched.load([{ ...base, id: "soon", trigger: { type: "once", at: Date.now() + 200 } }, { ...base, id: "past", trigger: { type: "once", at: Date.now() - 1000 } }, { ...base, id: "off", enabled: false }]);
    expect(sched.armed()).toEqual(["soon"]);
    await new Promise((r) => setTimeout(r, 900));
    expect(runs).toEqual([["soon", "scheduled"]]);
  });

  it("catch-up runs a missed cron fire once, and only for catchUp jobs", async () => {
    sched = new Scheduler(async (j, r) => void runs.push([j.id, r]));
    const now = Date.parse("2026-11-04T10:00:00Z");
    const started = await sched.catchUp(
      [
        { ...base, id: "missed", lastRunAt: Date.parse("2026-11-02T01:00:00Z") },
        { ...base, id: "fresh", lastRunAt: Date.parse("2026-11-04T09:59:00Z") },
        { ...base, id: "optout", catchUp: false, lastRunAt: Date.parse("2026-11-02T01:00:00Z") },
        { ...base, id: "once-missed", trigger: { type: "once", at: Date.parse("2026-11-03T00:00:00Z") } },
      ],
      now,
    );
    expect(started.map((j) => j.id)).toEqual(["missed", "once-missed"]);
    expect(runs).toEqual([["missed", "catch_up"], ["once-missed", "catch_up"]]);
  });

  it("fires app_start / resume jobs on lifecycle events", async () => {
    sched = new Scheduler(async (j, r) => void runs.push([j.id, r]));
    const jobs = [{ ...base, id: "a", trigger: { type: "app_start" } as const }, { ...base, id: "r", trigger: { type: "resume" } as const }];
    await sched.fireEvent("resume", jobs);
    expect(runs).toEqual([["r", "trigger"]]);
  });
});
