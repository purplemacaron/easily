import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TodoItem, ToolContext } from "../types.js";
import { editTool, globTool, grepTool, readTool, shellTool, todoTool, writeTool } from "./index.js";
import { htmlToText } from "./web-fetch.js";

let root: string;
let before: string[];
let todos: TodoItem[];

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: root,
    sessionId: "s1",
    signal: new AbortController().signal,
    beforeWrite: async (p) => void before.push(...p),
    setTodos: (t) => (todos = t),
    ...over,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "easily-tools-"));
  before = [];
  todos = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("read / write / edit", () => {
  it("writes (creating folders), reads back with line numbers, and snapshots before writing", async () => {
    const w = await writeTool.run({ path: "a/b.md", content: "one\ntwo\nthree" }, ctx());
    expect(w.isError).toBeUndefined();
    expect(before).toEqual([path.join(root, "a", "b.md")]);
    const r = await readTool.run({ path: "a/b.md", offset: 1, limit: 1 }, ctx());
    expect(r.content).toContain("2\ttwo");
    expect(r.content).toContain("1 more lines");
  });

  it("refuses paths outside the workspace (.., absolute, symlink)", async () => {
    expect((await readTool.run({ path: "../x.txt" }, ctx())).isError).toBe(true);
    expect((await writeTool.run({ path: path.join(tmpdir(), "evil.txt"), content: "x" }, ctx())).isError).toBe(true);
    const outside = await mkdtemp(path.join(tmpdir(), "easily-out-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "s");
      await symlink(outside, path.join(root, "link"), "junction");
      expect((await readTool.run({ path: "link/secret.txt" }, ctx())).isError).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("extra roots widen write access; spillDir is readable but not writable", async () => {
    const extra = await mkdtemp(path.join(tmpdir(), "easily-extra-"));
    try {
      const c = ctx({ extraRoots: [extra], spillDir: extra });
      expect((await writeTool.run({ path: path.join(extra, "ok.txt"), content: "x" }, c)).isError).toBeUndefined();
      const c2 = ctx({ spillDir: extra });
      expect((await readTool.run({ path: path.join(extra, "ok.txt") }, c2)).isError).toBeUndefined();
      expect((await writeTool.run({ path: path.join(extra, "no.txt"), content: "x" }, c2)).isError).toBe(true);
    } finally {
      await rm(extra, { recursive: true, force: true });
    }
  });

  it("edit requires a unique exact match", async () => {
    await writeFile(path.join(root, "f.txt"), "foo bar\nfoo baz\n");
    const dup = await editTool.run({ path: "f.txt", old_string: "foo", new_string: "x" }, ctx());
    expect(dup.isError).toBe(true);
    expect(dup.content).toMatch(/2 times/);
    expect((await editTool.run({ path: "f.txt", old_string: "nope", new_string: "x" }, ctx())).isError).toBe(true);

    const ok = await editTool.run({ path: "f.txt", old_string: "foo bar", new_string: "qux" }, ctx());
    expect(ok.isError).toBeUndefined();
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("qux\nfoo baz\n");

    await editTool.run({ path: "f.txt", old_string: "foo", new_string: "Z", replace_all: true }, ctx());
    expect(await readFile(path.join(root, "f.txt"), "utf8")).toBe("qux\nZ baz\n");
  });

  it("edit preserves CRLF files", async () => {
    await writeFile(path.join(root, "w.txt"), "a\r\nb\r\nc\r\n");
    await editTool.run({ path: "w.txt", old_string: "a\nb", new_string: "a\nB" }, ctx());
    expect(await readFile(path.join(root, "w.txt"), "utf8")).toBe("a\r\nB\r\nc\r\n");
  });
});

describe("glob / grep", () => {
  beforeEach(async () => {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "const needle = 1;\nconst other = 2;\n");
    await writeFile(path.join(root, "src", "b.md"), "# Needle\n");
    await writeFile(path.join(root, "node_modules", "x", "i.ts"), "needle");
  });

  it("glob finds files and ignores node_modules", async () => {
    const r = await globTool.run({ pattern: "**/*.ts" }, ctx());
    expect(r.content).toBe("src/a.ts");
  });

  it("grep returns path:line:text, honours glob and ignore_case", async () => {
    const r = await grepTool.run({ pattern: "needle" }, ctx());
    expect(r.content).toBe("src/a.ts:1:const needle = 1;");
    const r2 = await grepTool.run({ pattern: "needle", ignore_case: true, glob: "**/*.md" }, ctx());
    expect(r2.content).toBe("src/b.md:1:# Needle");
    expect((await grepTool.run({ pattern: "zzz" }, ctx())).content).toBe("No matches.");
    expect((await grepTool.run({ pattern: "(" }, ctx())).isError).toBe(true);
  });
});

describe("shell", () => {
  it("runs a command, captures output and exit code", async () => {
    const r = await shellTool.run({ command: "echo hello-easily" }, ctx());
    expect(r.content).toContain("hello-easily");
    expect(r.content).toContain("[exit code 0]");
    expect(r.isError).toBe(false);
  });

  it("reports non-zero exit codes as errors", async () => {
    const r = await shellTool.run({ command: process.platform === "win32" ? "exit 3" : "exit 3" }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toContain("[exit code 3]");
  });

  it("kills the process on abort", async () => {
    const ac = new AbortController();
    const p = shellTool.run({ command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30" }, ctx({ signal: ac.signal }));
    setTimeout(() => ac.abort(), 400);
    const started = Date.now();
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.content).toContain("aborted");
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("times out", async () => {
    const r = await shellTool.run({ command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30", timeout_ms: 1000 }, ctx());
    expect(r.content).toContain("timed out");
  }, 20_000);
});

describe("todo", () => {
  it("replaces the list via the context callback", async () => {
    const r = await todoTool.run({ todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] }, ctx());
    expect(todos).toHaveLength(2);
    expect(r.content).toBe("[x] a\n[~] b");
  });
});

describe("htmlToText", () => {
  it("strips scripts/tags and decodes entities", () => {
    const { title, text } = htmlToText("<html><head><title>T &amp; U</title><style>p{}</style></head><body><h1>Hi</h1><script>x()</script><p>a &lt; b</p><ul><li>one</li></ul></body></html>");
    expect(title).toBe("T & U");
    expect(text).toContain("Hi");
    expect(text).toContain("a < b");
    expect(text).toContain("- one");
    expect(text).not.toContain("x()");
  });
});
