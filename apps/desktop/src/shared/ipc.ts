import { z } from "zod";
import type {
  AppInfoDTO,
  CatalogItemDTO,
  CheckpointDTO,
  ConnectionDTO,
  ConnectionTestDTO,
  JobDTO,
  JobEventDTO,
  McpEventDTO,
  McpServerDTO,
  MemoryFileDTO,
  RunRecordDTO,
  SessionDetailDTO,
  SessionEventEnvelopeDTO,
  SessionMetaDTO,
  SettingsDTO,
  ProviderListDTO,
} from "./types";

/**
 * Every IPC channel lives here: name + payload schema (+ response type below). Preload exposes
 * only these; main validates every payload with the schema before acting on it. Every invoke
 * resolves to an `IpcResult` — main never rejects.
 */
const PermissionMode = z.enum(["ask", "auto-edit", "plan", "yolo"]);
const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
const Role = z.enum(["main", "fast", "subagent", "judge"]);

const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expr: z.string().min(1), tz: z.string().optional() }),
  z.object({ type: z.literal("once"), at: z.number().int().positive() }),
  z.object({ type: z.literal("app_start") }),
  z.object({ type: z.literal("resume") }),
]);

/** Fields of a job the UI supplies (id / createdAt / lastRunAt are set by main). */
export const JobInput = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  trigger: Trigger,
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  profile: z.object({ mode: z.enum(["plan", "auto-edit"]), writableDirs: z.array(z.string()), allowNetwork: z.boolean() }),
  limits: z.object({ maxUsd: z.number().positive().optional(), maxMinutes: z.number().positive().optional(), retries: z.number().int().min(0).max(5) }),
  deliver: z.array(z.enum(["notify", "inbox", "file", "mcp"])),
  catchUp: z.boolean(),
});

export const IPC = {
  // ── sessions ─────────────────────────────────────────────
  "session:list": z.object({}),
  "session:create": z.object({ cwd: z.string().optional(), title: z.string().optional(), mode: PermissionMode.optional() }),
  "session:get": z.object({ sessionId: z.string() }),
  "session:rename": z.object({ sessionId: z.string(), title: z.string().min(1) }),
  "session:delete": z.object({ sessionId: z.string() }),
  /** Starts a turn and resolves when it ends; progress arrives as `session:event` pushes. */
  "session:send": z.object({ sessionId: z.string(), text: z.string().min(1) }),
  "session:abort": z.object({ sessionId: z.string() }),
  "session:setMode": z.object({ sessionId: z.string(), mode: PermissionMode }),
  "session:setEffort": z.object({ sessionId: z.string(), effort: Effort }),
  "session:checkpoints": z.object({ sessionId: z.string() }),
  "session:rewind": z.object({ sessionId: z.string(), turnId: z.string() }),
  "permission:answer": z.object({ requestId: z.string(), allow: z.boolean(), always: z.boolean().optional() }),

  // ── providers ────────────────────────────────────────────
  "provider:list": z.object({}),
  "provider:connect": z.object({
    presetId: z.string(),
    label: z.string(),
    baseURL: z.string(),
    apiKey: z.string().optional(),
    extra: z.record(z.string()),
    /** Model for the capability probe when the endpoint lists none. */
    model: z.string().optional(),
  }),
  "provider:test": z.object({ connectionId: z.string(), model: z.string().optional() }),
  "provider:delete": z.object({ connectionId: z.string() }),
  /** connectionId null clears the binding. */
  "provider:setRole": z.object({ role: Role, connectionId: z.string().nullable(), model: z.string().optional() }),

  // ── settings / memory ────────────────────────────────────
  "settings:get": z.object({}),
  "settings:set": z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    permissionMode: PermissionMode.optional(),
    launchAtLogin: z.boolean().optional(),
    effort: Effort.optional(),
    rules: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }).optional(),
    defaultCwd: z.string().optional(),
  }),
  "memory:list": z.object({}),
  "memory:upsert": z.object({
    name: z.string(),
    description: z.string(),
    type: z.enum(["user", "feedback", "project", "reference"]),
    body: z.string(),
  }),
  "memory:delete": z.object({ name: z.string() }),

  // ── jobs ─────────────────────────────────────────────────
  "jobs:list": z.object({}),
  "jobs:create": JobInput,
  "jobs:update": z.object({ jobId: z.string(), patch: JobInput.partial() }),
  "jobs:delete": z.object({ jobId: z.string() }),
  "jobs:runNow": z.object({ jobId: z.string() }),
  "jobs:stop": z.object({ jobId: z.string() }),
  "jobs:runs": z.object({ jobId: z.string().optional(), limit: z.number().int().positive().max(500).optional() }),

  // ── MCP ──────────────────────────────────────────────────
  "mcp:catalog": z.object({}),
  "mcp:list": z.object({}),
  /** Folder-list inputs are newline separated. */
  "mcp:install": z.object({ catalogId: z.string(), inputs: z.record(z.string()) }),
  "mcp:addCustom": z.object({
    name: z.string().min(1),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string()).optional(),
  }),
  "mcp:remove": z.object({ serverId: z.string() }),
  "mcp:setEnabled": z.object({ serverId: z.string(), enabled: z.boolean() }),
  "mcp:restart": z.object({ serverId: z.string() }),

  // ── app ──────────────────────────────────────────────────
  "app:openExternal": z.object({ url: z.string().url() }),
  /** Native folder picker; resolves to the chosen path or null. */
  "app:pickFolder": z.object({}),
  "app:info": z.object({}),
} as const;

export type IpcChannel = keyof typeof IPC;
export type IpcPayload<C extends IpcChannel> = z.infer<(typeof IPC)[C]>;

/** Success payload of each channel (inside `IpcResult.data`). */
export interface IpcResponses extends Record<IpcChannel, unknown> {
  "session:list": SessionMetaDTO[];
  "session:create": SessionMetaDTO;
  "session:get": SessionDetailDTO;
  "session:rename": SessionMetaDTO;
  "session:delete": null;
  "session:send": { turnId: string; reason: string; detail?: string; costUsd: number };
  "session:abort": null;
  "session:setMode": SessionMetaDTO;
  "session:setEffort": SessionMetaDTO;
  "session:checkpoints": CheckpointDTO[];
  "session:rewind": { restored: string[]; removed: string[] };
  "permission:answer": { found: boolean };
  "provider:list": ProviderListDTO;
  "provider:connect": ConnectionDTO;
  "provider:test": ConnectionTestDTO;
  "provider:delete": null;
  "provider:setRole": ProviderListDTO;
  "settings:get": SettingsDTO;
  "settings:set": SettingsDTO;
  "memory:list": MemoryFileDTO[];
  "memory:upsert": MemoryFileDTO[];
  "memory:delete": MemoryFileDTO[];
  "jobs:list": JobDTO[];
  "jobs:create": JobDTO;
  "jobs:update": JobDTO;
  "jobs:delete": null;
  /** Resolves immediately; progress and the result arrive as `job:event` pushes. */
  "jobs:runNow": { started: boolean };
  "jobs:stop": null;
  "jobs:runs": RunRecordDTO[];
  "mcp:catalog": CatalogItemDTO[];
  "mcp:list": McpServerDTO[];
  "mcp:install": McpServerDTO;
  "mcp:addCustom": McpServerDTO;
  "mcp:remove": null;
  "mcp:setEnabled": McpServerDTO;
  "mcp:restart": McpServerDTO;
  "app:openExternal": null;
  "app:pickFolder": string | null;
  "app:info": AppInfoDTO;
}
export type IpcResponse<C extends IpcChannel> = IpcResponses[C];

/** main → renderer push channels and their payloads */
export interface PushPayloads {
  "session:event": SessionEventEnvelopeDTO;
  "job:event": JobEventDTO;
  "mcp:event": McpEventDTO;
  /** An easily:// URL, e.g. easily://mcp/install?id=github */
  deeplink: string;
}
export type PushChannel = keyof PushPayloads;
