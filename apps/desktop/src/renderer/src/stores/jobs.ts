import { create } from "zustand";
import type { IpcPayload } from "../../../shared/ipc";
import type { JobDTO, JobEventDTO, RunRecordDTO } from "../../../shared/types";
import { call } from "../lib/ipc";
import { useUi } from "./ui";

interface JobsState {
  jobs: JobDTO[];
  loaded: boolean;
  runs: Record<string, RunRecordDTO[]>;
  load(): Promise<void>;
  loadRuns(jobId: string): Promise<void>;
  /** Resolve to an error message, or null on success. */
  create(input: IpcPayload<"jobs:create">): Promise<string | null>;
  update(jobId: string, patch: IpcPayload<"jobs:update">["patch"]): Promise<string | null>;
  remove(jobId: string): Promise<void>;
  runNow(jobId: string): Promise<void>;
  stop(jobId: string): Promise<void>;
  onEvent(e: JobEventDTO): void;
}

export const useJobs = create<JobsState>()((set, get) => ({
  jobs: [],
  loaded: false,
  runs: {},

  load: async () => {
    const r = await call("jobs:list", {});
    if (r.ok) set({ jobs: r.data, loaded: true });
  },

  loadRuns: async (jobId) => {
    const r = await call("jobs:runs", { jobId, limit: 20 });
    if (r.ok) set((s) => ({ runs: { ...s.runs, [jobId]: r.data } }));
  },

  create: async (input) => {
    const r = await call("jobs:create", input, { quiet: true });
    if (!r.ok) return r.error;
    await get().load();
    return null;
  },

  update: async (jobId, patch) => {
    const r = await call("jobs:update", { jobId, patch }, { quiet: true });
    if (!r.ok) return r.error;
    await get().load();
    return null;
  },

  remove: async (jobId) => {
    const r = await call("jobs:delete", { jobId });
    if (r.ok) await get().load();
  },

  runNow: async (jobId) => {
    const r = await call("jobs:runNow", { jobId });
    if (r.ok && !r.data.started) useUi.getState().toast("이미 실행 중입니다.", "info");
    await get().load();
  },

  stop: async (jobId) => {
    await call("jobs:stop", { jobId });
  },

  onEvent: (e) => {
    void get().load();
    if (e.type === "run_start" || e.type === "run_end") void get().loadRuns(e.run.jobId);
  },
}));
