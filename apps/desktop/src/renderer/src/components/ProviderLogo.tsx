import openaiCompatible from "../assets/providers/openai-compatible.svg?raw";
import anthropicCompatible from "../assets/providers/anthropic-compatible.svg?raw";
import styles from "./ProviderLogo.module.css";

/**
 * Provider logo by preset `logo` slug (packages/core/src/providers/presets.ts).
 *
 * - "easily:*" slugs → Easily's own glyphs (custom compatible endpoints)
 * - everything else → @lobehub/icons
 *
 * TODO(P1): after `pnpm add @lobehub/icons`, replace the fallback below with
 *   import { ProviderIcon } from "@lobehub/icons";
 *   <ProviderIcon provider={slug} size={size} type="mono" />
 * Brand logos are trademarks: show them only to identify the provider, never recolor or distort.
 */
const OWN_GLYPHS: Record<string, string> = {
  "easily:openai-compatible": openaiCompatible,
  "easily:anthropic-compatible": anthropicCompatible,
};

export function ProviderLogo({ slug, name, size = 20 }: { slug: string; name: string; size?: number }) {
  const own = OWN_GLYPHS[slug];
  if (own) {
    return (
      <span
        className={styles.logo}
        style={{ width: size, height: size }}
        role="img"
        aria-label={name}
        dangerouslySetInnerHTML={{ __html: own }}
      />
    );
  }
  // Fallback until @lobehub/icons is installed: the static SVG from jsDelivr.
  return (
    <img
      className={styles.logo}
      src={`https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/${slug}.svg`}
      width={size}
      height={size}
      alt={name}
      loading="lazy"
    />
  );
}
