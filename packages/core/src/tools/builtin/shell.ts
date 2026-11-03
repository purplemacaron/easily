import { spawn } from "node:child_process";
import { z } from "zod";
import { killTree } from "../../util/process.js";
import { PathRefusedError, resolveInWorkspace } from "../paths.js";
import type { Tool } from "../types.js";

const MAX_CAPTURE = 1_000_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

const WIN = process.platform === "win32";
export const SHELL_NAME = WIN ? "PowerShell" : "bash";

const input = z.object({
  command: z.string().min(1).describe(`${SHELL_NAME} command to run`),
  timeout_ms: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe("Kill the command after this many ms (default 120000)"),
  cwd: z.string().optional().describe("Working directory inside the workspace (default: workspace root)"),
});

/** T-004: run a command in the OS shell (PowerShell on Windows, bash elsewhere). */
export const shellTool: Tool<typeof input> = {
  name: "shell",
  description: `Run a command in ${SHELL_NAME} inside the workspace and return its combined output and exit code. Use for builds, tests, git and other CLI tools; prefer the dedicated read/glob/grep/edit tools for file work. Commands time out after 2 minutes unless timeout_ms is set.`,
  input,
  risk: "exec",
  parallelSafe: false,
  summarize: (i) => i.command,
  async run({ command, timeout_ms = DEFAULT_TIMEOUT_MS, cwd }, ctx) {
    let workdir = ctx.cwd;
    if (cwd) {
      try {
        workdir = resolveInWorkspace(ctx, cwd, "read");
      } catch (e) {
        if (e instanceof PathRefusedError) return { content: e.message, isError: true };
        throw e;
      }
    }
    if (ctx.signal.aborted) return { content: "Aborted before start.", isError: true };

    const [file, args] = WIN
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'\n${command}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } } else { exit 0 }`,
          ],
        ]
      : ["bash", ["-lc", command]];

    return new Promise((resolve) => {
      const child = spawn(file, args, {
        cwd: workdir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: !WIN,
        env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
      });
      let out = "";
      let truncated = false;
      let timedOut = false;
      let aborted = false;
      const onData = (b: Buffer) => {
        if (out.length < MAX_CAPTURE) out += b.toString("utf8");
        else truncated = true;
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeout_ms);
      const onAbort = () => {
        aborted = true;
        killTree(child);
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      const finish = (code: number | null, err?: Error) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        let text = out.replace(/\r\n/g, "\n").trimEnd();
        if (truncated) text += "\n… output truncated at 1MB";
        if (err) {
          resolve({ content: `Failed to start ${SHELL_NAME}: ${err.message}`, isError: true });
        } else if (aborted) {
          resolve({ content: `${text}\n[aborted by user]`.trim(), isError: true });
        } else if (timedOut) {
          resolve({ content: `${text}\n[timed out after ${Math.round(timeout_ms / 1000)}s and was killed]`.trim(), isError: true });
        } else {
          resolve({ content: `${text}${text ? "\n" : ""}[exit code ${code ?? "?"}]`, isError: code !== 0 });
        }
      };
      child.on("error", (e) => finish(null, e));
      child.on("close", (code) => finish(code));
    });
  },
};
