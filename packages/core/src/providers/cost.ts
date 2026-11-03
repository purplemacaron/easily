/**
 * Cost table (M-019). The ONLY place prices live. USD per million tokens.
 *
 * Only the three Anthropic defaults are priced; every other model returns `null` ("unknown")
 * and the UI shows "–" instead of a guess. Source: Anthropic model pricing table (2026-10).
 *  - cacheRead for opus/sonnet is the published rate; the other cache rates are derived
 *    (read 0.1x, write 1.25x of the input price) because only input/output are published.
 *  - claude-haiku-5-5 is priced at its ≤100K-token-prompt rate; longer prompts cost more
 *    ($0.50 / $2.50) and are under-reported here.
 */
export interface Pricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICING: Readonly<Record<string, Pricing>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** USD for one response, or null when the model has no known price. */
export function computeCostUsd(model: string, usage: UsageLike): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}
