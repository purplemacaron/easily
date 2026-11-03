import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "../providers/types.js";
import type { Tool } from "./types.js";

/**
 * Holds built-in, skill-provided and MCP tools. Definitions are emitted in a deterministic
 * (name-sorted) order so the tools block of the prompt stays byte-identical across turns
 * and keeps the prompt cache warm (M-020).
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: zodToJsonSchema(t.input, { target: "openApi3" }) as ToolDefinition["input_schema"],
      }));
  }
}
