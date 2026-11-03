#!/usr/bin/env node
/**
 * easily — headless CLI on the same harness (A-018).
 *
 *   easily -p "요약해줘" [--cwd .] [--model claude-opus-5-5] [--mode plan|auto-edit|yolo|ask] [--effort high] [--json]
 *
 * Credentials come from ANTHROPIC_API_KEY (optionally ANTHROPIC_BASE_URL); the CLI does not read
 * the desktop app's vault. There is no human to ask, so with `--mode ask` (and in `plan`) every
 * write / command / network call is declined; the default mode is the read-only `plan`.
 *
 * Output: plain text to stdout (tool activity on stderr), or with --json one AgentEvent per
 * line (NDJSON) ending in a {"type":"result",...} line. Exit code: 0 finished, 1 failed/stopped, 2 usage.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ANTHROPIC_DEFAULT_MODELS,
  AnthropicProvider,
  HookRunner,
  SHELL_NAME,
  ToolRegistry,
  UNKNOWN_CAPABILITIES,
  buildSystemPrompt,
  computeCostUsd,
  readProjectInstructions,
  registerBuiltinTools,
  runTurn,
  type AgentEvent,
  type Connection,
  type Effort,
  type MessageParam,
  type PermissionMode,
} from "@easily/core";

const MODES = ["plan", "auto-edit", "yolo", "ask"] as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function usage(msg?: string): never {
  if (msg) console.error(`easily: ${msg}`);
  console.error('usage: easily -p "<prompt>" [--cwd <dir>] [--model <id>] [--mode plan|auto-edit|yolo|ask] [--effort low|medium|high|xhigh|max] [--json]');
  process.exit(2);
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        prompt: { type: "string", short: "p" },
        cwd: { type: "string" },
        model: { type: "string" },
        mode: { type: "string" },
        effort: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    }));
  } catch (e) {
    return usage((e as Error).message);
  }
  if (values.help || !values.prompt) return usage();

  const mode = (values.mode ?? "plan") as PermissionMode;
  if (!MODES.includes(mode as (typeof MODES)[number])) return usage(`--mode must be one of ${MODES.join(", ")}`);
  const effort = (values.effort ?? "high") as Effort;
  if (!EFFORTS.includes(effort)) return usage(`--effort must be one of ${EFFORTS.join(", ")}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("easily: ANTHROPIC_API_KEY is not set.");
    return 1;
  }
  const model = values.model ?? ANTHROPIC_DEFAULT_MODELS.main;
  const cwd = resolve(values.cwd ?? process.cwd());
  const json = values.json === true;

  const connection: Connection = {
    id: "cli",
    presetId: "anthropic",
    kind: "anthropic",
    label: "ANTHROPIC_API_KEY",
    baseURL: process.env.ANTHROPIC_BASE_URL ?? "",
    extra: {},
    models: [],
    capabilities: { ...UNKNOWN_CAPABILITIES, tools: true, thinking: true, parallelTools: true },
    createdAt: Date.now(),
  };
  const provider = new AnthropicProvider(connection, apiKey);

  const tools = new ToolRegistry();
  registerBuiltinTools(tools);

  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());

  const system = buildSystemPrompt({
    cwd,
    platform: process.platform,
    shell: SHELL_NAME,
    projectInstructions: await readProjectInstructions(cwd),
    mode,
    toolsEnabled: true,
  });

  const history: MessageParam[] = [];
  let text = "";
  let cost = 0;
  let stopReason: string = "end_turn";
  let detail: string | undefined;
  const emit = (ev: AgentEvent) => {
    if (json) {
      // Thinking is internal; everything else is useful to machine readers.
      if (ev.type !== "thinking_delta") process.stdout.write(JSON.stringify(ev) + "\n");
      return;
    }
    if (ev.type === "text_delta") process.stdout.write(ev.text);
    else if (ev.type === "tool_start") console.error(`\n[tool] ${ev.name} ${summary(ev.input)}`);
    else if (ev.type === "tool_end" && ev.result.isError) console.error(`[tool error] ${ev.result.content.split("\n")[0]}`);
  };

  const gen = runTurn(history, values.prompt, {
    provider,
    model,
    effort,
    system,
    tools,
    hooks: new HookRunner({}, { cwd }),
    mode,
    rules: { allow: [], deny: [] },
    toolContext: { cwd, sessionId: "cli", beforeWrite: async () => undefined },
    // Headless: nobody can approve, so anything that needs approval is declined.
    askPermission: async () => false,
    signal: abort.signal,
    maxTokens: 64_000,
  });
  for (;;) {
    const r = await gen.next();
    if (r.done) break;
    const ev = r.value;
    if (ev.type === "text_delta") text += ev.text;
    if (ev.type === "usage") cost += computeCostUsd(ev.model, ev.usage) ?? 0;
    if (ev.type === "stopped") {
      stopReason = ev.reason;
      detail = ev.detail;
    }
    // A new assistant message restarts the "final text" (earlier ones were narration between tool calls).
    if (ev.type === "message" && ev.message.role === "assistant") text = textOf(ev.message);
    emit(ev);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ type: "result", reason: stopReason, detail, text, costUsd: cost, model, cwd }) + "\n");
  } else {
    process.stdout.write("\n");
    if (detail) console.error(`easily: ${stopReason}: ${detail}`);
    else if (stopReason !== "end_turn") console.error(`easily: stopped (${stopReason})`);
  }
  return stopReason === "end_turn" ? 0 : 1;
}

function textOf(m: MessageParam): string {
  return typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function summary(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 100 ? s.slice(0, 100) + "…" : s;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`easily: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
