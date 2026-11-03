import { create } from "zustand";
import type { IpcPayload } from "../../../shared/ipc";
import type { ConnectionDTO, ConnectionTestDTO, ModelRole, ProviderListDTO } from "../../../shared/types";
import { call } from "../lib/ipc";

interface ProvidersState {
  data: ProviderListDTO | null;
  tests: Record<string, ConnectionTestDTO | "running">;
  load(): Promise<void>;
  /** Resolves to an error message, or null on success. */
  connect(payload: IpcPayload<"provider:connect">): Promise<string | null>;
  test(connectionId: string): Promise<void>;
  remove(connectionId: string): Promise<void>;
  setRole(role: ModelRole, connectionId: string | null, model?: string): Promise<void>;
}

export const useProviders = create<ProvidersState>()((set, get) => ({
  data: null,
  tests: {},

  load: async () => {
    const r = await call("provider:list", {});
    if (r.ok) set({ data: r.data });
  },

  connect: async (payload) => {
    const r = await call("provider:connect", payload, { quiet: true });
    if (!r.ok) return r.error;
    await get().load();
    // First connection becomes the main model, so a session can start right away.
    const conn: ConnectionDTO = r.data;
    const model = conn.models[0]?.id;
    if (!get().data?.roles.main && model) await get().setRole("main", conn.id, model);
    return null;
  },

  test: async (connectionId) => {
    set((s) => ({ tests: { ...s.tests, [connectionId]: "running" } }));
    const r = await call("provider:test", { connectionId });
    set((s) => ({
      tests: { ...s.tests, [connectionId]: r.ok ? r.data : { ok: false, latencyMs: 0, models: [], error: r.error } },
    }));
    if (r.ok) await get().load();
  },

  remove: async (connectionId) => {
    const r = await call("provider:delete", { connectionId });
    if (r.ok) await get().load();
  },

  setRole: async (role, connectionId, model) => {
    const r = await call("provider:setRole", { role, connectionId, model });
    if (r.ok) set({ data: r.data });
  },
}));

/** Display name of the model a session would use as "main" (mirrors ProviderHub.resolve). */
export function mainModelLabel(data: ProviderListDTO | null): string | null {
  if (!data || data.connections.length === 0) return null;
  const b = data.roles.main;
  if (b) return b.model;
  const anthropic = data.connections.find((c) => c.kind === "anthropic");
  if (anthropic) return anthropic.label;
  return data.connections[0]?.models[0]?.id ?? null;
}
