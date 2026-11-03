import { z } from "zod";
import catalogJson from "../catalog.json" with { type: "json" };

const EnvMap = z.record(z.string()).optional();

const Install = z.discriminatedUnion("type", [
  z.object({ type: z.literal("npx"), package: z.string(), args: z.array(z.string()).optional(), env: EnvMap }),
  z.object({ type: z.literal("uvx"), package: z.string(), args: z.array(z.string()).optional(), env: EnvMap }),
  z.object({ type: z.literal("docker"), image: z.string(), args: z.array(z.string()).optional(), env: EnvMap }),
  z.object({ type: z.literal("remote"), url: z.string().url(), auth: z.enum(["none", "oauth", "header"]) }),
]);

export const CatalogEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(["core", "web", "dev", "work", "data", "media"]),
  logo: z.string(),
  install: Install,
  inputs: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.enum(["text", "secret", "folder", "folder-list", "url"]),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  verified: z.boolean(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const catalog: CatalogEntry[] = z.array(CatalogEntry).parse(catalogJson.servers);

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return catalog.find((e) => e.id === id);
}

/**
 * One-click install pipeline (C-002). Each step reports progress to the UI.
 *
 *   1. detectRuntime   node/npx, uv/uvx, docker — offer bundled runtime if missing (C-011)
 *   2. collectInputs   folders, secrets (→ safeStorage vault), OAuth via browser (C-003)
 *   3. writeConfig     append to userData/mcp.json
 *   4. connect         start the client (stdio or streamable HTTP)
 *   5. healthCheck     tools/list must succeed within 20s, else roll back steps 3–4
 *
 * This package owns the pure parts (steps 1–2: turning an entry + inputs into a launch spec);
 * @easily/core owns the connection (steps 4–5) and the desktop main process wires them together.
 */
export type InstallStep = "detectRuntime" | "collectInputs" | "writeConfig" | "connect" | "healthCheck";

export interface InstallProgress {
  step: InstallStep;
  state: "running" | "done" | "failed";
  message?: string;
}

export type LaunchSpec =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export type RuntimeName = "node" | "uv" | "docker";

export function requiredRuntime(entry: CatalogEntry): { runtime: RuntimeName; command: string } | null {
  switch (entry.install.type) {
    case "npx":
      return { runtime: "node", command: "npx" };
    case "uvx":
      return { runtime: "uv", command: "uvx" };
    case "docker":
      return { runtime: "docker", command: "docker" };
    default:
      return null;
  }
}

/** Splits a folder-list value (newline or ';' separated; never ':' because of Windows drive letters). */
export function splitList(value: string): string[] {
  return value.split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
}

export type ResolveResult = { ok: true; spec: LaunchSpec; secretKeys: string[] } | { ok: false; error: string };

/**
 * Entry + user inputs → how to launch it. `{{key}}` placeholders in args/env are substituted;
 * an argument that is exactly `{{key}}` for a folder-list input expands to one argument per folder.
 * Remote entries that need OAuth are reported as unsupported in v0.1 (C-003 is not built yet).
 */
export function resolveInstall(entry: CatalogEntry, inputs: Record<string, string>): ResolveResult {
  for (const field of entry.inputs ?? []) {
    if (field.required && !inputs[field.key]?.trim()) return { ok: false, error: `${field.label} 값이 필요합니다.` };
  }
  const secretKeys = (entry.inputs ?? []).filter((f) => f.kind === "secret").map((f) => f.key);
  const kindOf = (key: string) => entry.inputs?.find((f) => f.key === key)?.kind;
  const sub = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => inputs[k] ?? "");

  const expandArgs = (args: string[] = []): string[] =>
    args.flatMap((a) => {
      const m = /^\{\{(\w+)\}\}$/.exec(a);
      if (m && kindOf(m[1]!) === "folder-list") return splitList(inputs[m[1]!] ?? "");
      return [sub(a)];
    });
  const expandEnv = (env?: Record<string, string>) =>
    env ? Object.fromEntries(Object.entries(env).map(([k, v]) => [k, sub(v)])) : undefined;

  const i = entry.install;
  switch (i.type) {
    case "npx":
      return { ok: true, secretKeys, spec: { type: "stdio", command: "npx", args: ["-y", i.package, ...expandArgs(i.args)], env: expandEnv(i.env) } };
    case "uvx":
      return { ok: true, secretKeys, spec: { type: "stdio", command: "uvx", args: [i.package, ...expandArgs(i.args)], env: expandEnv(i.env) } };
    case "docker":
      return { ok: true, secretKeys, spec: { type: "stdio", command: "docker", args: ["run", "-i", "--rm", i.image, ...expandArgs(i.args)], env: expandEnv(i.env) } };
    case "remote":
      if (i.auth === "oauth") {
        return { ok: false, error: "이 서버는 브라우저 OAuth 인증이 필요하며 v0.1 에서는 아직 지원하지 않습니다." };
      }
      return {
        ok: true,
        secretKeys,
        spec: { type: "http", url: i.url, headers: i.auth === "header" && inputs.token ? { Authorization: `Bearer ${inputs.token}` } : undefined },
      };
  }
}
