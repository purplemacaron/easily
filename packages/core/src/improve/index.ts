/**
 * Self-improvement engine (PLAN Phase 5, I-001..I-015).
 *
 *            ┌──────────┐   every turn    ┌──────────┐  fast model   ┌───────────┐
 *   run ───► │  Trace   │ ──────────────► │ Reflect  │ ────────────► │ Candidates│
 *            └──────────┘                 └──────────┘               └─────┬─────┘
 *                 ▲                                                        │
 *                 │ golden tasks extracted from real sessions              ▼
 *            ┌──────────┐   judge model   ┌──────────┐  user / auto  ┌───────────┐
 *            │ EvalSet  │ ◄────────────── │  Gate    │ ────────────► │  Adopted  │
 *            └──────────┘   baseline vs   └──────────┘   (versioned, │ (rollback)│
 *                           candidate                    1-click undo)└───────────┘
 *
 * Candidate kinds, from cheapest/safest to most impactful:
 *   memory   — a lesson ("this repo uses pnpm, not npm"), promoted only after it recurs
 *   skill    — a procedure that succeeded N times, drafted as SKILL.md
 *   prompt   — a patch to the system prompt, a skill, or a tool description
 *   routing  — "use the fast model for X" / effort changes, justified by cost data
 *
 * Hard rules:
 *   - Nothing is adopted without an eval run that beats the baseline, except `memory`
 *     candidates, which need only recurrence + user-visible listing.
 *   - Auto-adopt is off by default (I-012). Every adoption is a new version (I-011).
 *   - Reflection never sees secrets: traces are masked before leaving the store.
 */

export interface TraceRecord {
  sessionId: string;
  turnId: string;
  startedAt: number;
  model: string;
  toolCalls: Array<{ name: string; ok: boolean; ms: number; bytesIn: number; bytesOut: number }>;
  costUsd: number;
  /** Signals of (dis)satisfaction collected by the UI (I-002). */
  signals: Array<"thumbs_up" | "thumbs_down" | "rewind" | "retry" | "user_edit_after" | "interrupted">;
  outcome: "end_turn" | "refusal" | "max_tokens" | "aborted" | "error";
}

export type CandidateKind = "memory" | "skill" | "prompt" | "routing";

export interface ImprovementCandidate {
  id: string;
  kind: CandidateKind;
  title: string;
  rationale: string;
  /** Unified diff against the current version of the target file. */
  diff: string;
  target: string;
  evidence: string[]; // trace / turn ids
  eval?: { baseline: number; candidate: number; cases: number; costUsd: number };
  status: "proposed" | "evaluating" | "ready" | "adopted" | "rejected" | "rolled_back";
}

export interface ImproveEngine {
  record(trace: TraceRecord): Promise<void>;
  /** Called after each turn; cheap and async — must never block the UI. */
  reflect(turnId: string): Promise<ImprovementCandidate[]>;
  evaluate(candidateId: string): Promise<ImprovementCandidate>;
  adopt(candidateId: string): Promise<void>;
  rollback(candidateId: string): Promise<void>;
  weeklyReport(): Promise<string>;
}

// TODO(P5): implement ImproveEngine backed by the SQLite store + a `fast` model for reflection
// and a `judge` model for evals. Start with memory candidates; ship skills/prompts after evals work.
