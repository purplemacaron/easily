import {
  Bot,
  CalendarClock,
  Cpu,
  Inbox,
  Library,
  Plug,
  Search,
  Settings,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./App.module.css";
import { CommandPalette } from "./components/CommandPalette";
import { MOCK_SESSIONS } from "./mock";
import { ModelsView } from "./views/ModelsView";
import { SessionView } from "./views/SessionView";

export type Route = "session" | "jobs" | "workflows" | "mcp" | "skills" | "memory" | "improve" | "inbox" | "models" | "settings";

const NAV: Array<{ route: Route; label: string; icon: LucideIcon; badge?: string }> = [
  { route: "inbox", label: "받은편지함", icon: Inbox, badge: "3" },
  { route: "jobs", label: "예약 작업", icon: CalendarClock },
  { route: "workflows", label: "워크플로", icon: Workflow },
  { route: "mcp", label: "MCP", icon: Plug },
  { route: "skills", label: "스킬", icon: Library },
  { route: "memory", label: "메모리", icon: Bot },
  { route: "improve", label: "개선안", icon: Sparkles, badge: "2" },
  { route: "models", label: "모델", icon: Cpu },
];

export function App() {
  const [route, setRoute] = useState<Route>("session");
  const [activeSession, setActiveSession] = useState(MOCK_SESSIONS[0]!.id);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const session = MOCK_SESSIONS.find((s) => s.id === activeSession)!;

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <span className={styles.brand}>Easily</span>
        <span className={styles.titleSep}>/</span>
        <span className={styles.title}>{route === "session" ? session.title : NAV.find((n) => n.route === route)?.label}</span>
        <span className={styles.titleRight}>
          <span className="dot" data-state="live" /> 실행 중 · <span className={styles.mono}>$0.42</span>
        </span>
      </header>

      <nav className={styles.sidebar}>
        <button className={styles.search} onClick={() => setPaletteOpen(true)}>
          <Search size={14} strokeWidth={1.5} />
          <span>검색 및 명령</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className={styles.navGroup}>
          {NAV.map(({ route: r, label, icon: Icon, badge }) => (
            <button key={r} className={styles.navItem} data-active={route === r} onClick={() => setRoute(r)}>
              <Icon size={15} strokeWidth={1.5} />
              <span>{label}</span>
              {badge && <span className={styles.badge}>{badge}</span>}
            </button>
          ))}
        </div>

        <div className={styles.sectionLabel}>세션</div>
        <div className={styles.sessions}>
          {MOCK_SESSIONS.map((s) => (
            <button
              key={s.id}
              className={styles.sessionItem}
              data-active={route === "session" && activeSession === s.id}
              onClick={() => {
                setActiveSession(s.id);
                setRoute("session");
              }}
            >
              <span className="dot" data-state={s.state} />
              <span className={styles.sessionTitle}>{s.title}</span>
              <span className={styles.sessionMeta}>{s.when}</span>
            </button>
          ))}
        </div>

        <button className={styles.navItem} data-active={route === "settings"} onClick={() => setRoute("settings")}>
          <Settings size={15} strokeWidth={1.5} />
          <span>설정</span>
        </button>
      </nav>

      <main className={styles.main}>
        {route === "session" && <SessionView session={session} />}
        {route === "models" && <ModelsView />}
        {route !== "session" && route !== "models" && (
          <div className={styles.empty}>
            <p>이 화면은 아직 비어 있습니다.</p>
            <p className={styles.emptyHint}>
              docs/PLAN.md 의 해당 Phase 에서 구현 · <kbd>Ctrl K</kbd> 로 다른 화면 이동
            </p>
          </div>
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(r) => {
            setRoute(r);
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}
