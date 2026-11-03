import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { JsonFile } from "../util/json-file.js";
import { JobSchema, type Job } from "./index.js";

/** Job definitions (jobs.json) and run history (job-runs.json), S-012. */
export const RunRecordSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobName: z.string(),
  sessionId: z.string().optional(),
  reason: z.enum(["scheduled", "catch_up", "manual", "trigger"]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  status: z.enum(["running", "ok", "error", "aborted", "budget", "timeout", "refusal"]),
  attempt: z.number().int().default(1),
  detail: z.string().optional(),
  /** Final assistant text (the job's output). */
  summary: z.string().optional(),
  costUsd: z.number().default(0),
  changedFiles: z.array(z.string()).default([]),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

const JobsFile = z.object({ jobs: z.array(JobSchema).default([]) });
const RunsFile = z.object({ runs: z.array(RunRecordSchema).default([]) });
const MAX_RUNS = 500;

/** Fields a caller supplies when creating a job; the store fills in id/createdAt. */
export const NewJobSchema = JobSchema.omit({ id: true, createdAt: true, lastRunAt: true });
export type NewJob = z.infer<typeof NewJobSchema>;

export class JobStore {
  private jobs: JsonFile<typeof JobsFile>;
  private runs: JsonFile<typeof RunsFile>;

  constructor(dataDir: string) {
    this.jobs = new JsonFile(path.join(dataDir, "jobs.json"), JobsFile, () => ({ jobs: [] }));
    this.runs = new JsonFile(path.join(dataDir, "job-runs.json"), RunsFile, () => ({ runs: [] }));
  }

  async list(): Promise<Job[]> {
    return (await this.jobs.load()).jobs;
  }
  async get(id: string): Promise<Job | undefined> {
    return (await this.list()).find((j) => j.id === id);
  }
  async create(input: NewJob): Promise<Job> {
    const job: Job = { ...input, id: randomUUID(), createdAt: Date.now() };
    await this.jobs.update((cur) => ({ jobs: [...cur.jobs, job] }));
    return job;
  }
  async update(id: string, patch: Partial<Omit<Job, "id" | "createdAt">>): Promise<Job> {
    let out: Job | undefined;
    await this.jobs.update((cur) => ({
      jobs: cur.jobs.map((j) => {
        if (j.id !== id) return j;
        out = JobSchema.parse({ ...j, ...patch });
        return out;
      }),
    }));
    if (!out) throw new Error(`Job not found: ${id}`);
    return out;
  }
  async delete(id: string): Promise<void> {
    await this.jobs.update((cur) => ({ jobs: cur.jobs.filter((j) => j.id !== id) }));
  }

  async listRuns(jobId?: string, limit = 100): Promise<RunRecord[]> {
    const all = (await this.runs.load()).runs;
    return all.filter((r) => !jobId || r.jobId === jobId).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }
  async saveRun(run: RunRecord): Promise<void> {
    await this.runs.update((cur) => {
      const rest = cur.runs.filter((r) => r.id !== run.id);
      return { runs: [...rest, run].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_RUNS) };
    });
  }
  /** Runs left in "running" by a crash or quit are closed on the next start. */
  async closeStaleRuns(): Promise<void> {
    await this.runs.update((cur) => ({
      runs: cur.runs.map((r) => (r.status === "running" ? { ...r, status: "aborted" as const, finishedAt: Date.now(), detail: "앱이 종료되어 중단되었습니다." } : r)),
    }));
  }
}
