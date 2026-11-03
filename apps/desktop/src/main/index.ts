import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  shell,
} from "electron";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { redactSecrets } from "@easily/core";
import { ZodError } from "zod";
import { INVOKE_CHANNELS } from "../shared/channels";
import { IPC, type IpcChannel, type PushChannel, type PushPayloads } from "../shared/ipc";
import type { IpcResult } from "../shared/types";
import { createHandlers } from "./handlers";
import { createServices, type Services } from "./services";
import { trayIconPng } from "./tray-icon";
import { SafeStorageVault } from "./vault";

/**
 * Main process responsibilities:
 *  - single instance + easily:// deep links (MCP one-click install, OAuth callback)
 *  - tray residency: closing the window hides it; the scheduler keeps running (S-001)
 *  - login item is a user setting, default off (S-002); powerMonitor resume → catch-up (S-005)
 *  - IPC router: validate with zod, then call into @easily/core (see handlers.ts)
 */

// EASILY_USER_DATA lets tests / smoke runs use a throwaway profile. Must happen before anything reads userData.
app.setPath("userData", process.env.EASILY_USER_DATA ?? join(app.getPath("appData"), "Easily"));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let services: Services | null = null;
let quitting = false;
let pendingLink: string | undefined = process.argv.find((a) => a.startsWith("easily://"));
let sleepBlocker: number | undefined;
const startHidden = process.argv.includes("--hidden");

if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient("easily");

function send<C extends PushChannel>(channel: C, payload: PushPayloads[C]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

function hasCommand(command: string): boolean {
  return spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" }).status === 0;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: "#FFFFFF",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#FFFFFF", symbolColor: "#111111", height: 40 },
    webPreferences: {
      // Sandboxed preloads must be CommonJS — keep this package without "type": "module".
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!startHidden) win?.show();
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The renderer never navigates away from the app itself.
  win.webContents.on("will-navigate", (e, url) => {
    const home = process.env.ELECTRON_RENDERER_URL;
    if (!(home && url.startsWith(home)) && !url.startsWith("file://")) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

function refreshTray(): void {
  if (!tray || !services) return;
  const active = services.activeCount();
  const icon = nativeImage.createFromBuffer(trayIconPng(active > 0));
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray.setImage(icon);
  tray.setToolTip(active > 0 ? `Easily · ${active}개 실행 중` : "Easily");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Easily 열기", click: () => showWindow() },
      { label: active > 0 ? `실행 중 ${active}개` : "실행 중인 작업 없음", enabled: false },
      { type: "separator" },
      { label: "종료", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  // S-016: keep the machine awake while something is running.
  if (active > 0 && sleepBlocker === undefined) sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
  if (active === 0 && sleepBlocker !== undefined) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = undefined;
  }
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromBuffer(trayIconPng(false)));
  tray.on("click", () => showWindow());
  refreshTray();
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function handleDeepLink(url: string): void {
  // easily://mcp/install?id=github  |  easily://oauth/callback?code=...
  if (!win || !services) {
    pendingLink = url;
    return;
  }
  showWindow();
  send("deeplink", url);
}

function failure(e: unknown): string {
  if (e instanceof ZodError) return `잘못된 요청입니다: ${e.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`;
  return redactSecrets(e instanceof Error ? e.message : String(e));
}

function registerIpc(svc: Services): void {
  const handlers = createHandlers(svc, {
    openExternal: (url) => shell.openExternal(url),
    pickFolder: async () => {
      const r = win ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] }) : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    setLoginItem: (open) => app.setLoginItemSettings({ openAtLogin: open, args: open ? ["--hidden"] : [] }),
    appInfo: () => ({ version: app.getVersion(), platform: process.platform, secretsAvailable: vault.available() }),
  });

  for (const channel of INVOKE_CHANNELS as readonly IpcChannel[]) {
    ipcMain.handle(channel, async (e, raw): Promise<IpcResult<unknown>> => {
      if (!win || e.sender !== win.webContents) return { ok: false, error: "허용되지 않은 호출입니다." };
      try {
        const payload = IPC[channel].parse(raw ?? {});
        const data = await (handlers[channel] as (p: unknown) => Promise<unknown>)(payload);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: failure(err) };
      }
    });
  }
}

let vault: SafeStorageVault;

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith("easily://"));
  if (link) handleDeepLink(link);
  else showWindow();
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});

void app.whenReady().then(async () => {
  const dataDir = app.getPath("userData");
  vault = new SafeStorageVault(join(dataDir, "secrets.bin"));

  services = await createServices({
    dataDir,
    vault,
    send,
    hasCommand,
    notify: (run, job) => {
      if (!Notification.isSupported()) return;
      const ok = run.status === "ok";
      const n = new Notification({
        title: ok ? `${job.name} 완료` : `${job.name} 실패`,
        body: ok ? (run.summary ?? "").replace(/\s+/g, " ").slice(0, 120) || "작업이 끝났습니다." : (run.detail ?? run.status),
      });
      n.on("click", () => showWindow());
      n.show();
    },
  });
  registerIpc(services);
  createWindow();
  createTray();
  services.onActivity(refreshTray);

  win?.webContents.once("did-finish-load", () => {
    if (pendingLink) {
      send("deeplink", pendingLink);
      pendingLink = undefined;
    }
  });

  powerMonitor.on("resume", () => void services?.onResume().catch((e) => console.error("resume catch-up failed:", failure(e))));
  await services.start().catch((e) => console.error("startup failed:", failure(e)));
});

app.on("before-quit", () => {
  quitting = true;
  void services?.shutdown();
});
app.on("window-all-closed", () => {
  // Stay alive in the tray on every platform.
});
