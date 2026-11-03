import { z } from "zod";
import catalogJson from "../catalog.json" with { type: "json" };

const Install = z.discriminatedUnion("type", [
  z.object({ type: z.literal("npx"), package: z.string(), args: z.array(z.string()).optional() }),
  z.object({ type: z.literal("uvx"), package: z.string(), args: z.array(z.string()).optional() }),
  z.object({ type: z.literal("docker"), image: z.string(), args: z.array(z.string()).optional() }),
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

/**
 * One-click install pipeline (C-002). Each step reports progress to the UI.
 *
 *   1. detectRuntime   node/npx, uv/uvx, docker — offer bundled runtime if missing (C-011)
 *   2. collectInputs   folders, secrets (→ safeStorage vault), OAuth via browser (C-003)
 *   3. writeConfig     append to userData/mcp.json (same shape as Claude Desktop's mcpServers)
 *   4. connect         start the client (stdio or streamable HTTP)
 *   5. healthCheck     tools/list must succeed within 20s, else roll back steps 3–4
 */
export type InstallStep = "detectRuntime" | "collectInputs" | "writeConfig" | "connect" | "healthCheck";

export interface InstallProgress {
  step: InstallStep;
  state: "running" | "done" | "failed";
  message?: string;
}

// TODO(P3): implement install(entry, inputs, onProgress) in src/install.ts.
