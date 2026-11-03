/**
 * Plain data shapes that cross the IPC boundary (main → renderer). Hand-written and
 * dependency-free on purpose: the renderer must not pull @easily/core (Node code) into its
 * type graph. The main process maps core objects onto these structurally.
 */
export type PermissionMode = "ask" | "auto-edit" | "plan" | "yolo";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ModelRole = "main" | "fast" | "subagent" | "judge";
export type ToolRisk = "read" | "write" | "exec" | "network";

// ── sessions ───────────────────────────────────────────────────────────────
export interface TotalsDTO {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum over priced calls only. */
  costUsd: number;
  /** Calls whose model has no known price (show "–", never a guess). */
  unpricedCalls: number;
}

export interface TodoDTO {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionMetaDTO {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  mode: PermissionMode;
  effort: Effort;
  turnCount: number;
  totals: TotalsDTO;
  todos: TodoDTO[];
  source: "user" | "job";
  jobId?: string;
  archived?: boolean;
  /** A turn is executing right now. */
  running: boolean;
}

/**
 * Anthropic Messages content blocks, as stored. Common shapes:
 *  {type:"text", text} · {type:"thinking", thinking} · {type:"tool_use", id, name, input}
 *  {type:"tool_result", tool_use_id, content: string, is_error?} · {type:"image", source}
 * A user message may carry extra trailing text blocks (recalled memory / hook context): render
 * only the first text block as the user's own words.
 */
export interface ContentBlockDTO {
  type: string;
  [key: string]: unknown;
}

export interface MessageDTO {
  role: "user" | "assistant";
  content: string | ContentBlockDTO[];
}

export interface StoredMessageDTO {
  turnId: string;
  ts: number;
  message: MessageDTO;
}

export interface UsageRecordDTO {
  turnId: string;
  ts: number;
  model: string;
  usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  costUsd: number | null;
}

export interface PermissionRequestDTO {
  id: string;
  name: string;
  input: unknown;
  risk: ToolRisk;
  /** The string permission rules match against (command, path, URL...). */
  summary: string;
}

export interface SessionDetailDTO {
  meta: SessionMetaDTO;
  messages: StoredMessageDTO[];
  usage: UsageRecordDTO[];
  /** Cards that are still waiting for an answer. */
  pendingPermissions: PermissionRequestDTO[];
}

export type TurnReason = "end_turn" | "refusal" | "max_tokens" | "aborted" | "error" | "budget" | "timeout";

/** Everything pushed on `session:event`. */
export type SessionEventDTO =
  | { type: "turn_start"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_pending"; id: string; name: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; result: { content: string; isError?: boolean; spilledToPath?: string }; ms: number }
  | ({ type: "permission_request" } & PermissionRequestDTO)
  | { type: "usage"; usage: UsageRecordDTO["usage"]; model: string }
  | { type: "message"; message: MessageDTO }
  | { type: "cost"; model: string; costUsd: number | null; turnCostUsd: number; session: TotalsDTO; contextTokens: number; contextWindow?: number }
  | { type: "todos"; todos: TodoDTO[] }
  | { type: "title"; title: string }
  | { type: "stopped"; reason: TurnReason; detail?: string }
  | { type: "turn_end"; reason: TurnReason; detail?: string };

export interface SessionEventEnvelopeDTO {
  sessionId: string;
  turnId: string;
  ts: number;
  event: SessionEventDTO;
}

export interface CheckpointDTO {
  turnId: string;
  ts: number;
  files: string[];
}

// ── providers ──────────────────────────────────────────────────────────────
export interface CapabilitiesDTO {
  streaming: boolean;
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  thinking: boolean;
  promptCaching: boolean;
  serverTools: boolean;
}

export interface ModelInfoDTO {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutput?: number;
}

/** A connection as the UI sees it. The API key never leaves main; only its last 4 characters do. */
export interface ConnectionDTO {
  id: string;
  presetId: string;
  kind: "anthropic" | "anthropic-compatible" | "openai" | "openai-compatible" | "gemini" | "bedrock" | "vertex";
  label: string;
  baseURL: string;
  extra: Record<string, string>;
  models: ModelInfoDTO[];
  capabilities: CapabilitiesDTO;
  createdAt: number;
  hasKey: boolean;
  keyLast4?: string;
}

export interface RoleBindingDTO {
  connectionId: string;
  model: string;
}

export interface ProviderListDTO {
  connections: ConnectionDTO[];
  roles: Partial<Record<ModelRole, RoleBindingDTO>>;
}

export interface ConnectionTestDTO {
  ok: boolean;
  latencyMs: number;
  models: ModelInfoDTO[];
  capabilities?: CapabilitiesDTO;
  error?: string;
}

// ── settings / memory ──────────────────────────────────────────────────────
export interface SettingsDTO {
  theme: "light" | "dark" | "system";
  permissionMode: PermissionMode;
  launchAtLogin: boolean;
  effort: Effort;
  rules: { allow: string[]; deny: string[] };
  defaultCwd?: string;
  roles: Partial<Record<ModelRole, RoleBindingDTO>>;
}

export interface MemoryFileDTO {
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
  body: string;
  links: string[];
  updatedAt: number;
}

// ── jobs ───────────────────────────────────────────────────────────────────
export type TriggerDTO =
  | { type: "cron"; expr: string; tz?: string }
  | { type: "once"; at: number }
  | { type: "app_start" }
  | { type: "resume" };

export interface JobDTO {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerDTO;
  prompt: string;
  cwd: string;
  profile: { mode: "plan" | "auto-edit"; writableDirs: string[]; allowNetwork: boolean };
  limits: { maxUsd?: number; maxMinutes?: number; retries: number };
  deliver: Array<"notify" | "inbox" | "file" | "mcp">;
  catchUp: boolean;
  createdAt: number;
  lastRunAt?: number;
  /** Next scheduled fire time (cron / once), if any. */
  nextRunAt?: number;
  running: boolean;
}

export interface RunRecordDTO {
  id: string;
  jobId: string;
  jobName: string;
  sessionId?: string;
  reason: "scheduled" | "catch_up" | "manual" | "trigger";
  startedAt: number;
  finishedAt?: number;
  status: "running" | "ok" | "error" | "aborted" | "budget" | "timeout" | "refusal";
  attempt: number;
  detail?: string;
  summary?: string;
  costUsd: number;
  changedFiles: string[];
}

export type JobEventDTO =
  | { type: "run_start"; run: RunRecordDTO }
  | { type: "run_end"; run: RunRecordDTO }
  | { type: "queued"; jobId: string; position: number };

// ── MCP ────────────────────────────────────────────────────────────────────
export interface McpStatusDTO {
  id: string;
  name: string;
  state: "connecting" | "connected" | "error" | "disabled";
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  latencyMs?: number;
  error?: string;
  log: string[];
}

export interface CatalogItemDTO {
  id: string;
  name: string;
  description: string;
  category: "core" | "web" | "dev" | "work" | "data" | "media";
  logo: string;
  verified: boolean;
  installType: "npx" | "uvx" | "docker" | "remote";
  inputs: Array<{ key: string; label: string; kind: "text" | "secret" | "folder" | "folder-list" | "url"; required?: boolean }>;
  installed: boolean;
  /** Required local runtime (npx / uvx / docker) and whether it was found on PATH. */
  runtime?: { command: string; available: boolean };
  /** False when v0.1 cannot install it (e.g. remote OAuth). */
  supported: boolean;
  unsupportedReason?: string;
}

export interface McpServerDTO {
  id: string;
  name: string;
  catalogId?: string;
  custom: boolean;
  enabled: boolean;
  status: McpStatusDTO;
}

export type McpEventDTO =
  | { type: "status"; status: McpStatusDTO }
  | { type: "progress"; catalogId: string; step: "detectRuntime" | "collectInputs" | "writeConfig" | "connect" | "healthCheck"; state: "running" | "done" | "failed"; message?: string };

// ── app ────────────────────────────────────────────────────────────────────
export interface AppInfoDTO {
  version: string;
  platform: string;
  dataDir: string;
  /** False when the OS cannot encrypt secrets; connections that need a key cannot be saved then. */
  secretsAvailable: boolean;
}

/** Result envelope returned by every invoke (errors never reject). */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
