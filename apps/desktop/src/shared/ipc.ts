import { z } from "zod";

/**
 * Every IPC channel lives here: name + payload schema. Preload exposes only these;
 * main validates every payload with the schema before acting on it.
 */
export const IPC = {
  "session:send": z.object({ sessionId: z.string(), text: z.string() }),
  "session:abort": z.object({ sessionId: z.string() }),
  "permission:answer": z.object({ requestId: z.string(), allow: z.boolean(), always: z.boolean().optional() }),
  "provider:list": z.object({}),
  "provider:connect": z.object({
    presetId: z.string(),
    label: z.string(),
    baseURL: z.string(),
    apiKey: z.string().optional(),
    extra: z.record(z.string()),
  }),
  "provider:test": z.object({ connectionId: z.string() }),
  "mcp:install": z.object({ catalogId: z.string(), inputs: z.record(z.string()) }),
  "jobs:list": z.object({}),
  "jobs:runNow": z.object({ jobId: z.string() }),
  "app:openExternal": z.object({ url: z.string().url() }),
} as const;

export type IpcChannel = keyof typeof IPC;
export type IpcPayload<C extends IpcChannel> = z.infer<(typeof IPC)[C]>;

/** main → renderer push channels */
export type PushChannel = "session:event" | "job:event" | "mcp:event" | "deeplink";
