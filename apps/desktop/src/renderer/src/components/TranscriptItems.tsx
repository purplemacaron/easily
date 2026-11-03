/** Renderers for each kind of transcript item. */
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtMs, fmtUsd, truncate } from "../lib/format";
import { REASON_LABEL, RISK_LABEL } from "../lib/labels";
import { toolSummary, type ChatItem } from "../lib/session-events";
import { Markdown } from "./Markdown";
import styles from "./TranscriptItems.module.css";

type Item<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

const OUTPUT_LIMIT = 6000;

export function TranscriptItem(props: { item: ChatItem; onAnswer(requestId: string, allow: boolean, always?: boolean): void }) {
  const { item } = props;
  switch (item.kind) {
    case "user":
      return <div className={styles.user}>{item.text}</div>;
    case "assistant":
      return (
        <div className={styles.assistant}>
          <Markdown text={item.text} />
        </div>
      );
    case "thinking":
      return <Thinking item={item} />;
    case "tool":
      return <ToolLine item={item} />;
    case "permission":
      return <PermissionCard item={item} onAnswer={props.onAnswer} />;
    case "turn":
      return <TurnFoot item={item} />;
    case "error":
      return (
        <p className={styles.error} role="alert">
          {item.text}
        </p>
      );
  }
}

function Thinking({ item }: { item: Item<"thinking"> }) {
  const [open, setOpen] = useState(false);
  const first = truncate(item.text, 90);
  return (
    <div className={styles.thinking}>
      <button className={styles.lineBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={13} strokeWidth={1.5} className={styles.chev} data-open={open} />
        <span>{item.live ? "생각 중" : "생각"}</span>
        {!open && <span className={styles.thinkSummary}>{first}</span>}
      </button>
      {open && <p className={styles.thinkBody}>{item.text}</p>}
    </div>
  );
}

function pretty(v: unknown): string {
  if (v === undefined) return "";
  try {
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ToolLine({ item }: { item: Item<"tool"> }) {
  const [open, setOpen] = useState(false);
  const state = item.status === "error" ? "err" : item.status === "running" ? "live" : item.status === "pending" ? "off" : undefined;
  const output = item.output ?? "";
  return (
    <div className={styles.tool}>
      <button className={styles.lineBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={13} strokeWidth={1.5} className={styles.chev} data-open={open} />
        <span className="dot" data-state={state} />
        <code className={styles.toolName}>{item.name}</code>
        <span className={styles.toolSummary}>{truncate(toolSummary(item.input), 120)}</span>
        {item.ms !== undefined && <span className={styles.ms}>{fmtMs(item.ms)}</span>}
      </button>
      {open && (
        <div className={styles.toolBody}>
          {item.input !== undefined && <pre className={styles.pre}>{pretty(item.input)}</pre>}
          {output && (
            <pre className={styles.pre} data-error={item.status === "error"}>
              {output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n… (${output.length - OUTPUT_LIMIT}자 생략)` : output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline preview of what a write/edit would change. */
function preview(input: unknown): Array<{ sign: "+" | "-"; text: string }> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const lines = (s: string, sign: "+" | "-") => s.split("\n").map((text) => ({ sign, text }));
  if (typeof o.old_string === "string" && typeof o.new_string === "string") {
    return [...lines(o.old_string, "-"), ...lines(o.new_string, "+")].slice(0, 40);
  }
  if (typeof o.content === "string") return lines(o.content, "+").slice(0, 24);
  return null;
}

function PermissionCard({ item, onAnswer }: { item: Item<"permission">; onAnswer(id: string, allow: boolean, always?: boolean): void }) {
  const allowRef = useRef<HTMLButtonElement>(null);
  const pending = item.state === "pending";
  useEffect(() => {
    if (pending) allowRef.current?.focus({ preventScroll: true });
  }, [pending]);

  if (!pending) {
    return (
      <div className={styles.permDone}>
        <span className="dot" data-state={item.state === "allowed" ? "ok" : "err"} />
        <span>{item.state === "allowed" ? "허용" : "거부"}</span>
        <code>{item.name}</code>
        <span className={styles.permDoneSummary}>{truncate(item.summary, 100)}</span>
      </div>
    );
  }
  const diff = preview(item.input);
  return (
    <div className={styles.perm} role="group" aria-label="권한 요청">
      <div className={styles.permHead}>
        <span className="badge">{RISK_LABEL[item.risk]}</span>
        <code className={styles.toolName}>{item.name}</code>
      </div>
      <pre className={styles.permSummary}>{item.summary}</pre>
      {diff && (
        <pre className={styles.diff}>
          {diff.map((l, i) => (
            <span key={i} className={l.sign === "+" ? styles.add : styles.del}>
              {l.sign} {l.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      <div className={styles.permActions}>
        <button className="btn" onClick={() => onAnswer(item.id, false)}>
          거부
        </button>
        <button className="btn" onClick={() => onAnswer(item.id, true, true)}>
          항상 허용
        </button>
        <button ref={allowRef} className="btn btn-primary" onClick={() => onAnswer(item.id, true)}>
          허용 <kbd className={styles.kbd}>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

function TurnFoot({ item }: { item: Item<"turn"> }) {
  const bad = item.reason && item.reason !== "end_turn";
  if (!bad && item.costUsd === null) return null; // unpriced model: the inspector shows "–"
  return (
    <div className={styles.foot}>
      <span className={styles.cost}>{item.costUsd === null ? "–" : fmtUsd(item.costUsd)}</span>
      {bad && (
        <span className={item.reason === "aborted" ? undefined : styles.footErr}>
          {REASON_LABEL[item.reason!]}
          {item.detail ? ` · ${item.detail}` : ""}
        </span>
      )}
    </div>
  );
}
