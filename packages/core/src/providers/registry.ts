import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai.js";
import type { Connection, Provider } from "./types.js";

/** Model roles (M-017). Each role points at a connection + model id. */
export type ModelRole = "main" | "fast" | "subagent" | "judge";

export interface RoleBinding {
  connectionId: string;
  model: string;
  /** Tried in order when the primary fails or is rate limited (M-018). */
  fallbacks?: Array<{ connectionId: string; model: string }>;
}

/**
 * Google's documented OpenAI-compatibility endpoint for the Gemini API. v0.1 talks to Gemini
 * through the OpenAI adapter instead of a native @google/genai adapter.
 */
export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export function createProvider(connection: Connection, apiKey: string | undefined): Provider {
  switch (connection.kind) {
    case "anthropic":
    case "anthropic-compatible":
    case "bedrock":
    case "vertex":
      return new AnthropicProvider(connection, apiKey);
    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider(connection, apiKey);
    case "gemini":
      return new OpenAICompatibleProvider({ ...connection, baseURL: connection.baseURL || GEMINI_OPENAI_BASE_URL }, apiKey);
  }
}
