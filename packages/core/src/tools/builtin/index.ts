import type { ToolRegistry } from "../registry.js";
import type { Tool } from "../types.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { readTool } from "./read.js";
import { shellTool } from "./shell.js";
import { todoTool } from "./todo.js";
import { webFetchTool } from "./web-fetch.js";
import { writeTool } from "./write.js";

export const BUILTIN_TOOLS: Tool[] = [readTool, writeTool, editTool, globTool, grepTool, shellTool, webFetchTool, todoTool] as Tool[];

export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const t of BUILTIN_TOOLS) registry.register(t);
}

export { editTool, globTool, grepTool, readTool, shellTool, todoTool, webFetchTool, writeTool };
export { htmlToText } from "./web-fetch.js";
