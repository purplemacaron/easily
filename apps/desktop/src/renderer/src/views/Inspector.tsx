import { RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { CheckpointDTO, McpStatusDTO } from "../../../shared/types";
import { call } from "../lib/ipc";
import { fmtDateTime, fmtTokens, fmtTotalsCost } from "../lib/format";
import { emptySession } from "../lib/session-events";
import { useMcp } from "../stores/mcp";
import { useProviders } from "../stores/providers";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import styles from "./Inspector.module.css";

const MCP_DOT: Record<McpStatusDTO["state"], string | undefined> = {
  connected: "ok",
  connecting: "live",
  error: "err",
  disabled: "off",
};

export function Inspector({ sessionId }: { sessionId: string }) {
  const live = useSessions((s) => s.live[sessionId]) ?? emptySession();
  const rewind = useSessions((s) => s.rewind);
  const confirm = useUi((s) => s.confirm);
  const servers = useMcp((s) => s.servers);
  const providers = useProviders((s) => s.data);
  const [checkpoints, setCheckpoints] = useState<CheckpointDTO[]>([]);

  // Checkpoints change when a turn ends (or after a rewind).
  const turnCount = live.items.filter((i) => i.kind === "turn").length;
  useEffect(() => {
    let cancelled = false;
    void call("session:checkpoints", { sessionId }).then((r) => {
      if (!cancelled && r.ok) setCheckpoints(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, turnCount]);

  const main = providers?.roles.main;
  const mainConn = main ? providers?.connections.find((c) => c.id === main.connectionId) : undefined;
  const windowSize = live.contextWindow ?? mainConn?.models.find((m) => m.id === main?.model)?.contextWindow;
  const pct = windowSize ? Math.min(100, (live.contextTokens / windowSize) * 100) : 0;
  const t = live.totals;

  const doRewind = async (c: CheckpointDTO) => {
    const ok = await confirm({
      title: "되감기",
      body: `이 시점 이후의 대화와 파일 변경을 되돌립니다.\n${c.files.length ? c.files.join("\n") : "변경된 파일 없음"}`,
      confirmLabel: "되감기",
      danger: true,
    });
    if (ok) await rewind(sessionId, c.turnId);
  };

  return (
    <aside className={styles.inspector} aria-label="인스펙터">
      <Section title="컨텍스트">
        {windowSize && (
          <div className={styles.meter} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <Row k="사용" v={windowSize ? `${fmtTokens(live.contextTokens)} / ${fmtTokens(windowSize)}` : fmtTokens(live.contextTokens)} />
      </Section>

      <Section title="비용">
        <Row k="세션" v={fmtTotalsCost(t)} />
        <Row k="입력" v={fmtTokens(t.inputTokens)} />
        <Row k="출력" v={fmtTokens(t.outputTokens)} />
        <Row k="캐시 읽기" v={fmtTokens(t.cacheReadTokens)} />
      </Section>

      {live.todos.length > 0 && (
        <Section title="할 일">
          {live.todos.map((td, i) => (
            <div key={i} className={styles.todo} data-status={td.status}>
              <span className="dot" data-state={td.status === "in_progress" ? "live" : td.status === "completed" ? "ok" : "off"} />
              <span>{td.content}</span>
            </div>
          ))}
        </Section>
      )}

      {servers.length > 0 && (
        <Section title="MCP">
          {servers.map((s) => (
            <div key={s.id} className={styles.row}>
              <span className="dot" data-state={MCP_DOT[s.status.state]} />
              <span className="truncate">{s.name}</span>
              <span className={styles.value}>{s.status.state === "connected" ? s.status.toolCount : ""}</span>
            </div>
          ))}
        </Section>
      )}

      {checkpoints.length > 0 && (
        <Section title="체크포인트">
          {checkpoints
            .slice()
            .reverse()
            .map((c) => (
              <div key={c.turnId} className={styles.row}>
                <span className={styles.value}>{fmtDateTime(c.ts)}</span>
                <span className="truncate">{c.files.length ? `파일 ${c.files.length}개` : "변경 없음"}</span>
                <button className={`btn btn-quiet ${styles.rewind}`} onClick={() => void doRewind(c)}>
                  <RotateCcw size={12} strokeWidth={1.5} />
                  되감기
                </button>
              </div>
            ))}
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.key}>{k}</span>
      <span className={styles.value}>{v}</span>
    </div>
  );
}
