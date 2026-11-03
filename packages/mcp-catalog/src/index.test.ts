import { describe, expect, it } from "vitest";
import { catalog, getCatalogEntry, requiredRuntime, resolveInstall, splitList } from "./index.js";

describe("catalog", () => {
  it("parses and every entry is unverified until installed on a clean machine (CLAUDE.md)", () => {
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((e) => e.verified === false)).toBe(true);
  });
});

describe("resolveInstall", () => {
  it("npx entries get -y and expand folder lists into separate args", () => {
    const fs = getCatalogEntry("filesystem")!;
    const r = resolveInstall(fs, { folders: "C:\\Users\\me\\Docs\nD:\\Work" });
    expect(r).toMatchObject({
      ok: true,
      spec: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\me\\Docs", "D:\\Work"] },
    });
  });

  it("substitutes single-value inputs and uvx has no -y", () => {
    const git = getCatalogEntry("git")!;
    const r = resolveInstall(git, { repo: "C:\\repo" });
    expect(r).toMatchObject({ ok: true, spec: { command: "uvx", args: ["mcp-server-git", "--repository", "C:\\repo"] } });
  });

  it("requires required inputs", () => {
    const r = resolveInstall(getCatalogEntry("filesystem")!, {});
    expect(r.ok).toBe(false);
  });

  it("reports OAuth remotes as unsupported in v0.1 and allows plain remotes", () => {
    const gh = getCatalogEntry("github")!;
    expect(resolveInstall(gh, {})).toMatchObject({ ok: false });
    const plain = resolveInstall({ ...gh, install: { type: "remote", url: "https://example.com/mcp", auth: "none" } }, {});
    expect(plain).toMatchObject({ ok: true, spec: { type: "http", url: "https://example.com/mcp" } });
  });

  it("maps entries to the runtime they need", () => {
    expect(requiredRuntime(getCatalogEntry("filesystem")!)).toEqual({ runtime: "node", command: "npx" });
    expect(requiredRuntime(getCatalogEntry("fetch")!)).toEqual({ runtime: "uv", command: "uvx" });
    expect(requiredRuntime(getCatalogEntry("github")!)).toBeNull();
  });

  it("splitList handles newlines and semicolons but not drive-letter colons", () => {
    expect(splitList("C:\\a;D:\\b\n E:\\c ")).toEqual(["C:\\a", "D:\\b", "E:\\c"]);
  });
});
