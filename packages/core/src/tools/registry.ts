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

  /** Removes every tool whose name starts with `prefix` (used when an MCP server disconnects). */
  unregisterPrefix(prefix: string): number {
    let n = 0;
    for (const name of [...this.tools.keys()]) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        n++;
      }
    }
    return n;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: (t.jsonSchema ?? zodToJsonSchema(t.input, { target: "openApi3" })) as ToolDefinition["input_schema"],
      }));
  }
}
