import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
  describeProviderError,
  UNKNOWN_CAPABILITIES,
  type Capabilities,
  type CompletionRequest,
  type Connection,
  type ModelInfo,
  type Provider,
  type ProviderEvent,
} from "./types.js";

export const ANTHROPIC_DEFAULT_MODELS = {
  main: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
  subagent: "claude-sonnet-5-5",
} as const;

/** The subset of the SDK surface this adapter uses; Bedrock/Vertex clients expose the same shape. */
interface MessagesClient {
  messages: { stream: Anthropic["messages"]["stream"]; create: Anthropic["messages"]["create"] };
  models?: Anthropic["models"];
}

/**
 * Adapter for kinds "anthropic", "anthropic-compatible", "bedrock" and "vertex".
 *
 * All four use the Anthropic SDK (Bedrock/Vertex via their official subclass clients); compatible
 * endpoints just get a custom baseURL (+ optional bearer auth and headers). Features that only
 * the real Anthropic API has (server tools, caching, adaptive thinking) are gated on
 * `isOfficial` or on the probed capabilities — never assume a compatible proxy supports them.
 */
export class AnthropicProvider implements Provider {
  private client: MessagesClient;
  /** Real Anthropic API, or Claude on Bedrock / Vertex: the full modern feature set. */
  private readonly modern: boolean;

  constructor(
    readonly connection: Connection,
    apiKey: string | undefined,
  ) {
    const { kind, extra } = connection;
    this.modern = kind === "anthropic" || kind === "bedrock" || kind === "vertex";

    if (kind === "bedrock") {
      this.client = new AnthropicBedrockMantle({
        awsRegion: extra.awsRegion || undefined,
        // A Bedrock API key (bearer token), if the user entered one; otherwise the AWS credential chain.
        apiKey: apiKey ?? null,
      }) as unknown as MessagesClient;
    } else if (kind === "vertex") {
      this.client = new AnthropicVertex({
        projectId: extra.projectId || undefined,
        region: extra.region || undefined,
        accessToken: apiKey ?? undefined,
      }) as unknown as MessagesClient;
    } else {
      // SDK 1.x sends `apiKey` as `Authorization: Bearer`. Compatible endpoints that expect the
      // classic `x-api-key` header get it explicitly (authStyle "x-api-key", the default).
      const compatible = kind === "anthropic-compatible";
      const bearer = !compatible || extra.authStyle === "bearer";
      this.client = new Anthropic({
        apiKey: bearer ? (apiKey ?? null) : null,
        authToken: null,
        baseURL: connection.baseURL || undefined,
        defaultHeaders: { ...(!bearer && apiKey ? { "x-api-key": apiKey } : {}), ...parseHeaders(extra.headers) },
      }) as MessagesClient;
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<ProviderEvent> {
    const official = this.connection.kind === "anthropic";
    const caps = this.connection.capabilities;
    const adaptive = this.modern || caps.thinking;
    const tools = req.tools.map((t, i) => ({
      ...t,
      ...(this.modern ? { eager_input_streaming: true } : {}),
      // One cache breakpoint at the end of the (deterministically sorted) tools block.
      ...(official && i === req.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    const stream = this.client.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: official ? [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }] : req.system,
        messages: req.messages,
        ...(tools.length ? { tools } : {}),
        // No temperature / top_p / budget_tokens / forced tool_choice: newer models reject them.
        ...(adaptive ? { thinking: { type: "adaptive" as const, display: "summarized" as const } } : {}),
        ...(req.effort && adaptive ? { output_config: { effort: req.effort } } : {}),
      },
      { signal: req.signal },
    );

    const toolIdByIndex = new Map<number, string>();
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          toolIdByIndex.set(event.index, event.content_block.id);
          yield { type: "tool_use_start", toolUseId: event.content_block.id, name: event.content_block.name };
        } else if (event.type === "content_block_delta") {
          const d = event.delta;
          if (d.type === "text_delta") yield { type: "text_delta", text: d.text };
          else if (d.type === "thinking_delta") yield { type: "thinking_delta", text: d.thinking };
          else if (d.type === "input_json_delta")
            yield {
              type: "tool_input_delta",
              toolUseId: toolIdByIndex.get(event.index) ?? String(event.index),
              partialJson: d.partial_json,
            };
        }
      }
      yield { type: "message", message: await stream.finalMessage() };
    } catch (e) {
      if (req.signal?.aborted) throw e;
      throw describeProviderError(e);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client.models) {
      // Bedrock / Vertex expose no models endpoint; the user types the model ID.
      return [];
    }
    const out: ModelInfo[] = [];
    try {
      for await (const m of this.client.models.list()) {
        out.push({
          id: m.id,
          displayName: m.display_name,
          contextWindow: m.max_input_tokens ?? undefined,
          maxOutput: m.max_tokens ?? undefined,
        });
      }
    } catch (e) {
      throw describeProviderError(e);
    }
    return out;
  }

  async probe(model: string): Promise<Capabilities> {
    if (this.modern) {
      return {
        streaming: true,
        tools: true,
        parallelTools: true,
        vision: true,
        thinking: true,
        promptCaching: this.connection.kind === "anthropic",
        serverTools: this.connection.kind === "anthropic",
      };
    }

    // anthropic-compatible: three tiny real requests (M-016). Auth/network errors from the
    // first request propagate so the UI shows a failed connection instead of "no tools".
    const caps: Capabilities = { ...UNKNOWN_CAPABILITIES, streaming: true, tools: false };
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: "Call the ping tool." }],
        tools: [{ name: "ping", description: "Returns pong.", input_schema: { type: "object", properties: {} } }],
      });
      caps.tools = true;
      caps.parallelTools = res.content.filter((b) => b.type === "tool_use").length > 1;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 404 || status === 422) {
        // Endpoint answered but rejects tools: verify plain chat works at all.
        try {
          await this.client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
        } catch (e2) {
          throw describeProviderError(e2);
        }
      } else {
        throw describeProviderError(e);
      }
    }
    caps.vision = await this.tryProbe(() =>
      this.client.messages.create({
        model,
        max_tokens: 16,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: TINY_PNG } },
              { type: "text", text: "ok?" },
            ],
          },
        ],
      }),
    );
    caps.thinking = await this.tryProbe(() =>
      this.client.messages.create({
        model,
        max_tokens: 64,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    return caps;
  }

  private async tryProbe(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  }
}

/** 1x1 transparent PNG for the vision probe. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return undefined;
  }
}
