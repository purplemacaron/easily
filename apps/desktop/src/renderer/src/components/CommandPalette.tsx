import { CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "../App";
import styles from "./CommandPalette.module.css";

interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  route?: Route;
}

// TODO(P1): build from a command registry (every feature registers its commands, U-001).
const COMMANDS: Command[] = [
  { id: "new", label: "새 세션", group: "세션", shortcut: "Ctrl N", route: "session" },
  { id: "models", label: "모델 연결 추가", group: "설정", route: "models" },
  { id: "mcp", label: "MCP 스토어 열기", group: "MCP", route: "mcp" },
  { id: "jobs", label: "예약 작업 만들기", group: "자동화", route: "jobs" },
  { id: "wf", label: "워크플로 열기", group: "자동화", route: "workflows" },
  { id: "improve", label: "개선안 검토", group: "자기개선", route: "improve" },
  { id: "memory", label: "메모리 보기", group: "컨텍스트", route: "memory" },
  { id: "skills", label: "스킬 관리", group: "하네스", route: "skills" },
  { id: "plan", label: "플랜 모드로 전환", group: "권한", shortcut: "Shift Tab" },
  { id: "compact", label: "컨텍스트 압축 /compact", group: "컨텍스트" },
  { id: "rewind", label: "마지막 체크포인트로 되감기", group: "체크포인트", shortcut: "Esc Esc" },
  { id: "theme", label: "다크 테마 전환", group: "설정" },
];

export function CommandPalette({ onClose, onNavigate }: { onClose(): void; onNavigate(r: Route): void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? COMMANDS.filter((c) => (c.label + c.group).toLowerCase().includes(s)) : COMMANDS;
  }, [q]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    if (c.id === "theme") {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      onClose();
    } else if (c.route) onNavigate(c.route);
    else onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") setSel((i) => Math.min(i + 1, results.length - 1));
          if (e.key === "ArrowUp") setSel((i) => Math.max(i - 1, 0));
          if (e.key === "Enter") run(results[sel]);
        }}
      >
        <input ref={input} className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="명령, 세션, 설정 검색" />
        <ul className={styles.list}>
          {results.map((c, i) => (
            <li key={c.id} data-active={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span className={styles.label}>{c.label}</span>
              <span className={styles.group}>{c.group}</span>
              {c.shortcut ? <kbd>{c.shortcut}</kbd> : i === sel && <CornerDownLeft size={13} strokeWidth={1.5} />}
            </li>
          ))}
          {results.length === 0 && <li className={styles.none}>결과 없음</li>}
        </ul>
      </div>
    </div>
  );
}
