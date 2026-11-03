import type Anthropic from "@anthropic-ai/sdk";
import type { ProviderKind } from "./presets.js";

/**
 * Core message format = Anthropic Messages format. Every non-Anthropic adapter translates
 * to/from these types (providers/translate/*). Do not invent a parallel message type.
 */
export type MessageParam = Anthropic.MessageParam;
export type ToolDefinition = Anthropic.Tool;
export type AssistantMessage = Anthropic.Message;

/** A user-created, persisted connection to a preset. Secrets live in the vault, not here. */
export interface Connection {
  id: string;
  presetId: string;
  kind: ProviderKind;
  label: string;
  baseURL: string;
  /** Reference into the safeStorage vault; never the key itself. */
  secretRef?: string;
  extra: Record<string, string>;
  models: ModelInfo[];
  capabilities: Capabilities;
  createdAt: number;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutput?: number;
}

/** Filled by the capability probe when a connection is created (M-016). */
export interface Capabilities {
  streaming: boolean;
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  thinking: boolean;
  promptCaching: boolean;
  /** Anthropic server tools (web_search, code_execution...). Only true on real Anthropic. */
  serverTools: boolean;
}

export const UNKNOWN_CAPABILITIES: Capabilities = {
  streaming: true,
  tools: true,
  parallelTools: false,
  vision: false,
  thinking: false,
  promptCaching: false,
  serverTools: false,
};

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface CompletionRequest {
  model: string;
  system: string;
  messages: MessageParam[];
  tools: ToolDefinition[];
  maxTokens: number;
  effort?: Effort;
  signal?: AbortSignal;
}

/** Events streamed to the agent loop (and on to the UI). */
export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  /** A tool call started streaming; arguments follow as tool_input_delta. */
  | { type: "tool_use_start"; toolUseId: string; name: string }
  | { type: "tool_input_delta"; toolUseId: string; partialJson: string }
  | { type: "message"; message: AssistantMessage };

export interface Provider {
  readonly connection: Connection;
  stream(req: CompletionRequest): AsyncIterable<ProviderEvent>;
  listModels(): Promise<ModelInfo[]>;
  /** Short real requests that detect what this endpoint supports. */
  probe(model: string): Promise<Capabilities>;
}

/** Thrown for provider kinds / features that v0.1 does not implement; the message is shown in the UI. */
export class ProviderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnsupportedError";
  }
}

/** Thrown when a provider call fails; `message` is safe to show to the user (no secrets). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function describeProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { status?: number; message?: string; name?: string };
  const msg = err?.message ?? String(e);
  return new ProviderError(redactSecrets(msg), err?.status, e);
}

/** Strips anything that looks like an API key from text that may reach logs or the UI (P-002). */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1***")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{12,}/gi, "$1***");
}
