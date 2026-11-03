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
  | { type: "tool_input_delta"; toolUseId: string; partialJson: string }
  | { type: "message"; message: AssistantMessage };

export interface Provider {
  readonly connection: Connection;
  stream(req: CompletionRequest): AsyncIterable<ProviderEvent>;
  listModels(): Promise<ModelInfo[]>;
  /** Short real requests that detect what this endpoint supports. */
  probe(model: string): Promise<Capabilities>;
}
