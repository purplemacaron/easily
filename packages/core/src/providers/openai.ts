import type { Capabilities, CompletionRequest, Connection, ModelInfo, Provider, ProviderEvent } from "./types.js";

/**
 * Adapter for kind "openai" and "openai-compatible" (OpenRouter, Groq, Ollama, Azure, ...).
 *
 * TODO(P1, M-002/M-003):
 *  - use the official `openai` SDK with `baseURL` from the connection
 *  - translate core (Anthropic-format) messages/tools → Chat Completions in translate/openai.ts
 *    · tool_use / tool_result blocks ↔ tool_calls / role:"tool" messages
 *    · images: base64 source → image_url data URI
 *    · thinking blocks are dropped on the way out (other providers cannot read them)
 *  - stream deltas → ProviderEvent, then assemble a final Anthropic-shaped Message so the
 *    agent loop never branches on provider
 *  - map finish_reason: stop→end_turn, tool_calls→tool_use, length→max_tokens,
 *    content_filter→refusal
 *  - listModels(): GET {baseURL}/models; many local servers return a minimal list — fine
 *  - probe(): tiny tool-call request; if it 400s, set tools=false and let the loop run text-only
 */
export class OpenAICompatibleProvider implements Provider {
  constructor(
    readonly connection: Connection,
    private readonly apiKey: string | undefined,
  ) {}

  // eslint-disable-next-line require-yield
  async *stream(_req: CompletionRequest): AsyncIterable<ProviderEvent> {
    throw new Error("OpenAI-compatible adapter not implemented yet (PLAN Phase 1)");
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.connection.baseURL.replace(/\/$/, "")}/models`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`GET /models failed: ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => ({ id: m.id }));
  }

  async probe(_model: string): Promise<Capabilities> {
    throw new Error("probe() not implemented yet");
  }
}
