#!/usr/bin/env node
/**
 * easily — headless CLI on the same harness (A-018).
 *
 *   easily -p "요약해줘" [--cwd .] [--model claude-opus-5-5] [--mode plan] [--json]
 *   easily jobs run <id>          run a scheduled job now (used by the desktop scheduler worker)
 *   easily mcp list
 *
 * TODO(P2): argument parsing (node:util parseArgs), load settings + vault from the same
 * userData dir as the desktop app, stream AgentEvents to stdout (text or NDJSON).
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
    json: { type: "boolean" },
  },
  allowPositionals: true,
});

if (!values.prompt) {
  console.error('usage: easily -p "<prompt>"');
  process.exit(1);
}
console.error("easily CLI: not implemented yet (PLAN Phase 2)");
process.exit(2);
