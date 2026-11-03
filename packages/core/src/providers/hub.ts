import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { JsonFile } from "../util/json-file.js";
import { ANTHROPIC_DEFAULT_MODELS } from "./anthropic.js";
import { getPreset } from "./presets.js";
import { createProvider, type ModelRole, type RoleBinding } from "./registry.js";
import {
  describeProviderError,
  ProviderError,
  UNKNOWN_CAPABILITIES,
  type Capabilities,
  type Connection,
  type ModelInfo,
  type Provider,
} from "./types.js";

/** Secret storage abstraction. Desktop = Electron safeStorage vault, CLI/tests = memory/env. */
export interface SecretVault {
  get(ref: string): string | undefined;
  set(ref: string, value: string): void;
  delete(ref: string): void;
}

export class MemoryVault implements SecretVault {
  private m = new Map<string, string>();
  get(ref: string) {
    return this.m.get(ref);
  }
  set(ref: string, value: string) {
    this.m.set(ref, value);
  }
  delete(ref: string) {
    this.m.delete(ref);
  }
}

const ConnectionSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  kind: z.enum(["anthropic", "anthropic-compatible", "openai", "openai-compatible", "gemini", "bedrock", "vertex"]),
  label: z.string(),
  baseURL: z.string(),
  secretRef: z.string().optional(),
  extra: z.record(z.string()),
  models: z.array(z.object({ id: z.string(), displayName: z.string().optional(), contextWindow: z.number().optional(), maxOutput: z.number().optional() })),
  capabilities: z.object({
    streaming: z.boolean(),
    tools: z.boolean(),
    parallelTools: z.boolean(),
    vision: z.boolean(),
    thinking: z.boolean(),
    promptCaching: z.boolean(),
    serverTools: z.boolean(),
  }),
  createdAt: z.number(),
});
const ConnectionsFileSchema = z.object({ connections: z.array(ConnectionSchema).default([]) });

/** A connection as shown in the UI: never the key, only its last 4 characters. */
export interface ConnectionView extends Connection {
  keyLast4?: string;
  hasKey: boolean;
}

export interface ConnectInput {
  presetId: string;
  label: string;
  baseURL: string;
  apiKey?: string;
  extra: Record<string, string>;
  /** Model used for the capability probe when the endpoint lists none. */
  model?: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  models: ModelInfo[];
  capabilities?: Capabilities;
  error?: string;
}

export interface ResolvedModel {
  provider: Provider;
  connection: Connection;
  model: string;
  modelInfo?: ModelInfo;
}

/**
 * Connections CRUD + model lists + capability probe + role routing (M-014..M-017, M-022).
 * Connection metadata lives in connections.json; keys live only in the vault.
 */
export class ProviderHub {
  private file: JsonFile<typeof ConnectionsFileSchema>;

  constructor(
    dataDir: string,
    private readonly vault: SecretVault,
    private readonly getRoles: () => Partial<Record<ModelRole, RoleBinding>>,
  ) {
    this.file = new JsonFile(path.join(dataDir, "connections.json"), ConnectionsFileSchema, () => ({ connections: [] }));
  }

  private view(c: Connection): ConnectionView {
    const key = c.secretRef ? this.vault.get(c.secretRef) : undefined;
    return { ...c, hasKey: !!key, keyLast4: key ? key.slice(-4) : undefined };
  }

  async list(): Promise<ConnectionView[]> {
    return (await this.file.load()).connections.map((c) => this.view(c as Connection));
  }

  async get(id: string): Promise<Connection | undefined> {
    return (await this.file.load()).connections.find((c) => c.id === id) as Connection | undefined;
  }

  providerFor(connection: Connection): Provider {
    return createProvider(connection, connection.secretRef ? this.vault.get(connection.secretRef) : undefined);
  }

  async connect(input: ConnectInput): Promise<ConnectionView> {
    const preset = getPreset(input.presetId);
    if (!preset) throw new ProviderError(`Unknown provider preset: ${input.presetId}`);
    if (preset.requiresKey && !input.apiKey) throw new ProviderError("API 키가 필요합니다.");
    for (const f of preset.extraFields ?? []) {
      if (f.required && !input.extra[f.key]) throw new ProviderError(`${f.label} 값이 필요합니다.`);
    }
    const baseURL = (input.baseURL || preset.baseURL).trim();
    if (preset.editableBaseURL && !baseURL) throw new ProviderError("Base URL 이 필요합니다.");

    const id = randomUUID();
    const draft: Connection = {
      id,
      presetId: preset.id,
      kind: preset.kind,
      label: input.label.trim() || preset.name,
      baseURL,
      secretRef: input.apiKey ? `conn:${id}` : undefined,
      extra: input.extra,
      models: [],
      capabilities: { ...UNKNOWN_CAPABILITIES },
      createdAt: Date.now(),
    };
    if (draft.secretRef && input.apiKey) this.vault.set(draft.secretRef, input.apiKey);

    try {
      const { models, capabilities } = await this.inspect(draft, input.model);
      draft.models = models;
      draft.capabilities = capabilities;
    } catch (e) {
      if (draft.secretRef) this.vault.delete(draft.secretRef); // do not keep a key for a connection that failed
      throw e;
    }
    await this.file.update((cur) => ({ connections: [...cur.connections, draft] }));
    return this.view(draft);
  }

  /** Lists models and probes capabilities. 401/403/network errors fail; a missing /models endpoint does not. */
  private async inspect(conn: Connection, probeModel?: string): Promise<{ models: ModelInfo[]; capabilities: Capabilities }> {
    const provider = this.providerFor(conn);
    let models: ModelInfo[] = [];
    try {
      models = await provider.listModels();
    } catch (e) {
      const status = describeProviderError(e).status;
      if (status !== 404 && status !== 405 && status !== 501) throw e;
    }
    const model = probeModel || (conn.kind === "anthropic" ? ANTHROPIC_DEFAULT_MODELS.fast : models[0]?.id);
    if (!model) return { models, capabilities: { ...UNKNOWN_CAPABILITIES } };
    try {
      return { models, capabilities: await provider.probe(model) };
    } catch (e) {
      const status = describeProviderError(e).status;
      // Bad credentials / unreachable host are real failures; anything else keeps the defaults.
      if (status === 401 || status === 403 || status === undefined) throw e;
      return { models, capabilities: { ...UNKNOWN_CAPABILITIES } };
    }
  }

  /** Connection test (M-022): latency of a models listing + a fresh probe. Never throws. */
  async test(id: string, model?: string): Promise<TestResult> {
    const conn = await this.get(id);
    if (!conn) return { ok: false, latencyMs: 0, models: [], error: "연결을 찾을 수 없습니다." };
    const t0 = Date.now();
    try {
      const { models, capabilities } = await this.inspect(conn, model);
      const latencyMs = Date.now() - t0;
      await this.file.update((cur) => ({
        connections: cur.connections.map((c) => (c.id === id ? { ...c, models: models.length ? models : c.models, capabilities } : c)),
      }));
      return { ok: true, latencyMs, models, capabilities };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, models: [], error: describeProviderError(e).message };
    }
  }

  async remove(id: string): Promise<void> {
    const conn = await this.get(id);
    if (conn?.secretRef) this.vault.delete(conn.secretRef);
    await this.file.update((cur) => ({ connections: cur.connections.filter((c) => c.id !== id) }));
  }

  /** Role routing (M-017): explicit binding first, then sensible defaults. */
  async resolve(role: ModelRole): Promise<ResolvedModel> {
    const roles = this.getRoles();
    const binding = roles[role] ?? (role === "judge" ? roles.fast : undefined) ?? (role !== "main" ? roles.main : undefined);
    const conns = (await this.file.load()).connections as Connection[];

    if (binding) {
      const connection = conns.find((c) => c.id === binding.connectionId);
      if (!connection) throw new ProviderError("역할에 지정된 모델 연결이 삭제되었습니다. 설정 › 모델에서 다시 지정하세요.");
      return this.resolved(connection, binding.model);
    }

    const anthropic = conns.find((c) => c.kind === "anthropic");
    if (anthropic) {
      const model = role === "main" ? ANTHROPIC_DEFAULT_MODELS.main : role === "subagent" ? ANTHROPIC_DEFAULT_MODELS.subagent : ANTHROPIC_DEFAULT_MODELS.fast;
      return this.resolved(anthropic, model);
    }
    const first = conns[0];
    const model = first?.models[0]?.id;
    if (first && model) return this.resolved(first, model);
    throw new ProviderError("연결된 모델이 없습니다. 설정 › 모델에서 연결을 추가하세요.");
  }

  private resolved(connection: Connection, model: string): ResolvedModel {
    return { provider: this.providerFor(connection), connection, model, modelInfo: connection.models.find((m) => m.id === model) };
  }
}
