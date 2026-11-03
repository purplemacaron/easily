/**
 * Markdown → React elements. `marked` is used only as a lexer; the token tree is rendered
 * element by element, so no HTML string is ever injected: raw HTML in the source is shown as
 * text, links are limited to http(s), and images are never loaded.
 */
import { Check, Copy } from "lucide-react";
import { Fragment, memo, useState, type ReactNode } from "react";
import { marked } from "marked";
import { openExternal } from "../lib/ipc";
import styles from "./Markdown.module.css";

interface Tok {
  type: string;
  raw: string;
  text?: string;
  tokens?: Tok[];
  depth?: number;
  lang?: string;
  ordered?: boolean;
  start?: number | "";
  items?: Tok[];
  header?: Cell[];
  rows?: Cell[][];
  align?: Array<"left" | "right" | "center" | null>;
  href?: string;
  task?: boolean;
  checked?: boolean;
}
interface Cell {
  text: string;
  tokens: Tok[];
}

export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  return /^https?:\/\/[^\s]+$/i.test(href.trim()) ? href.trim() : null;
}

function inline(tokens: Tok[] | undefined, fallback = ""): ReactNode {
  if (!tokens || tokens.length === 0) return fallback;
  return tokens.map((t, i) => <Fragment key={i}>{inlineOne(t)}</Fragment>);
}

function inlineOne(t: Tok): ReactNode {
  switch (t.type) {
    case "text":
    case "escape":
      return t.tokens && t.tokens.length ? inline(t.tokens) : (t.text ?? "");
    case "strong":
      return <strong>{inline(t.tokens, t.text)}</strong>;
    case "em":
      return <em>{inline(t.tokens, t.text)}</em>;
    case "del":
      return <del>{inline(t.tokens, t.text)}</del>;
    case "codespan":
      return <code className={styles.inlineCode}>{t.text}</code>;
    case "br":
      return <br />;
    case "link": {
      const href = safeHref(t.href);
      const label = inline(t.tokens, t.text);
      if (!href) return label;
      return (
        <a
          href={href}
          rel="noreferrer noopener"
          onClick={(e) => {
            e.preventDefault();
            openExternal(href);
          }}
        >
          {label}
        </a>
      );
    }
    case "image":
      return t.text || "";
    default:
      // raw inline html and anything unknown: visible as plain text
      return t.raw;
  }
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.codeWrap}>
      <div className={styles.codeHead}>
        <span>{lang ?? ""}</span>
        <button
          className="icon-btn"
          aria-label="복사"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }, () => undefined);
          }}
        >
          {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
        </button>
      </div>
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function blocks(tokens: Tok[]): ReactNode {
  return tokens.map((t, i) => {
    switch (t.type) {
      case "space":
        return null;
      case "paragraph":
        return <p key={i}>{inline(t.tokens, t.text)}</p>;
      case "text":
        // block-level "text" appears inside tight list items
        return <Fragment key={i}>{inline(t.tokens, t.text)}</Fragment>;
      case "heading": {
        const H = `h${Math.min(Math.max(t.depth ?? 3, 1), 6)}` as "h1";
        return <H key={i}>{inline(t.tokens, t.text)}</H>;
      }
      case "code":
        return <CodeBlock key={i} code={t.text ?? ""} lang={t.lang || undefined} />;
      case "blockquote":
        return <blockquote key={i}>{blocks(t.tokens ?? [])}</blockquote>;
      case "hr":
        return <hr key={i} />;
      case "list": {
        const Tag = t.ordered ? "ol" : "ul";
        return (
          <Tag key={i} start={t.ordered && typeof t.start === "number" ? t.start : undefined}>
            {(t.items ?? []).map((it, j) => (
              <li key={j}>
                {it.task && <input type="checkbox" checked={!!it.checked} readOnly disabled className={styles.check} />}
                {blocks(it.tokens ?? [])}
              </li>
            ))}
          </Tag>
        );
      }
      case "table":
        return (
          <div key={i} className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  {(t.header ?? []).map((c, j) => (
                    <th key={j} style={{ textAlign: t.align?.[j] ?? undefined }}>
                      {inline(c.tokens, c.text)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(t.rows ?? []).map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td key={j} style={{ textAlign: t.align?.[j] ?? undefined }}>
                        {inline(c.tokens, c.text)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        // block html and anything unknown: visible as plain text
        return <p key={i}>{t.raw}</p>;
    }
  });
}

export function parseMarkdown(text: string): Tok[] {
  return marked.lexer(text) as unknown as Tok[];
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className={styles.md}>{blocks(parseMarkdown(text))}</div>;
});
