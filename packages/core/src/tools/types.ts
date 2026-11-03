import type { z } from "zod";

/** Permission class of a tool. Drives the permission check and the UI badge. */
export type ToolRisk = "read" | "write" | "exec" | "network";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ToolContext {
  /** Workspace root. File tools refuse paths outside it (and outside `extraRoots`). */
  cwd: string;
  sessionId: string;
  signal: AbortSignal;
  /** Called before any file write so the checkpoint system can snapshot (H-011). */
  beforeWrite(paths: string[]): Promise<void>;
  /** Extra directories tools may touch besides cwd (job profiles' writableDirs). */
  extraRoots?: string[];
  /** Where oversized outputs are spilled; readable by the `read` tool (H-021). */
  spillDir?: string;
  /** Replace the session's task list (T-007 / H-020). */
  setTodos?(items: TodoItem[]): void;
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
  /** Raw JSON schema sent to the model instead of one derived from `input` (MCP tools). */
  jsonSchema?: Record<string, unknown>;
  risk: ToolRisk;
  /** Safe to run concurrently with other parallel-safe tools in the same turn (A-002). */
  parallelSafe: boolean;
  /** Short argument string matched by permission rules, e.g. shell → the command, write → the path. */
  summarize?(input: z.infer<I>): string;
  run(input: z.infer<I>, ctx: ToolContext): Promise<ToolResult>;
}
