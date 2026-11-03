import { create } from "zustand";
import type { IpcPayload } from "../../../shared/ipc";
import type { CatalogItemDTO, McpEventDTO, McpServerDTO } from "../../../shared/types";
import { call } from "../lib/ipc";

export type InstallStep = Extract<McpEventDTO, { type: "progress" }>;

interface McpState {
  catalog: CatalogItemDTO[];
  servers: McpServerDTO[];
  loaded: boolean;
  /** Latest state per install step, by catalog id. */
  progress: Record<string, InstallStep[]>;
  load(): Promise<void>;
  install(catalogId: string, inputs: Record<string, string>): Promise<string | null>;
  addCustom(payload: IpcPayload<"mcp:addCustom">): Promise<string | null>;
  remove(serverId: string): Promise<void>;
  setEnabled(serverId: string, enabled: boolean): Promise<void>;
  restart(serverId: string): Promise<void>;
  clearProgress(catalogId: string): void;
  onEvent(e: McpEventDTO): void;
}

export const useMcp = create<McpState>()((set, get) => {
  const patchServer = (s: McpServerDTO) =>
    set((st) => ({ servers: st.servers.map((x) => (x.id === s.id ? s : x)) }));
  return {
    catalog: [],
    servers: [],
    loaded: false,
    progress: {},

    load: async () => {
      const [c, l] = await Promise.all([call("mcp:catalog", {}), call("mcp:list", {})]);
      set({ catalog: c.ok ? c.data : get().catalog, servers: l.ok ? l.data : get().servers, loaded: true });
    },

    install: async (catalogId, inputs) => {
      set((st) => ({ progress: { ...st.progress, [catalogId]: [] } }));
      const r = await call("mcp:install", { catalogId, inputs }, { quiet: true });
      await get().load();
      return r.ok ? null : r.error;
    },

    addCustom: async (payload) => {
      const r = await call("mcp:addCustom", payload, { quiet: true });
      await get().load();
      return r.ok ? null : r.error;
    },

    remove: async (serverId) => {
      const r = await call("mcp:remove", { serverId });
      if (r.ok) await get().load();
    },

    setEnabled: async (serverId, enabled) => {
      const r = await call("mcp:setEnabled", { serverId, enabled });
      if (r.ok) patchServer(r.data);
    },

    restart: async (serverId) => {
      const r = await call("mcp:restart", { serverId });
      if (r.ok) patchServer(r.data);
    },

    clearProgress: (catalogId) =>
      set((st) => {
        const progress = { ...st.progress };
        delete progress[catalogId];
        return { progress };
      }),

    onEvent: (e) => {
      if (e.type === "status") {
        set((st) => ({ servers: st.servers.map((x) => (x.id === e.status.id ? { ...x, status: e.status } : x)) }));
      } else {
        set((st) => {
          const steps = (st.progress[e.catalogId] ?? []).filter((x) => x.step !== e.step);
          return { progress: { ...st.progress, [e.catalogId]: [...steps, e] } };
        });
      }
    },
  };
});
