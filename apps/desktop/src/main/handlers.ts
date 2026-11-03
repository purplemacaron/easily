import { homedir } from "node:os";
import { existsSync, statSync } from "node:fs";
import {
  NewJobSchema,
  nextRunAt,
  type Job,
  type MemoryFile,
  type Settings,
  type SessionMeta,
} from "@easily/core";
import type { IpcChannel, IpcPayload, IpcResponse } from "../shared/ipc";
import type { ConnectionDTO, JobDTO, MemoryFileDTO, ProviderListDTO, SessionMetaDTO, SettingsDTO } from "../shared/types";
import type { Services } from "./services";

/** Things only the Electron shell can do; injected so handlers stay testable. */
export interface Platform {
  openExternal(url: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  setLoginItem(open: boolean): void;
  /** Keep native chrome (window controls, system theme) in step with the app theme. */
  applyTheme?(theme: SettingsDTO["theme"]): void;
  appInfo(): { version: string; platform: string; secretsAvailable: boolean };
}

type Handlers = { [C in IpcChannel]: (payload: IpcPayload<C>) => Promise<IpcResponse<C>> };

/** One handler per IPC channel; the mapped type makes a missing channel a compile error. */
export function createHandlers(svc: Services, platform: Platform): Handlers {
  const sessionDto = (m: SessionMeta): SessionMetaDTO => ({ ...m, running: svc.service.isRunning(m.id) }) as SessionMetaDTO;
  const jobDto = (j: Job): JobDTO => ({ ...j, nextRunAt: nextRunAt(j), running: svc.runner.isRunning(j.id) });
  const memoryDto = (list: MemoryFile[]): MemoryFileDTO[] => list;
  const settingsDto = (s: Settings): SettingsDTO => ({
    theme: s.theme,
    permissionMode: s.permissionMode,
    launchAtLogin: s.launchAtLogin,
    effort: s.effort,
    rules: s.rules,
    defaultCwd: s.defaultCwd,
    roles: s.roles,
  });
  // The vault reference stays in main as well: only hasKey + last 4 characters go to the UI.
  const connectionDto = ({ secretRef: _ref, ...rest }: Awaited<ReturnType<typeof svc.hub.list>>[number]): ConnectionDTO => rest;
  const providerList = async (): Promise<ProviderListDTO> => ({
    connections: (await svc.hub.list()).map(connectionDto),
    roles: svc.getSettings().roles,
  });
  const requireSession = async (id: string) => {
    const m = await svc.store.get(id);
    if (!m) throw new Error("세션을 찾을 수 없습니다.");
    return m;
  };

  return {
    // ── sessions ───────────────────────────────────────────────────────────
    "session:list": async () => (await svc.store.list()).map(sessionDto),
    "session:create": async (p) => {
      const s = svc.getSettings();
      const cwd = p.cwd ?? s.defaultCwd ?? homedir();
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`작업 폴더를 찾을 수 없습니다: ${cwd}`);
      return sessionDto(await svc.store.create({ cwd, title: p.title, mode: p.mode ?? s.permissionMode, effort: s.effort }));
    },
    "session:get": async (p) => {
      const meta = await requireSession(p.sessionId);
      return {
        meta: sessionDto(meta),
        messages: (await svc.store.messages(p.sessionId)) as unknown as IpcResponse<"session:get">["messages"],
        usage: (await svc.store.usage(p.sessionId)) as IpcResponse<"session:get">["usage"],
        pendingPermissions: svc.service.pendingPermissions(p.sessionId) as IpcResponse<"session:get">["pendingPermissions"],
      };
    },
    "session:rename": async (p) => sessionDto(await svc.store.update(p.sessionId, { title: p.title.trim() })),
    "session:delete": async (p) => {
      svc.service.abort(p.sessionId);
      await svc.store.delete(p.sessionId);
      return null;
    },
    "session:send": async (p) => {
      const meta = await requireSession(p.sessionId);
      if (!existsSync(meta.cwd)) throw new Error(`작업 폴더가 없어졌습니다: ${meta.cwd}`);
      const r = await svc.service.send(p.sessionId, p.text);
      return { turnId: r.turnId, reason: r.reason, detail: r.detail, costUsd: r.costUsd };
    },
    "session:abort": async (p) => {
      svc.service.abort(p.sessionId);
      return null;
    },
    "session:setMode": async (p) => sessionDto(await svc.store.update(p.sessionId, { mode: p.mode })),
    "session:setEffort": async (p) => sessionDto(await svc.store.update(p.sessionId, { effort: p.effort })),
    "session:checkpoints": async (p) => svc.checkpoints.list(p.sessionId),
    "session:rewind": async (p) => svc.service.rewind(p.sessionId, p.turnId),
    "permission:answer": async (p) => ({ found: svc.service.answerPermission(p.requestId, p.allow, p.always) }),

    // ── providers ──────────────────────────────────────────────────────────
    "provider:list": providerList,
    "provider:connect": async (p) => connectionDto(await svc.hub.connect(p)),
    "provider:test": async (p) => svc.hub.test(p.connectionId, p.model),
    "provider:delete": async (p) => {
      await svc.hub.remove(p.connectionId);
      // Drop role bindings that pointed at the deleted connection.
      await svc.updateSettings((s) => ({
        ...s,
        roles: Object.fromEntries(Object.entries(s.roles).filter(([, b]) => b?.connectionId !== p.connectionId)),
      }));
      return null;
    },
    "provider:setRole": async (p) => {
      if (p.connectionId) {
        const conn = await svc.hub.get(p.connectionId);
        if (!conn) throw new Error("연결을 찾을 수 없습니다.");
        const model = p.model ?? conn.models[0]?.id;
        if (!model) throw new Error("모델을 선택하세요.");
        await svc.updateSettings((s) => ({ ...s, roles: { ...s.roles, [p.role]: { connectionId: conn.id, model } } }));
      } else {
        await svc.updateSettings((s) => {
          const roles = { ...s.roles };
          delete roles[p.role];
          return { ...s, roles };
        });
      }
      return providerList();
    },

    // ── settings / memory ──────────────────────────────────────────────────
    "settings:get": async () => settingsDto(svc.getSettings()),
    "settings:set": async (p) => {
      const next = await svc.updateSettings((s) => ({ ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }));
      if (p.launchAtLogin !== undefined) platform.setLoginItem(p.launchAtLogin);
      if (p.theme !== undefined) platform.applyTheme?.(p.theme);
      return settingsDto(next);
    },
    "memory:list": async () => memoryDto(await svc.memory.list()),
    "memory:upsert": async (p) => {
      await svc.memory.upsert(p);
      return memoryDto(await svc.memory.list());
    },
    "memory:delete": async (p) => {
      await svc.memory.remove(p.name);
      return memoryDto(await svc.memory.list());
    },

    // ── jobs ───────────────────────────────────────────────────────────────
    "jobs:list": async () => (await svc.jobs.list()).map(jobDto),
    "jobs:create": async (p) => {
      const job = await svc.jobs.create(NewJobSchema.parse(p));
      await svc.reloadSchedule();
      return jobDto(job);
    },
    "jobs:update": async (p) => {
      const clean = Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== undefined));
      const job = await svc.jobs.update(p.jobId, clean);
      await svc.reloadSchedule();
      return jobDto(job);
    },
    "jobs:delete": async (p) => {
      svc.runner.stop(p.jobId);
      await svc.jobs.delete(p.jobId);
      await svc.reloadSchedule();
      return null;
    },
    "jobs:runNow": async (p) => {
      if (!(await svc.jobs.get(p.jobId))) throw new Error("작업을 찾을 수 없습니다.");
      if (svc.runner.isRunning(p.jobId)) return { started: false };
      void svc.runner.run(p.jobId, "manual").catch(() => undefined);
      return { started: true };
    },
    "jobs:stop": async (p) => {
      svc.runner.stop(p.jobId);
      return null;
    },
    "jobs:runs": async (p) => svc.jobs.listRuns(p.jobId, p.limit),

    // ── MCP ────────────────────────────────────────────────────────────────
    "mcp:catalog": () => svc.mcp.catalog(),
    "mcp:list": () => svc.mcp.list(),
    "mcp:install": (p) => svc.mcp.install(p.catalogId, p.inputs),
    "mcp:addCustom": (p) => svc.mcp.addCustom(p),
    "mcp:remove": async (p) => {
      await svc.mcp.remove(p.serverId);
      return null;
    },
    "mcp:setEnabled": (p) => svc.mcp.setEnabled(p.serverId, p.enabled),
    "mcp:restart": (p) => svc.mcp.restart(p.serverId),

    // ── app ────────────────────────────────────────────────────────────────
    "app:openExternal": async (p) => {
      const u = new URL(p.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("http(s) 주소만 열 수 있습니다.");
      await platform.openExternal(p.url);
      return null;
    },
    "app:pickFolder": () => platform.pickFolder(),
    "app:info": async () => ({ ...platform.appInfo(), dataDir: svc.dataDir }),
  };
}
