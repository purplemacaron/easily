import { create } from "zustand";
import type { IpcPayload } from "../../../shared/ipc";
import type { MemoryFileDTO } from "../../../shared/types";
import { call } from "../lib/ipc";

interface MemoryState {
  files: MemoryFileDTO[];
  loaded: boolean;
  load(): Promise<void>;
  upsert(payload: IpcPayload<"memory:upsert">): Promise<string | null>;
  remove(name: string): Promise<void>;
}

export const useMemory = create<MemoryState>()((set) => ({
  files: [],
  loaded: false,
  load: async () => {
    const r = await call("memory:list", {});
    if (r.ok) set({ files: r.data, loaded: true });
  },
  upsert: async (payload) => {
    const r = await call("memory:upsert", payload, { quiet: true });
    if (!r.ok) return r.error;
    set({ files: r.data });
    return null;
  },
  remove: async (name) => {
    const r = await call("memory:delete", { name });
    if (r.ok) set({ files: r.data });
  },
}));
