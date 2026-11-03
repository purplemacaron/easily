import { z } from "zod";
import type { Tool } from "../types.js";

const input = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1).describe("Imperative description of the step"),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    )
    .describe("The complete task list; replaces the previous one"),
});

/** T-007 / H-020: the agent's visible checklist. Always send the whole list. */
export const todoTool: Tool<typeof input> = {
  name: "todo",
  description:
    "Keep a checklist for multi-step work. Send the complete list every time; mark exactly one item in_progress and completed items as you finish them. Skip it for trivial tasks.",
  input,
  risk: "read",
  parallelSafe: false,
  summarize: (i) => `${i.todos.length} items`,
  async run({ todos }, ctx) {
    ctx.setTodos?.(todos);
    const mark = { pending: "[ ]", in_progress: "[~]", completed: "[x]" } as const;
    return { content: todos.map((t) => `${mark[t.status]} ${t.content}`).join("\n") || "(empty list)" };
  },
};
