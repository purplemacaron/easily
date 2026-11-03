import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

/**
 * A single JSON file validated with zod on every read (CLAUDE.md: external input is parsed).
 * Invalid or missing files fall back to `fallback()`, writes are atomic (tmp + rename) and
 * serialised so concurrent saves cannot interleave.
 */
export class JsonFile<S extends z.ZodTypeAny> {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly schema: S,
    private readonly fallback: () => z.infer<S>,
  ) {}

  async load(): Promise<z.infer<S>> {
    try {
      const parsed = this.schema.safeParse(JSON.parse(await readFile(this.file, "utf8")));
      if (parsed.success) return parsed.data;
    } catch {
      /* missing or corrupt: use the fallback */
    }
    return this.fallback();
  }

  save(value: z.infer<S>): Promise<void> {
    const run = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(value, null, 2), "utf8");
      await rename(`${this.file}.tmp`, this.file);
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Read-modify-write under the same queue. */
  async update(fn: (cur: z.infer<S>) => z.infer<S>): Promise<z.infer<S>> {
    let result!: z.infer<S>;
    const run = async () => {
      result = fn(await this.load());
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(result, null, 2), "utf8");
      await rename(`${this.file}.tmp`, this.file);
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    await next;
    return result;
  }
}
