import { CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PermissionMode } from "../../../shared/types";
import { MODE_LABEL } from "../lib/labels";
import { useSessions } from "../stores/sessions";
import { useSettings } from "../stores/settings";
import { useUi, type Route } from "../stores/ui";
import { NAV } from "./Sidebar";
import styles from "./CommandPalette.module.css";

interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  hidden?: boolean;
  run(): void;
}

export function CommandPalette() {
  const ui = useUi();
  const { list, activeId, select, setMode } = useSessions();
  const setSettings = useSettings((s) => s.set);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = () => ui.setPalette(false);

  const commands = ((): Command[] => {
    const go = (r: Route) => () => ui.setRoute(r);
    const recents = list.slice(0, 50).map((s, i): Command => ({ id: `s-${s.id}`, label: s.title, group: "최근 세션", run: () => void select(s.id), hidden: i >= 5 }));
    const cmds: Command[] = [
      { id: "new", label: "새 세션", group: "세션", shortcut: "Ctrl N", run: () => ui.setNewSession(true) },
      ...recents,
      ...NAV.map((n): Command => ({ id: `go-${n.route}`, label: `${n.label} 열기`, group: "이동", run: go(n.route) })),
      { id: "inspector", label: ui.inspectorOpen ? "인스펙터 닫기" : "인스펙터 열기", group: "보기", shortcut: "Ctrl I", run: () => ui.toggleInspector() },
      { id: "theme-light", label: "라이트 테마", group: "테마", run: () => void setSettings({ theme: "light" }) },
      { id: "theme-dark", label: "다크 테마", group: "테마", run: () => void setSettings({ theme: "dark" }) },
      { id: "theme-system", label: "시스템 테마", group: "테마", run: () => void setSettings({ theme: "system" }) },
    ];
    if (activeId) {
      for (const m of Object.keys(MODE_LABEL) as PermissionMode[]) {
        cmds.push({ id: `mode-${m}`, label: `권한 모드: ${MODE_LABEL[m]}`, group: "권한", run: () => void setMode(activeId, m) });
      }
    }
    return cmds;
  })();

  // Without a query older sessions stay out of the way; searching reaches all of them.
  const results = (() => {
    const s = q.trim().toLowerCase();
    return s ? commands.filter((c) => `${c.label} ${c.group}`.toLowerCase().includes(s)) : commands.filter((c) => !c.hidden);
  })();

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-label="명령 팔레트"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) run(results[sel]);
        }}
      >
        <input ref={input} className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="명령 또는 세션 검색" />
        <ul className={styles.list} ref={listRef}>
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
