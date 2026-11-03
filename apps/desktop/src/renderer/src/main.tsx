import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useJobs } from "./stores/jobs";
import { useMcp } from "./stores/mcp";
import { useProviders } from "./stores/providers";
import { useSessions } from "./stores/sessions";
import { initTheme, useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./styles/tokens.css";
import "./styles/base.css";

/** easily://mcp/install?id=X → open the install sheet for catalog entry X. */
function handleDeepLink(link: string): void {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  const path = `${url.hostname}${url.pathname}`.replace(/\/+$/, "");
  const id = url.searchParams.get("id");
  const ui = useUi.getState();
  if (path === "mcp/install" && id) {
    ui.setRoute("mcp");
    ui.setMcpInstallId(id);
  }
}

function boot(): void {
  initTheme();
  window.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    useUi.getState().toast(e.reason instanceof Error ? e.reason.message : String(e.reason));
  });

  if (!window.easily) {
    useUi.getState().toast("Electron 앱 안에서만 실행할 수 있습니다.");
    return;
  }
  // Subscribe first so nothing pushed during startup is missed.
  window.easily.on("session:event", (env) => useSessions.getState().onEvent(env));
  window.easily.on("job:event", (e) => useJobs.getState().onEvent(e));
  window.easily.on("mcp:event", (e) => useMcp.getState().onEvent(e));
  window.easily.on("deeplink", handleDeepLink);

  void useSettings.getState().load();
  void useSessions.getState().refresh();
  void useProviders.getState().load();
  void useMcp.getState().load();
}

boot();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
