import type { z } from "zod";

/** Permission class of a tool. Drives the permission check and the UI badge. */
export type ToolRisk = "read" | "write" | "exec" | "network";

export interface ToolContext {
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
  /** Called before any file write so the checkpoint system can snapshot (H-011). */
  beforeWrite(paths: string[]): Promise<void>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** Large outputs are written to disk and only a summary goes back to the model (H-021). */
  spilledToPath?: string;
}

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  input: I;
  risk: ToolRisk;
  /** Safe to run concurrently with other parallel-safe tools in the same turn (A-002). */
  parallelSafe: boolean;
  /** Short argument string matched by permission rules, e.g. shell → the command, write → the path. */
  summarize?(input: z.infer<I>): string;
  run(input: z.infer<I>, ctx: ToolContext): Promise<ToolResult>;
}
