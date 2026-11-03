import { ArrowUp, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Effort, PermissionMode } from "../../../shared/types";
import { TranscriptItem } from "../components/TranscriptItems";
import { EFFORT_LABEL, MODE_LABEL } from "../lib/labels";
import { emptySession, pendingPermissions } from "../lib/session-events";
import { mainModelLabel, useProviders } from "../stores/providers";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { Inspector } from "./Inspector";
import styles from "./SessionView.module.css";

const MODES = Object.keys(MODE_LABEL) as PermissionMode[];
const EFFORTS = Object.keys(EFFORT_LABEL) as Effort[];

export function SessionView() {
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const setRoute = useUi((s) => s.setRoute);
  const setNewSession = useUi((s) => s.setNewSession);
  const { activeId, list, live, send, abort, answerPermission, setMode, setEffort } = useSessions();
  const providers = useProviders((s) => s.data);

  const meta = list.find((m) => m.id === activeId);
  const session = (activeId && live[activeId]) || emptySession();
  const noModel = providers !== null && providers.connections.length === 0;

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    stick.current = true;
  }, [activeId]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [session.items, activeId]);

  // Enter = 허용 for the oldest open permission card (unless the user is typing or on a control).
  const pending = pendingPermissions(session);
  useEffect(() => {
    if (!activeId || pending.length === 0) return;
    const first = pending[0]!;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "SELECT" || t.tagName === "INPUT")) return;
      if (t?.tagName === "TEXTAREA" && (t as HTMLTextAreaElement).value.trim()) return;
      e.preventDefault();
      void answerPermission(activeId, first.id, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, pending, answerPermission]);

  const isRunning = !!meta && (meta.running || session.running);
  // Esc aborts the running turn from anywhere in the session screen.
  useEffect(() => {
    if (!activeId || !isRunning) return;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === "Escape" && !ui.paletteOpen && !ui.confirmReq && !ui.newSessionOpen) void abort(activeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, isRunning, abort]);

  if (!activeId || !meta) {
    return (
      <div className="empty-center">
        <span>{noModel ? "모델을 연결하세요" : "세션을 시작하세요"}</span>
        {noModel ? (
          <button className="btn btn-primary" onClick={() => setRoute("models")}>
            모델
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setNewSession(true)}>
            새 세션
          </button>
        )}
      </div>
    );
  }

  const running = meta.running || session.running;

  return (
    <div className={styles.layout}>
      <section className={styles.thread}>
        <div
          className={styles.scroll}
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className={styles.stream}>
            {session.items.length === 0 && !noModel && <p className={styles.blank}>무엇을 할까요?</p>}
            {session.items.map((item) => (
              <TranscriptItem key={item.id} item={item} onAnswer={(rid, allow, always) => void answerPermission(activeId, rid, allow, always)} />
            ))}
            {running && session.items[session.items.length - 1]?.kind === "user" && <span className={styles.working}>…</span>}
          </div>
        </div>

        <div className={styles.composerWrap}>
          {noModel ? (
            <div className={`${styles.composer} ${styles.noModel}`}>
              <span>모델을 연결하세요</span>
              <button className="btn btn-primary" onClick={() => setRoute("models")}>
                모델
              </button>
            </div>
          ) : (
            <Composer
              key={activeId}
              running={running}
              onSend={(text) => {
                stick.current = true;
                void send(activeId, text);
              }}
              onAbort={() => void abort(activeId)}
              mode={meta.mode}
              effort={meta.effort}
              onMode={(m) => void setMode(activeId, m)}
              onEffort={(e) => void setEffort(activeId, e)}
              model={mainModelLabel(providers)}
            />
          )}
        </div>
      </section>

      {inspectorOpen && <Inspector sessionId={activeId} />}
    </div>
  );
}

function Composer(props: {
  running: boolean;
  onSend(text: string): void;
  onAbort(): void;
  mode: PermissionMode;
  effort: Effort;
  onMode(m: PermissionMode): void;
  onEffort(e: Effort): void;
  model: string | null;
}) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => area.current?.focus(), []);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || props.running) return;
    props.onSend(t);
    setText("");
  };

  return (
    <div className={styles.composer}>
      <textarea
        ref={area}
        rows={1}
        value={text}
        placeholder="메시지"
        aria-label="메시지"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.bar}>
        <select className={styles.pick} aria-label="권한 모드" value={props.mode} onChange={(e) => props.onMode(e.target.value as PermissionMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <select className={styles.pick} aria-label="노력 수준" value={props.effort} onChange={(e) => props.onEffort(e.target.value as Effort)}>
          {EFFORTS.map((m) => (
            <option key={m} value={m}>
              {EFFORT_LABEL[m]}
            </option>
          ))}
        </select>
        {props.model && <span className={styles.model}>{props.model}</span>}
        {props.running ? (
          <button className={styles.stop} aria-label="중단" title="중단 (Esc)" onClick={props.onAbort}>
            <Square size={12} strokeWidth={1.5} fill="currentColor" />
          </button>
        ) : (
          <button className={styles.send} aria-label="보내기" title="보내기 (Enter)" disabled={!text.trim()} onClick={submit}>
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
