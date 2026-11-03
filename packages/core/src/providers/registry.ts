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

export function createProvider(connection: Connection, apiKey: string | undefined): Provider {
  switch (connection.kind) {
    case "anthropic":
    case "anthropic-compatible":
      return new AnthropicProvider(connection, apiKey);
    case "openai":
    case "openai-compatible":
      return new OpenAICompatibleProvider(connection, apiKey);
    case "gemini":
    case "bedrock":
    case "vertex":
      // TODO(P1): GeminiProvider (@google/genai), Bedrock Mantle / Vertex via Anthropic SDK clients.
      throw new Error(`Provider kind "${connection.kind}" is not implemented yet`);
  }
}
