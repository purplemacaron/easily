import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileMemoryStore } from "./index.js";

let dir: string;
let store: FileMemoryStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-mem-"));
  store = new FileMemoryStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("FileMemoryStore", () => {
  it("writes frontmatter files and a MEMORY.md index", async () => {
    await store.upsert({ name: "user-prefers-korean", description: "User wants answers in Korean", type: "user", body: "Always answer in Korean. See [[project-freeze]]." });
    const files = await store.list();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: "user-prefers-korean", type: "user", links: ["project-freeze"] });
    expect(await readFile(path.join(dir, "user-prefers-korean.md"), "utf8")).toMatch(/^---\nname: user-prefers-korean\n/);
    expect(await store.index()).toBe("- [user-prefers-korean](user-prefers-korean.md) — User wants answers in Korean\n");
  });

  it("updates and removes, keeping the index in sync", async () => {
    await store.upsert({ name: "a", description: "first", type: "project", body: "x" });
    await store.upsert({ name: "a", description: "second", type: "project", body: "y" });
    await store.upsert({ name: "b", description: "other", type: "feedback", body: "z" });
    expect((await store.list()).map((f) => f.name).sort()).toEqual(["a", "b"]);
    await store.remove("a");
    expect(await store.index()).toBe("- [b](b.md) — other\n");
  });

  it("rejects names that could escape the folder", async () => {
    await expect(store.upsert({ name: "../evil", description: "", type: "user", body: "" })).rejects.toThrow(/Invalid memory name/);
    await expect(store.remove("a/b")).rejects.toThrow();
  });

  it("recalls by BM25 relevance, including Korean text", async () => {
    await store.upsert({ name: "release-freeze", description: "Release freeze starts Thursday", type: "project", body: "No merges after Thursday for the release branch." });
    await store.upsert({ name: "coffee", description: "Coffee preference", type: "user", body: "Likes flat white." });
    await store.upsert({ name: "korean-report", description: "보고서 형식 선호", type: "feedback", body: "보고서는 표 하나와 핵심 3줄로 작성한다." });
    expect((await store.recall("when is the release freeze"))[0]?.name).toBe("release-freeze");
    expect((await store.recall("보고서 만들어줘"))[0]?.name).toBe("korean-report");
    expect(await store.recall("unrelated quantum topic")).toEqual([]);
  });
});
