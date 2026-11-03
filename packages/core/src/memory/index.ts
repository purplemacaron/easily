/**
 * Memory (X-005..X-009). One fact per markdown file with frontmatter, plus a MEMORY.md index
 * that is always in context. Relevant files are recalled per turn and injected after the
 * last cache breakpoint so the cached prefix is untouched.
 *
 *   memory/
 *   ├─ MEMORY.md                       - [Title](file.md) — one-line hook
 *   ├─ user-prefers-korean.md
 *   └─ project-release-freeze.md
 */
export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFile {
  name: string; // kebab-case slug, also the file name
  description: string; // used for relevance ranking
  type: MemoryType;
  body: string;
  /** [[other-name]] links found in the body. */
  links: string[];
  updatedAt: number;
}

export interface MemoryStore {
  index(): Promise<string>;
  list(): Promise<MemoryFile[]>;
  recall(query: string, limit?: number): Promise<MemoryFile[]>;
  upsert(file: Omit<MemoryFile, "links" | "updatedAt">): Promise<void>;
  remove(name: string): Promise<void>;
}

// TODO(P2): FileMemoryStore (fs + gray-matter), recall via BM25 first, embeddings in P6.
