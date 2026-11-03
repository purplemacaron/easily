import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolResult } from "../tools/types.js";

/** How to reach an MCP server. Mirrors @easily/mcp-catalog's LaunchSpec (kept structural so core stays standalone). */
export type McpLaunchSpec =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface McpServerConfig {
  id: string;
  name: string;
  spec: McpLaunchSpec;
}

export type McpState = "connecting" | "connected" | "error" | "disabled";

export interface McpStatus {
  id: string;
  name: string;
  state: McpState;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  /** Time the tools/list health check took. */
  latencyMs?: number;
  error?: string;
  /** Last stderr lines of a stdio server (C-007). */
  log: string[];
}

export const HEALTH_CHECK_MS = 20_000;
const CONNECT_MS = 120_000; // first run of an npx/uvx server may download the package
const CALL_MS = 120_000;
const LOG_LINES = 100;

export function toolNameFor(serverId: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${clean(serverId)}__${clean(tool)}`.slice(0, 64);
}

interface Live {
  config: McpServerConfig;
  client?: Client;
  status: McpStatus;
}

/**
 * MCP client manager (C-006, C-007). Connects stdio and streamable-HTTP servers, health-checks
 * them with tools/list, and registers their tools in the ToolRegistry as `mcp__<server>__<tool>`
 * with risk "network" (so every call is permission-checked like any other outside action).
 */
export class McpManager {
  private live = new Map<string, Live>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly onChange: (status: McpStatus) => void = () => undefined,
  ) {}

  status(): McpStatus[] {
    return [...this.live.values()].map((l) => l.status);
  }

  /** Connect (replacing an existing connection with the same id) and register its tools. Never throws. */
  async connect(config: McpServerConfig): Promise<McpStatus> {
    await this.disconnect(config.id);
    const status: McpStatus = { id: config.id, name: config.name, state: "connecting", toolCount: 0, tools: [], log: [] };
    const live: Live = { config, status };
    this.live.set(config.id, live);
    this.onChange(status);

    const started = Date.now();
    let client: Client | undefined;
    try {
      client = new Client({ name: "easily", version: "0.1.0" }, { capabilities: {} });
      const transport = this.makeTransport(config.spec, status);
      client.onclose = () => {
        if (this.live.get(config.id)?.client === client && status.state === "connected") {
          status.state = "error";
          status.error = "서버 연결이 끊어졌습니다.";
          this.registry.unregisterPrefix(toolNameFor(config.id, ""));
          status.toolCount = 0;
          this.onChange(status);
        }
      };
      await withTimeout(client.connect(transport), CONNECT_MS, "서버를 시작하지 못했습니다(시간 초과).");
      // Health check (C-002): tools/list within 20s.
      const t0 = Date.now();
      const listed = await withTimeout(client.listTools(), HEALTH_CHECK_MS, "tools/list 응답이 20초 안에 오지 않았습니다.");
      status.latencyMs = Date.now() - t0;
      live.client = client;

      const prefix = toolNameFor(config.id, "");
      this.registry.unregisterPrefix(prefix);
      status.tools = [];
      for (const t of listed.tools) {
        const tool = wrapTool(config.id, client, t);
        try {
          this.registry.register(tool);
          status.tools.push({ name: tool.name, description: t.description ?? "" });
        } catch {
          /* duplicate after name sanitising: first one wins */
        }
      }
      status.toolCount = status.tools.length;
      status.state = "connected";
      status.error = undefined;
    } catch (e) {
      status.state = "error";
      status.error = explain(e);
      status.latencyMs = Date.now() - started;
      try {
        await client?.close();
      } catch {
        /* already dead */
      }
    }
    this.onChange(status);
    return status;
  }

  async disconnect(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    this.registry.unregisterPrefix(toolNameFor(id, ""));
    try {
      await live.client?.close();
    } catch {
      /* ignore */
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)));
  }

  /** Marks a configured-but-off server so the UI can list it. */
  setDisabled(config: McpServerConfig): McpStatus {
    const status: McpStatus = { id: config.id, name: config.name, state: "disabled", toolCount: 0, tools: [], log: [] };
    this.live.set(config.id, { config, status });
    return status;
  }

  private makeTransport(spec: McpLaunchSpec, status: McpStatus) {
    if (spec.type === "http") {
      return new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: spec.headers ? { headers: spec.headers } : undefined });
    }
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...getDefaultEnvironment(), ...(spec.env ?? {}) },
      cwd: spec.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (d: Buffer) => {
      for (const line of d.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        status.log.push(line);
        if (status.log.length > LOG_LINES) status.log.shift();
      }
    });
    return transport;
  }
}

const ContentSchema = z.array(z.object({ type: z.string() }).passthrough());

function wrapTool(serverId: string, client: Client, t: { name: string; description?: string; inputSchema: unknown }): Tool {
  const schema = (t.inputSchema && typeof t.inputSchema === "object" ? { ...(t.inputSchema as Record<string, unknown>) } : {}) as Record<string, unknown>;
  schema.type = "object";
  return {
    name: toolNameFor(serverId, t.name),
    description: `[MCP ${serverId}] ${t.description ?? t.name}`,
    input: z.record(z.unknown()),
    jsonSchema: schema,
    risk: "network",
    parallelSafe: false,
    summarize: (i) => JSON.stringify(i).slice(0, 200),
    async run(input, ctx): Promise<ToolResult> {
      try {
        const res = await client.callTool({ name: t.name, arguments: input }, undefined, { signal: ctx.signal, timeout: CALL_MS });
        const parts = ContentSchema.safeParse(res.content);
        const text = parts.success
          ? parts.data
              .map((c) => {
                if (c.type === "text") return String(c.text ?? "");
                if (c.type === "image") return "[image result omitted]";
                if (c.type === "resource") return String((c.resource as { text?: string } | undefined)?.text ?? "[resource]");
                return `[${c.type}]`;
              })
              .join("\n")
          : JSON.stringify(res.structuredContent ?? res.content ?? "");
        return { content: text || "(empty result)", isError: res.isError === true };
      } catch (e) {
        return { content: `MCP call failed: ${explain(e)}`, isError: true };
      }
    },
  };
}

function explain(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|unauthori[sz]ed/i.test(msg)) return "인증이 필요합니다(OAuth 는 v0.1 에서 아직 지원하지 않습니다).";
  if (/ENOENT/.test(msg)) return "실행 파일을 찾을 수 없습니다. Node.js(npx) / uv(uvx) / Docker 설치를 확인하세요.";
  return msg;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
