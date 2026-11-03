import OpenAI from "openai";
import { OpenAIStreamAssembler, toOpenAIMessages, toOpenAITools } from "./translate/openai.js";
import {
  describeProviderError,
  ProviderError,
  UNKNOWN_CAPABILITIES,
  type Capabilities,
  type CompletionRequest,
  type Connection,
  type ModelInfo,
  type Provider,
  type ProviderEvent,
} from "./types.js";

/**
 * Adapter for kind "openai" and "openai-compatible" (OpenRouter, Groq, Ollama, Azure, Gemini's
 * OpenAI endpoint, ...). Uses the official `openai` SDK with the connection's baseURL and the
 * translators in translate/openai.ts; the agent loop never branches on provider.
 */
export class OpenAICompatibleProvider implements Provider {
  private readonly client: OpenAI;

  constructor(
    readonly connection: Connection,
    apiKey: string | undefined,
  ) {
    if (/\{[a-z-]+\}/i.test(connection.baseURL)) {
      throw new ProviderError(`Base URL still contains a placeholder: ${connection.baseURL}`);
    }
    const headers = parseHeaders(connection.extra.headers) ?? {};
    if (/\.openai\.azure\.com/i.test(connection.baseURL) && apiKey) headers["api-key"] = apiKey;
    this.client = new OpenAI({
      // Local servers (Ollama, LM Studio) need no key but the SDK insists on a non-empty value.
      apiKey: apiKey || "not-needed",
      baseURL: connection.baseURL || undefined,
      defaultHeaders: headers,
    });
  }

  async *stream(req: CompletionRequest): AsyncIterable<ProviderEvent> {
    const assembler = new OpenAIStreamAssembler(req.model);
    const messages = toOpenAIMessages(req.system, req.messages);
    const tools = req.tools.length ? toOpenAITools(req.tools) : undefined;
    const limit = this.connection.kind === "openai" ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens };

    const open = (withUsage: boolean) =>
      this.client.chat.completions.create(
        {
          model: req.model,
          messages,
          ...(tools ? { tools } : {}),
          ...limit,
          stream: true,
          ...(withUsage ? { stream_options: { include_usage: true } } : {}),
        },
        { signal: req.signal },
      );

    try {
      let stream;
      try {
        stream = await open(true);
      } catch (e) {
        // A few servers reject stream_options; retry once without usage reporting.
        if ((e as { status?: number }).status === 400 && /stream_options/i.test(String((e as Error).message))) {
          stream = await open(false);
        } else throw e;
      }
      for await (const chunk of stream) {
        for (const ev of assembler.push(chunk)) yield ev;
      }
      yield { type: "message", message: assembler.finalMessage() };
    } catch (e) {
      if (req.signal?.aborted) throw e;
      throw describeProviderError(e);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const out: ModelInfo[] = [];
      for await (const m of this.client.models.list()) out.push({ id: m.id });
      return out.sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      throw describeProviderError(e);
    }
  }

  async probe(model: string): Promise<Capabilities> {
    const caps: Capabilities = { ...UNKNOWN_CAPABILITIES, streaming: true, tools: false };
    try {
      await this.client.chat.completions.create({
        model,
        max_tokens: 64,
        messages: [{ role: "user", content: "Call the ping tool." }],
        tools: [{ type: "function", function: { name: "ping", description: "Returns pong.", parameters: { type: "object", properties: {} } } }],
      });
      caps.tools = true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 404 || status === 422) {
        // The endpoint is reachable but rejects tools: confirm that plain chat works at all.
        try {
          await this.client.chat.completions.create({ model, max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
        } catch (e2) {
          throw describeProviderError(e2);
        }
      } else {
        throw describeProviderError(e);
      }
    }
    try {
      await this.client.chat.completions.create({
        model,
        max_tokens: 16,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
              { type: "text", text: "ok?" },
            ],
          },
        ],
      });
      caps.vision = true;
    } catch {
      caps.vision = false;
    }
    return caps;
  }
}

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
