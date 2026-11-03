import Anthropic from "@anthropic-ai/sdk";
import type { Capabilities, CompletionRequest, Connection, ModelInfo, Provider, ProviderEvent } from "./types.js";

export const ANTHROPIC_DEFAULT_MODELS = {
  main: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
  subagent: "claude-sonnet-5-5",
} as const;

/**
 * Adapter for kind "anthropic" and "anthropic-compatible".
 *
 * Same SDK for both; compatible endpoints just get a custom baseURL (+ optional bearer auth
 * and headers). Features that only the real Anthropic API has (server tools, server-side
 * refusal fallback, compaction beta) are gated on `connection.kind === "anthropic"` or on the
 * probed capabilities — never assume a compatible proxy supports them.
 */
export class AnthropicProvider implements Provider {
  private client: Anthropic;

  constructor(
    readonly connection: Connection,
    apiKey: string | undefined,
  ) {
    const compatible = connection.kind === "anthropic-compatible";
    const bearer = compatible && connection.extra.authStyle === "bearer";
    this.client = new Anthropic({
      apiKey: bearer ? null : (apiKey ?? null),
      authToken: bearer ? (apiKey ?? null) : null,
      baseURL: connection.baseURL || undefined,
      defaultHeaders: parseHeaders(connection.extra.headers),
    });
  }

  async *stream(req: CompletionRequest): AsyncIterable<ProviderEvent> {
    const official = this.connection.kind === "anthropic";

    // TODO(P1): on official Anthropic, send through client.beta.messages.stream with
    // betas ["server-side-fallback-2026-07-01"] + fallbacks: "default" (A-007), and the
    // compaction beta when context is near the limit (X-002). See the claude-api skill.
    const stream = this.client.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        tools: req.tools.map((t) => ({ ...t, eager_input_streaming: true })),
        ...(official || this.connection.capabilities.thinking
          ? { thinking: { type: "adaptive" as const, display: "summarized" as const } }
          : {}),
        ...(req.effort ? { output_config: { effort: req.effort } } : {}),
      },
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      const d = event.delta;
      if (d.type === "text_delta") yield { type: "text_delta", text: d.text };
      else if (d.type === "thinking_delta") yield { type: "thinking_delta", text: d.thinking };
      else if (d.type === "input_json_delta")
        yield { type: "tool_input_delta", toolUseId: String(event.index), partialJson: d.partial_json };
    }

    yield { type: "message", message: await stream.finalMessage() };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    for await (const m of this.client.models.list()) {
      out.push({ id: m.id, displayName: m.display_name });
    }
    return out;
  }

  async probe(_model: string): Promise<Capabilities> {
    if (this.connection.kind === "anthropic") {
      return {
        streaming: true,
        tools: true,
        parallelTools: true,
        vision: true,
        thinking: true,
        promptCaching: true,
        serverTools: true,
      };
    }
    // TODO(P1, M-016): send 3 tiny requests (tool call, image, thinking) and record which succeed.
    throw new Error("probe() for anthropic-compatible endpoints is not implemented yet");
  }
}

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return undefined;
  }
}
