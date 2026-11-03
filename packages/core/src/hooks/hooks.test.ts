import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HookRunner } from "./index.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-hooks-"));
  await writeFile(
    path.join(dir, "guard.mjs"),
    `let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
      if(j.tool==="shell" && String(j.input.command).includes("rm")) console.log(JSON.stringify({decision:"block",reason:"no rm"}));
      else if(j.tool==="write") console.log(JSON.stringify({updatedInput:{...j.input,path:"safe/"+j.input.path},additionalContext:"rewritten"}));
      else console.log("{}");});`,
  );
  await writeFile(path.join(dir, "exit2.mjs"), `console.error("nope from stderr"); process.exit(2);`);
  await writeFile(path.join(dir, "slow.mjs"), `setTimeout(()=>{},60000);`);
  await writeFile(path.join(dir, "mod.mjs"), `export default (event, payload) => ({ additionalContext: event + ":" + payload.prompt });`);
});
afterAll(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const node = (f: string) => `node "${path.join(dir, f)}"`;

describe("HookRunner", () => {
  it("blocks via JSON stdout", async () => {
    const h = new HookRunner({ PreToolUse: [{ matcher: "shell", command: node("guard.mjs") }] }, { cwd: dir });
    const out = await h.run("PreToolUse", { tool: "shell", input: { command: "rm -rf x" } });
    expect(out.block?.reason).toBe("no rm");
    expect((await h.run("PreToolUse", { tool: "shell", input: { command: "ls" } })).block).toBeUndefined();
  });

  it("skips hooks whose matcher does not match the tool", async () => {
    const h = new HookRunner({ PreToolUse: [{ matcher: "^shell$", command: node("guard.mjs") }] }, { cwd: dir });
    expect(await h.run("PreToolUse", { tool: "write", input: {} })).toEqual({});
  });

  it("updates tool input and adds context", async () => {
    const h = new HookRunner({ PreToolUse: [{ command: node("guard.mjs") }] }, { cwd: dir });
    const out = await h.run("PreToolUse", { tool: "write", input: { path: "a.md" } });
    expect(out.updatedInput).toEqual({ path: "safe/a.md" });
    expect(out.additionalContext).toBe("rewritten");
  });

  it("exit code 2 blocks with stderr as the reason", async () => {
    const h = new HookRunner({ PreToolUse: [{ command: node("exit2.mjs") }] }, { cwd: dir });
    expect((await h.run("PreToolUse", { tool: "x", input: {} })).block?.reason).toBe("nope from stderr");
  });

  it("times out without blocking the agent", async () => {
    const h = new HookRunner({ Stop: [{ command: node("slow.mjs"), timeoutMs: 300 }] }, { cwd: dir });
    expect(await h.run("Stop", {})).toEqual({});
  });

  it("runs JS module hooks and ignores broken ones", async () => {
    const h = new HookRunner({ UserPromptSubmit: [{ module: "mod.mjs" }, { module: "missing.mjs" }, { command: "this-command-does-not-exist-xyz" }] }, { cwd: dir });
    expect((await h.run("UserPromptSubmit", { prompt: "hi" })).additionalContext).toBe("UserPromptSubmit:hi");
  });
});
