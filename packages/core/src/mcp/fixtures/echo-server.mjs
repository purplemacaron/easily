// Tiny stdio MCP server used by manager.test.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "1.0.0" });
server.tool("echo", "Echo the message back", { msg: z.string() }, async ({ msg }) => ({ content: [{ type: "text", text: `echo: ${msg}` }] }));
server.tool("fail", "Always fails", {}, async () => ({ content: [{ type: "text", text: "nope" }], isError: true }));
await server.connect(new StdioServerTransport());
