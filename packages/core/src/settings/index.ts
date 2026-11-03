import path from "node:path";
import { z } from "zod";
import { HookConfigSchema } from "../hooks/index.js";
import { JsonFile } from "../util/json-file.js";

/**
 * User settings (H-017 subset): one settings.json in the data dir, validated by this schema.
 * Unknown keys are dropped; missing keys take the defaults below.
 */
export const RoleBindingSchema = z.object({
  connectionId: z.string(),
  model: z.string(),
  fallbacks: z.array(z.object({ connectionId: z.string(), model: z.string() })).optional(),
});

export const SettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("light"),
  permissionMode: z.enum(["ask", "auto-edit", "plan", "yolo"]).default("ask"),
  /** Never forced on: stays false until the user turns it on (S-002). */
  launchAtLogin: z.boolean().default(false),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  rules: z.object({ allow: z.array(z.string()).default([]), deny: z.array(z.string()).default([]) }).default({}),
  hooks: HookConfigSchema.default({}),
  /** Default workspace folder for new sessions. */
  defaultCwd: z.string().optional(),
  roles: z.object({ main: RoleBindingSchema, fast: RoleBindingSchema, subagent: RoleBindingSchema, judge: RoleBindingSchema }).partial().default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

export function settingsFile(dataDir: string): JsonFile<typeof SettingsSchema> {
  return new JsonFile(path.join(dataDir, "settings.json"), SettingsSchema, defaultSettings);
}
