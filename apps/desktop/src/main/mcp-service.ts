import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { JsonFile, type McpManager, type McpStatus, type SecretVault } from "@easily/core";
import { catalog, getCatalogEntry, requiredRuntime, resolveInstall, type LaunchSpec } from "@easily/mcp-catalog";
import type { CatalogItemDTO, McpEventDTO, McpServerDTO, McpStatusDTO } from "../shared/types";

/**
 * Installed MCP servers (C-002, C-012): config in mcp.json, secrets in the vault under
 * `mcp:<serverId>:<key>`. Catalog installs follow detectRuntime → collectInputs → writeConfig →
 * connect → healthCheck and roll back completely when the health check fails.
 */
const ServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  catalogId: z.string().optional(),
  enabled: z.boolean(),
  /** Non-secret install inputs. */
  inputs: z.record(z.string()).default({}),
  /** Input keys whose values are in the vault. */
  secretKeys: z.array(z.string()).default([]),
  custom: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()), envKeys: z.array(z.string()) }),
      z.object({ type: z.literal("http"), url: z.string(), headerKeys: z.array(z.string()) }),
    ])
    .optional(),
});
type Server = z.infer<typeof ServerSchema>;
const FileSchema = z.object({ servers: z.array(ServerSchema).default([]) });

export interface McpServiceDeps {
  dataDir: string;
  vault: SecretVault;
  manager: McpManager;
  emit(e: McpEventDTO): void;
  /** Is `npx` / `uvx` / `docker` on PATH? */
  hasCommand(command: string): boolean;
}

const secretRef = (serverId: string, key: string) => `mcp:${serverId}:${key}`;

export class McpService {
  private file: JsonFile<typeof FileSchema>;

  constructor(private readonly deps: McpServiceDeps) {
    this.file = new JsonFile(join(deps.dataDir, "mcp.json"), FileSchema, () => ({ servers: [] }));
  }

  /** Connect every enabled server (in the background, one after another). */
  async init(): Promise<void> {
    const { servers } = await this.file.load();
    for (const s of servers) {
      if (!s.enabled) this.deps.manager.setDisabled({ id: s.id, name: s.name, spec: { type: "stdio", command: "", args: [] } });
    }
    for (const s of servers.filter((x) => x.enabled)) await this.connectServer(s);
  }

  async catalog(): Promise<CatalogItemDTO[]> {
    const installed = new Set((await this.file.load()).servers.map((s) => s.id));
    return catalog.map((e) => {
      const rt = requiredRuntime(e);
      const oauth = e.install.type === "remote" && e.install.auth === "oauth";
      return {
        id: e.id,
        name: e.name,
        description: e.description,
        category: e.category,
        logo: e.logo,
        verified: e.verified,
        installType: e.install.type,
        inputs: e.inputs ?? [],
        installed: installed.has(e.id),
        runtime: rt ? { command: rt.command, available: this.deps.hasCommand(rt.command) } : undefined,
        supported: !oauth,
        unsupportedReason: oauth ? "원격 OAuth 인증은 v0.1 에서 아직 지원하지 않습니다." : undefined,
      };
    });
  }

  async list(): Promise<McpServerDTO[]> {
    const { servers } = await this.file.load();
    return servers.map((s) => this.dto(s));
  }

  private dto(s: Server): McpServerDTO {
    const live = this.deps.manager.status().find((x) => x.id === s.id);
    const status: McpStatusDTO = live ?? { id: s.id, name: s.name, state: s.enabled ? "connecting" : "disabled", toolCount: 0, tools: [], log: [] };
    return { id: s.id, name: s.name, catalogId: s.catalogId, custom: !s.catalogId, enabled: s.enabled, status };
  }

  async install(catalogId: string, inputs: Record<string, string>): Promise<McpServerDTO> {
    const entry = getCatalogEntry(catalogId);
    if (!entry) throw new Error(`알 수 없는 카탈로그 항목: ${catalogId}`);
    const progress = (step: Extract<McpEventDTO, { type: "progress" }>["step"], state: "running" | "done" | "failed", message?: string) =>
      this.deps.emit({ type: "progress", catalogId, step, state, message });

    progress("detectRuntime", "running");
    const rt = requiredRuntime(entry);
    if (rt && !this.deps.hasCommand(rt.command)) {
      const msg = `${rt.command} 를 찾을 수 없습니다. ${rt.runtime === "node" ? "Node.js" : rt.runtime === "uv" ? "uv" : "Docker"} 를 설치한 뒤 다시 시도하세요.`;
      progress("detectRuntime", "failed", msg);
      throw new Error(msg);
    }
    progress("detectRuntime", "done");

    progress("collectInputs", "running");
    const resolved = resolveInstall(entry, inputs);
    if (!resolved.ok) {
      progress("collectInputs", "failed", resolved.error);
      throw new Error(resolved.error);
    }
    progress("collectInputs", "done");

    progress("writeConfig", "running");
    const secretKeys = resolved.secretKeys;
    const plainInputs = Object.fromEntries(Object.entries(inputs).filter(([k]) => !secretKeys.includes(k)));
    const server: Server = { id: entry.id, name: entry.name, catalogId: entry.id, enabled: true, inputs: plainInputs, secretKeys };
    for (const k of secretKeys) if (inputs[k]) this.deps.vault.set(secretRef(server.id, k), inputs[k]!);
    await this.file.update((cur) => ({ servers: [...cur.servers.filter((s) => s.id !== server.id), server] }));
    progress("writeConfig", "done");

    progress("connect", "running");
    const status = await this.deps.manager.connect({ id: server.id, name: server.name, spec: resolved.spec });
    if (status.state !== "connected") {
      progress("connect", "failed", status.error);
      await this.rollback(server);
      throw new Error(status.error ?? "서버에 연결하지 못했습니다.");
    }
    progress("connect", "done");
    progress("healthCheck", "done", `${status.toolCount}개 도구 · ${status.latencyMs}ms`);
    return this.dto(server);
  }

  async addCustom(input: {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }): Promise<McpServerDTO> {
    if (!input.command && !input.url) throw new Error("실행 명령 또는 URL 중 하나가 필요합니다.");
    const id = `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "server"}-${randomBytes(2).toString("hex")}`;
    const custom: Server["custom"] = input.command
      ? { type: "stdio", command: input.command, args: input.args ?? [], envKeys: Object.keys(input.env ?? {}) }
      : { type: "http", url: input.url!, headerKeys: Object.keys(input.headers ?? {}) };
    const server: Server = { id, name: input.name, enabled: true, inputs: {}, secretKeys: [], custom };
    for (const [k, v] of Object.entries(input.env ?? {})) this.deps.vault.set(secretRef(id, `env:${k}`), v);
    for (const [k, v] of Object.entries(input.headers ?? {})) this.deps.vault.set(secretRef(id, `header:${k}`), v);
    await this.file.update((cur) => ({ servers: [...cur.servers, server] }));
    const status = await this.connectServer(server);
    if (status.state !== "connected") {
      await this.rollback(server);
      throw new Error(status.error ?? "서버에 연결하지 못했습니다.");
    }
    return this.dto(server);
  }

  async remove(serverId: string): Promise<void> {
    const { servers } = await this.file.load();
    const s = servers.find((x) => x.id === serverId);
    await this.deps.manager.disconnect(serverId);
    if (s) await this.rollback(s);
  }

  async setEnabled(serverId: string, enabled: boolean): Promise<McpServerDTO> {
    const s = await this.require(serverId);
    const next = await this.file.update((cur) => ({ servers: cur.servers.map((x) => (x.id === serverId ? { ...x, enabled } : x)) }));
    const updated = next.servers.find((x) => x.id === serverId)!;
    if (enabled) await this.connectServer(updated);
    else {
      await this.deps.manager.disconnect(serverId);
      const status = this.deps.manager.setDisabled({ id: s.id, name: s.name, spec: { type: "stdio", command: "", args: [] } });
      this.deps.emit({ type: "status", status: status as McpStatusDTO });
    }
    return this.dto(updated);
  }

  async restart(serverId: string): Promise<McpServerDTO> {
    const s = await this.require(serverId);
    await this.connectServer(s);
    return this.dto(s);
  }

  async shutdown(): Promise<void> {
    await this.deps.manager.closeAll();
  }

  // ── internals ────────────────────────────────────────────────────────────
  private async require(id: string): Promise<Server> {
    const s = (await this.file.load()).servers.find((x) => x.id === id);
    if (!s) throw new Error(`MCP 서버를 찾을 수 없습니다: ${id}`);
    return s;
  }

  private async connectServer(s: Server): Promise<McpStatus> {
    const spec = this.buildSpec(s);
    if ("error" in spec) {
      const status: McpStatus = { id: s.id, name: s.name, state: "error", toolCount: 0, tools: [], error: spec.error, log: [] };
      this.deps.emit({ type: "status", status });
      return status;
    }
    return this.deps.manager.connect({ id: s.id, name: s.name, spec: spec.spec });
  }

  private buildSpec(s: Server): { spec: LaunchSpec } | { error: string } {
    if (s.custom) {
      if (s.custom.type === "stdio") {
        const env = Object.fromEntries(s.custom.envKeys.map((k) => [k, this.deps.vault.get(secretRef(s.id, `env:${k}`)) ?? ""]));
        return { spec: { type: "stdio", command: s.custom.command, args: s.custom.args, env } };
      }
      const headers = Object.fromEntries(s.custom.headerKeys.map((k) => [k, this.deps.vault.get(secretRef(s.id, `header:${k}`)) ?? ""]));
      return { spec: { type: "http", url: s.custom.url, headers } };
    }
    const entry = s.catalogId ? getCatalogEntry(s.catalogId) : undefined;
    if (!entry) return { error: "카탈로그에서 제거된 항목입니다." };
    const secrets = Object.fromEntries(s.secretKeys.map((k) => [k, this.deps.vault.get(secretRef(s.id, k)) ?? ""]));
    const r = resolveInstall(entry, { ...s.inputs, ...secrets });
    return r.ok ? { spec: r.spec } : { error: r.error };
  }

  private async rollback(s: Server): Promise<void> {
    await this.deps.manager.disconnect(s.id);
    for (const k of s.secretKeys) this.deps.vault.delete(secretRef(s.id, k));
    for (const k of s.custom?.type === "stdio" ? s.custom.envKeys : []) this.deps.vault.delete(secretRef(s.id, `env:${k}`));
    for (const k of s.custom?.type === "http" ? s.custom.headerKeys : []) this.deps.vault.delete(secretRef(s.id, `header:${k}`));
    await this.file.update((cur) => ({ servers: cur.servers.filter((x) => x.id !== s.id) }));
  }
}
