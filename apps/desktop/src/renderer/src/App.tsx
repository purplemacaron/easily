import { PanelRight } from "lucide-react";
import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { NewSessionSheet } from "./components/NewSessionSheet";
import { Sidebar } from "./components/Sidebar";
import { ConfirmDialog, Toaster } from "./components/ui";
import { fmtTotalsCost, baseName } from "./lib/format";
import { useSessions } from "./stores/sessions";
import { useUi } from "./stores/ui";
import { JobsView } from "./views/JobsView";
import { McpView } from "./views/McpView";
import { MemoryView } from "./views/MemoryView";
import { ModelsView } from "./views/ModelsView";
import { SessionView } from "./views/SessionView";
import { SettingsView } from "./views/SettingsView";
import styles from "./App.module.css";

export function App() {
  const ui = useUi();
  const { list, activeId, live } = useSessions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      const s = useUi.getState();
      if (k === "k") s.setPalette(!s.paletteOpen);
      else if (k === "i") s.toggleInspector();
      else if (k === "n") s.setNewSession(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meta = list.find((m) => m.id === activeId);
  const session = activeId ? live[activeId] : undefined;
  const running = !!meta && (meta.running || !!session?.running);
  const onSession = ui.route === "session" && !!meta;

  return (
    <div className={styles.shell}>
      <Sidebar />

      <div className={styles.right}>
        <header className={styles.topbar}>
          {onSession && (
            <>
              <span className={styles.title}>{meta.title}</span>
              <span className={styles.cwd} title={meta.cwd}>
                {baseName(meta.cwd)}
              </span>
            </>
          )}
          <span className={styles.status}>
            {onSession && running && (
              <span className={styles.live}>
                <span className="dot" data-state="live" />
                실행 중
              </span>
            )}
            {onSession && (session?.totals ?? meta.totals).costUsd > 0 && <span className={styles.cost}>{fmtTotalsCost(session?.totals ?? meta.totals)}</span>}
            {ui.route === "session" && (
              <button className="icon-btn" aria-label="인스펙터" aria-pressed={ui.inspectorOpen} title="인스펙터 (Ctrl I)" data-on={ui.inspectorOpen} onClick={ui.toggleInspector}>
                <PanelRight size={16} strokeWidth={1.5} />
              </button>
            )}
          </span>
        </header>

        <main className={styles.main}>
          {ui.route === "session" && <SessionView />}
          {ui.route === "jobs" && <JobsView />}
          {ui.route === "mcp" && <McpView />}
          {ui.route === "memory" && <MemoryView />}
          {ui.route === "models" && <ModelsView />}
          {ui.route === "settings" && <SettingsView />}
        </main>
      </div>

      {ui.paletteOpen && <CommandPalette />}
      {ui.newSessionOpen && <NewSessionSheet />}
      <ConfirmDialog />
      <Toaster />
    </div>
  );
}
