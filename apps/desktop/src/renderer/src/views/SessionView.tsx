import { ArrowUp, AtSign, ChevronRight, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import { MOCK_TRANSCRIPT, type MockSession } from "../mock";
import styles from "./SessionView.module.css";

export function SessionView({ session }: { session: MockSession }) {
  return (
    <div className={styles.layout}>
      <section className={styles.thread}>
        <div className={styles.stream}>
          {MOCK_TRANSCRIPT.map((b, i) => {
            switch (b.kind) {
              case "user":
                return (
                  <div key={i} className={styles.user}>
                    {b.text}
                  </div>
                );
              case "assistant":
                return (
                  <p key={i} className={styles.assistant}>
                    {b.text}
                  </p>
                );
              case "tool":
                return (
                  <button key={i} className={styles.tool}>
                    <ChevronRight size={13} strokeWidth={1.5} />
                    <span className="dot" data-state={b.state} />
                    <code className={styles.toolName}>{b.name}</code>
                    <span className={styles.toolSummary}>{b.summary}</span>
                    <span className={styles.toolMs}>{b.ms}ms</span>
                  </button>
                );
              case "approval":
                return (
                  <div key={i} className={styles.approval}>
                    <div className={styles.approvalHead}>
                      <code>{b.title}</code>
                      <span className={styles.approvalActions}>
                        <button className="btn">거부</button>
                        <button className="btn">항상 허용</button>
                        <button className="btn btn-primary">
                          허용 <kbd>Enter</kbd>
                        </button>
                      </span>
                    </div>
                    <pre className={styles.diff}>{b.diff.join("\n")}</pre>
                  </div>
                );
            }
          })}
        </div>

        <div className={styles.composerWrap}>
          <div className={styles.composer}>
            <textarea rows={2} placeholder="무엇을 할까요?  /  명령  ·  @  파일" />
            <div className={styles.composerBar}>
              <button className={styles.iconBtn} aria-label="첨부">
                <Paperclip size={15} strokeWidth={1.5} />
              </button>
              <button className={styles.iconBtn} aria-label="참조">
                <AtSign size={15} strokeWidth={1.5} />
              </button>
              <span className={styles.chip}>ask</span>
              <span className={styles.chip}>claude-opus-5-5 · high</span>
              <button className={styles.send} aria-label="보내기">
                <ArrowUp size={15} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <aside className={styles.inspector} aria-label="인스펙터">
        <Section title="컨텍스트">
          <div className={styles.meter}>
            <span style={{ width: "23%" }} />
          </div>
          <Row k="사용" v="231K / 1M" />
          <Row k="캐시 적중" v="94%" />
        </Section>
        <Section title="비용">
          <Row k="이 세션" v="$0.42" />
          <Row k="오늘" v="$3.18" />
        </Section>
        <Section title="MCP">
          <Row k="filesystem" v="●" state="ok" />
          <Row k="notion" v="●" state="ok" />
          <Row k="gmail" v="●" state="err" />
        </Section>
        <Section title="체크포인트">
          <Row k="14:02  write Q3-summary.md" v="되감기" />
          <Row k="13:58  세션 시작" v="되감기" />
        </Section>
        <Section title="세션">
          <Row k="제목" v={session.title} />
          <Row k="권한" v="ask" />
        </Section>
      </aside>
    </div>
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

function Row({ k, v, state }: { k: string; v: string; state?: "ok" | "err" }) {
  return (
    <div className={styles.row}>
      <span>{k}</span>
      {state ? <span className="dot" data-state={state} /> : <span className={styles.rowValue}>{v}</span>}
    </div>
  );
}
