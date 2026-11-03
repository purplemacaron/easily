import { create } from "zustand";
import type { Effort, PermissionMode, SessionEventEnvelopeDTO, SessionMetaDTO } from "../../../shared/types";
import { call } from "../lib/ipc";
import { addError, applyEvent, emptySession, fromDetail, markPermission, type LiveSession } from "../lib/session-events";
import { useUi } from "./ui";

interface SessionsState {
  list: SessionMetaDTO[];
  loaded: boolean;
  activeId: string | null;
  live: Record<string, LiveSession>;
  refresh(): Promise<void>;
  select(id: string | null): Promise<void>;
  reload(id: string): Promise<void>;
  create(cwd?: string): Promise<string | undefined>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  send(id: string, text: string): Promise<void>;
  abort(id: string): Promise<void>;
  setMode(id: string, mode: PermissionMode): Promise<void>;
  setEffort(id: string, effort: Effort): Promise<void>;
  answerPermission(sessionId: string, requestId: string, allow: boolean, always?: boolean): Promise<void>;
  rewind(sessionId: string, turnId: string): Promise<boolean>;
  onEvent(env: SessionEventEnvelopeDTO): void;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export const useSessions = create<SessionsState>()((set, get) => {
  const patchLive = (id: string, fn: (s: LiveSession) => LiveSession) =>
    set((st) => ({ live: { ...st.live, [id]: fn(st.live[id] ?? emptySession()) } }));
  const patchMeta = (meta: SessionMetaDTO) => set((st) => ({ list: st.list.map((m) => (m.id === meta.id ? meta : m)) }));

  return {
    list: [],
    loaded: false,
    activeId: null,
    live: {},

    refresh: async () => {
      const r = await call("session:list", {});
      if (!r.ok) return;
      const list = [...r.data].sort((a, b) => b.updatedAt - a.updatedAt);
      set((st) => ({ list, loaded: true, activeId: st.activeId && list.some((m) => m.id === st.activeId) ? st.activeId : null }));
    },

    select: async (id) => {
      set({ activeId: id });
      if (id) {
        useUi.getState().setRoute("session");
        await get().reload(id);
      }
    },

    reload: async (id) => {
      const cur = get().live[id];
      if (cur?.running) return; // live events are authoritative while a turn runs
      const r = await call("session:get", { sessionId: id });
      if (!r.ok) {
        if (get().activeId === id) set({ activeId: null });
        void get().refresh();
        return;
      }
      set((st) => ({ live: { ...st.live, [id]: fromDetail(r.data) } }));
      patchMeta(r.data.meta);
    },

    create: async (cwd) => {
      const r = await call("session:create", cwd ? { cwd } : {});
      if (!r.ok) return undefined;
      set((st) => ({ list: [r.data, ...st.list], live: { ...st.live, [r.data.id]: emptySession() }, activeId: r.data.id }));
      useUi.getState().setRoute("session");
      return r.data.id;
    },

    rename: async (id, title) => {
      const r = await call("session:rename", { sessionId: id, title });
      if (r.ok) patchMeta(r.data);
    },

    remove: async (id) => {
      const r = await call("session:delete", { sessionId: id });
      if (!r.ok) return;
      set((st) => {
        const live = { ...st.live };
        delete live[id];
        return { list: st.list.filter((m) => m.id !== id), live, activeId: st.activeId === id ? null : st.activeId };
      });
    },

    send: async (id, text) => {
      patchLive(id, (s) => ({ ...s, running: true }));
      const r = await call("session:send", { sessionId: id, text }, { quiet: true });
      patchLive(id, (s) => {
        const next = r.ok ? s : addError(s, r.error);
        return { ...next, running: false };
      });
      void get().refresh();
    },

    abort: async (id) => {
      await call("session:abort", { sessionId: id });
    },

    setMode: async (id, mode) => {
      const r = await call("session:setMode", { sessionId: id, mode });
      if (r.ok) patchMeta(r.data);
    },

    setEffort: async (id, effort) => {
      const r = await call("session:setEffort", { sessionId: id, effort });
      if (r.ok) patchMeta(r.data);
    },

    answerPermission: async (sessionId, requestId, allow, always) => {
      const r = await call("permission:answer", { requestId, allow, always });
      if (r.ok) patchLive(sessionId, (s) => markPermission(s, requestId, allow));
    },

    rewind: async (sessionId, turnId) => {
      const r = await call("session:rewind", { sessionId, turnId });
      if (!r.ok) return false;
      useUi.getState().toast(`파일 ${r.data.restored.length}개 복원, ${r.data.removed.length}개 삭제`, "info");
      await get().reload(sessionId);
      void get().refresh();
      return true;
    },

    onEvent: (env) => {
      const { event } = env;
      if (event.type === "title") {
        set((st) => ({ list: st.list.map((m) => (m.id === env.sessionId ? { ...m, title: event.title } : m)) }));
      }
      if (get().live[env.sessionId]) patchLive(env.sessionId, (s) => applyEvent(s, env));
      if (event.type === "turn_start" || event.type === "turn_end") {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void get().refresh(), 250);
      }
    },
  };
});
