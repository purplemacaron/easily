import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { AssistantMessage, MessageParam, ProviderEvent, ToolDefinition } from "../types.js";

/**
 * Core (Anthropic Messages) ↔ OpenAI Chat Completions translation (M-002/M-003).
 *
 *  - tool_use / tool_result blocks  ↔  tool_calls / role:"tool" messages
 *  - base64 / url images            →  image_url (data URI for base64)
 *  - thinking blocks                →  dropped (other providers cannot read them)
 *  - finish_reason                  →  stop_reason (stop→end_turn, tool_calls→tool_use,
 *                                      length→max_tokens, content_filter→refusal)
 */
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type UserPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

export function toOpenAITools(tools: ToolDefinition[]): ChatTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
  }));
}

export function toOpenAIMessages(system: string, messages: MessageParam[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content } as ChatMessage);
      continue;
    }
    if (m.role === "assistant") {
      const texts: string[] = [];
      const calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
      for (const b of m.content) {
        if (b.type === "text") texts.push(b.text);
        else if (b.type === "tool_use") {
          calls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
        }
        // thinking / redacted_thinking / server tool blocks: dropped on purpose.
      }
      const text = texts.join("");
      if (!text && calls.length === 0) continue;
      out.push({
        role: "assistant",
        content: text || (calls.length ? null : ""),
        ...(calls.length ? { tool_calls: calls } : {}),
      } as ChatMessage);
      continue;
    }

    // user message: tool_result blocks become role:"tool" messages (they must directly follow the
    // assistant tool_calls message), everything else stays one user message after them.
    const parts: UserPart[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: toolResultText(b) });
      } else if (b.type === "text") {
        parts.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        if (b.source.type === "base64") {
          parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
        } else if (b.source.type === "url") {
          parts.push({ type: "image_url", image_url: { url: b.source.url } });
        } else {
          parts.push({ type: "text", text: "[image file reference omitted: not supported by this provider]" });
        }
      } else if (b.type === "document") {
        parts.push({ type: "text", text: "[document attachment omitted: not supported by this provider]" });
      }
    }
    if (parts.length > 0) {
      const onlyText = parts.every((p) => p.type === "text");
      out.push({
        role: "user",
        content: onlyText ? parts.map((p) => (p as { text: string }).text).join("\n") : parts,
      } as ChatMessage);
    }
  }
  return out;
}

function toolResultText(b: Anthropic.ToolResultBlockParam): string {
  let text: string;
  if (typeof b.content === "string") text = b.content;
  else if (!b.content) text = "";
  else
    text = b.content
      .map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[image omitted]" : ""))
      .filter(Boolean)
      .join("\n");
  return b.is_error ? `Error: ${text}` : text;
}

export function mapFinishReason(reason: string | null | undefined, hasToolCalls: boolean): Anthropic.StopReason {
  if (hasToolCalls) return "tool_use"; // some local servers report "stop" even with tool calls
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end_turn";
  }
}

/** The subset of ChatCompletionChunk the assembler reads (also what tests fabricate). */
export interface ChunkLike {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{ index?: number; id?: string | null; function?: { name?: string | null; arguments?: string | null } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
}

/** Folds streamed chunks into ProviderEvents and, at the end, an Anthropic-shaped Message. */
export class OpenAIStreamAssembler {
  private text = "";
  private finish: string | null | undefined;
  private usage = { input: 0, output: 0, cacheRead: 0 };
  private id = "";
  private model = "";
  private calls = new Map<number, { id: string; name: string; args: string }>();

  constructor(private readonly requestedModel: string) {}

  push(chunk: ChunkLike): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    if (chunk.id) this.id = chunk.id;
    if (chunk.model) this.model = chunk.model;
    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      this.usage = {
        input: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached),
        output: chunk.usage.completion_tokens ?? 0,
        cacheRead: cached,
      };
    }
    for (const choice of chunk.choices ?? []) {
      const d = choice.delta;
      if (d?.content) {
        this.text += d.content;
        events.push({ type: "text_delta", text: d.content });
      }
      const reasoning = d?.reasoning_content ?? d?.reasoning;
      if (reasoning) events.push({ type: "thinking_delta", text: reasoning });
      for (const tc of d?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        let call = this.calls.get(idx);
        if (!call) {
          call = { id: tc.id || `call_${idx}_${Date.now().toString(36)}`, name: "", args: "" };
          this.calls.set(idx, call);
        }
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) {
          const first = call.name === "";
          call.name += tc.function.name;
          if (first) events.push({ type: "tool_use_start", toolUseId: call.id, name: call.name });
        }
        if (tc.function?.arguments) {
          call.args += tc.function.arguments;
          events.push({ type: "tool_input_delta", toolUseId: call.id, partialJson: tc.function.arguments });
        }
      }
      if (choice.finish_reason) this.finish = choice.finish_reason;
    }
    return events;
  }

  finalMessage(): AssistantMessage {
    const content: Anthropic.ContentBlock[] = [];
    if (this.text) content.push({ type: "text", text: this.text, citations: null } as Anthropic.TextBlock);
    const ordered = [...this.calls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, c] of ordered) {
      if (!c.name) continue;
      content.push({ type: "tool_use", id: c.id, name: c.name, input: parseArgs(c.args) } as Anthropic.ToolUseBlock);
    }
    const hasTools = content.some((b) => b.type === "tool_use");
    return {
      id: this.id || `msg_${Date.now().toString(36)}`,
      type: "message",
      role: "assistant",
      model: this.model || this.requestedModel,
      content,
      stop_reason: mapFinishReason(this.finish, hasTools),
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: this.usage.input,
        output_tokens: this.usage.output,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: this.usage.cacheRead || null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
    } as unknown as AssistantMessage;
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
