import { CalendarClock, Cpu, FileText, MessageSquare, Pencil, Plug, Plus, Settings, Trash2, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { fmtRelative } from "../lib/format";
import { useSessions } from "../stores/sessions";
import { useUi, type Route } from "../stores/ui";
import styles from "./Sidebar.module.css";

export const NAV: Array<{ route: Route; label: string; icon: LucideIcon }> = [
  { route: "session", label: "세션", icon: MessageSquare },
  { route: "jobs", label: "예약 작업", icon: CalendarClock },
  { route: "mcp", label: "MCP", icon: Plug },
  { route: "memory", label: "메모리", icon: FileText },
  { route: "models", label: "모델", icon: Cpu },
  { route: "settings", label: "설정", icon: Settings },
];

export function Sidebar() {
  const route = useUi((s) => s.route);
  const setRoute = useUi((s) => s.setRoute);
  const setNewSession = useUi((s) => s.setNewSession);
  const confirm = useUi((s) => s.confirm);
  const { list, activeId, live, select, rename, remove } = useSessions();
  const [editing, setEditing] = useState<string | null>(null);
  const draft = useRef("");

  const commitRename = (id: string, original: string) => {
    const title = draft.current.trim();
    setEditing(null);
    if (title && title !== original) void rename(id, title);
  };

  return (
    <nav className={styles.sidebar} aria-label="탐색">
      <div className={styles.logo}>Easily</div>

      <div className={styles.top}>
        <button className={`btn ${styles.newBtn}`} onClick={() => setNewSession(true)}>
          <Plus size={14} strokeWidth={1.5} />
          <span>새 세션</span>
          <kbd>Ctrl N</kbd>
        </button>
      </div>

      <div className={styles.nav}>
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <button key={r} className={styles.navItem} data-active={route === r} onClick={() => setRoute(r)}>
            <Icon size={15} strokeWidth={1.5} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className={styles.sessions}>
        {list.map((s) => {
          const running = s.running || !!live[s.id]?.running;
          const isEditing = editing === s.id;
          return (
            <div key={s.id} className={styles.sessionItem} data-active={route === "session" && activeId === s.id}>
              {isEditing ? (
                <input
                  className={`input ${styles.rename}`}
                  autoFocus
                  defaultValue={s.title}
                  onChange={(e) => (draft.current = e.target.value)}
                  onFocus={(e) => {
                    draft.current = e.target.value;
                    e.target.select();
                  }}
                  onBlur={() => commitRename(s.id, s.title)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename(s.id, s.title);
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <>
                  <button className={styles.sessionMain} onClick={() => void select(s.id)} onDoubleClick={() => setEditing(s.id)} title={s.title}>
                    <span className="dot" data-state={running ? "live" : undefined} />
                    <span className="truncate">{s.title}</span>
                    <span className={styles.when}>{fmtRelative(s.updatedAt)}</span>
                  </button>
                  <span className={styles.actions}>
                    <button className="icon-btn" aria-label="이름 변경" onClick={() => setEditing(s.id)}>
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="삭제"
                      onClick={async () => {
                        if (await confirm({ title: "세션 삭제", body: s.title, confirmLabel: "삭제", danger: true })) void remove(s.id);
                      }}
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
