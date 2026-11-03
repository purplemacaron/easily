import { join } from "node:path";
import {
  CheckpointStore,
  FileMemoryStore,
  JobRunner,
  JobStore,
  McpManager,
  ProviderHub,
  Scheduler,
  SessionService,
  SessionStore,
  ToolRegistry,
  registerBuiltinTools,
  settingsFile,
  type Job,
  type RunRecord,
  type SecretVault,
  type Settings,
} from "@easily/core";
import type { PushChannel, PushPayloads } from "../shared/ipc";
import type { SessionEventEnvelopeDTO } from "../shared/types";
import { McpService } from "./mcp-service";

export interface ServiceOptions {
  dataDir: string;
  vault: SecretVault;
  /** Push to the renderer (no-op when there is no window). */
  send<C extends PushChannel>(channel: C, payload: PushPayloads[C]): void;
  /** OS notification for finished jobs. */
  notify(run: RunRecord, job: Job): void;
  hasCommand(command: string): boolean;
}

/** The composition root: every long-lived object of the backend, built once from a data dir. */
export async function createServices(opts: ServiceOptions) {
  const { dataDir } = opts;
  const settingsStore = settingsFile(dataDir);
  let settings: Settings = await settingsStore.load();

  const hub = new ProviderHub(dataDir, opts.vault, () => settings.roles);
  const store = new SessionStore(join(dataDir, "sessions"));
  const checkpoints = new CheckpointStore(join(dataDir, "checkpoints"));
  const memory = new FileMemoryStore(join(dataDir, "memory"));
  const tools = new ToolRegistry();
  registerBuiltinTools(tools);

  const activityListeners = new Set<() => void>();
  const notifyActivity = () => activityListeners.forEach((l) => l());

  const mcpManager = new McpManager(tools, (status) => opts.send("mcp:event", { type: "status", status }));
  const mcp = new McpService({
    dataDir,
    vault: opts.vault,
    manager: mcpManager,
    emit: (e) => opts.send("mcp:event", e),
    hasCommand: opts.hasCommand,
  });

  const service = new SessionService({
    store,
    checkpoints,
    memory,
    tools,
    resolveModel: (role) => hub.resolve(role),
    settings: () => ({ rules: settings.rules, hooks: settings.hooks, effort: settings.effort }),
    spillDir: join(dataDir, "spill"),
    onEvent: (env) => {
      opts.send("session:event", env as unknown as SessionEventEnvelopeDTO);
      if (env.event.type === "turn_start" || env.event.type === "turn_end") notifyActivity();
    },
  });

  const jobs = new JobStore(dataDir);
  const runner = new JobRunner({
    jobs,
    sessions: store,
    service,
    checkpoints,
    onEvent: (e) => {
      opts.send("job:event", e);
      notifyActivity();
    },
    notify: opts.notify,
  });
  const scheduler = new Scheduler((job, reason) => runner.run(job, reason).then(() => undefined));

  async function reloadSchedule(): Promise<void> {
    scheduler.load(await jobs.list());
  }

  return {
    dataDir,
    vault: opts.vault,
    hub,
    store,
    checkpoints,
    memory,
    tools,
    mcp,
    mcpManager,
    service,
    jobs,
    runner,
    scheduler,
    reloadSchedule,
    getSettings: (): Settings => settings,
    async updateSettings(fn: (s: Settings) => Settings): Promise<Settings> {
      settings = await settingsStore.update(fn);
      return settings;
    },
    /** Number of things running right now (turns + jobs), for the tray. */
    activeCount: () => new Set([...service.runningSessions(), ...runner.runningJobIds()]).size,
    onActivity(listener: () => void): () => void {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },

    /** Called once after the window exists: connect MCP servers, arm the scheduler, run missed jobs. */
    async start(): Promise<void> {
      await jobs.closeStaleRuns();
      await reloadSchedule();
      void mcp.init().catch(() => undefined);
      const all = await jobs.list();
      void scheduler.catchUp(all).then(() => scheduler.fireEvent("app_start", all)).catch(() => undefined);
    },
    /** powerMonitor 'resume': run what was missed while asleep. */
    async onResume(): Promise<void> {
      const all = await jobs.list();
      await scheduler.catchUp(all);
      await scheduler.fireEvent("resume", all);
    },
    async shutdown(): Promise<void> {
      scheduler.stopAll();
      for (const id of service.runningSessions()) service.abort(id);
      await mcp.shutdown();
    },
  };
}

export type Services = Awaited<ReturnType<typeof createServices>>;
