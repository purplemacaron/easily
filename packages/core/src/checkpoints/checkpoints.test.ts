import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "./index.js";

let dir: string;
let ws: string;
let cp: CheckpointStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "easily-cp-"));
  ws = await mkdtemp(path.join(tmpdir(), "easily-ws-"));
  cp = new CheckpointStore(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(ws, { recursive: true, force: true });
});

describe("CheckpointStore", () => {
  it("restores modified files and removes files created after the checkpoint", async () => {
    const a = path.join(ws, "a.txt");
    const b = path.join(ws, "b.txt");
    await writeFile(a, "original");

    await cp.snapshot("s", "t1", [a]);
    await writeFile(a, "changed in t1");
    await cp.snapshot("s", "t1", [a]); // second snapshot in the same turn keeps the first backup
    await cp.snapshot("s", "t2", [a, b]);
    await writeFile(a, "changed in t2");
    await writeFile(b, "new file");

    expect((await cp.list("s")).map((c) => c.turnId)).toEqual(["t1", "t2"]);

    // Rewinding to t2 undoes only t2.
    const r2 = await cp.rewind("s", "t2");
    expect(r2.removed).toEqual([b]);
    expect(await readFile(a, "utf8")).toBe("changed in t1");
    expect(existsSync(b)).toBe(false);

    // Rewinding to t1 restores the original.
    await cp.rewind("s", "t1");
    expect(await readFile(a, "utf8")).toBe("original");
    expect(await cp.list("s")).toEqual([]);
  });

  it("rewinding to an earlier turn also undoes later turns", async () => {
    const a = path.join(ws, "a.txt");
    await writeFile(a, "v0");
    await cp.snapshot("s", "t1", [a]);
    await writeFile(a, "v1");
    await cp.snapshot("s", "t2", [a]);
    await writeFile(a, "v2");
    await cp.rewind("s", "t1");
    expect(await readFile(a, "utf8")).toBe("v0");
  });

  it("errors for unknown turns", async () => {
    await expect(cp.rewind("s", "nope")).rejects.toThrow(/No checkpoint/);
  });
});
