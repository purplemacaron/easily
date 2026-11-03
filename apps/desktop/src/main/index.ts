import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, powerMonitor, shell } from "electron";
import { join } from "node:path";
import { IPC, type IpcChannel } from "../shared/ipc";

/**
 * Main process responsibilities:
 *  - single instance + easily:// deep links (MCP one-click install, OAuth callback)
 *  - tray residency: closing the window hides it; the scheduler keeps running (S-001)
 *  - login item (S-002), powerMonitor resume → scheduler.catchUp (S-005)
 *  - IPC router: validate with zod, then call into @easily/core
 */

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient("easily");

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

  win.once("ready-to-show", () => win?.show());
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

function createTray(): void {
  // TODO(P4): monochrome template icon in build/tray.png (16/32px), status dot when a job runs.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Easily");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Easily 열기", click: () => win?.show() },
      { label: "퀵 런처", accelerator: "Alt+Space", click: () => win?.show() },
      { type: "separator" },
      { label: "종료", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  tray.on("click", () => win?.show());
}

function handleDeepLink(url: string): void {
  // easily://mcp/install?id=github  |  easily://oauth/callback?code=...
  win?.show();
  win?.webContents.send("deeplink", url);
}

function registerIpc(): void {
  for (const channel of Object.keys(IPC) as IpcChannel[]) {
    ipcMain.handle(channel, async (_e, raw) => {
      const payload = IPC[channel].parse(raw);
      // TODO(P1): route to core services (sessions, providers, mcp, jobs).
      if (channel === "app:openExternal") return shell.openExternal((payload as { url: string }).url);
      return { ok: false, error: `${channel} not implemented` };
    });
  }
}

app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith("easily://"));
  if (link) handleDeepLink(link);
  else win?.show();
});
app.on("open-url", (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});

void app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); // TODO: user setting
  registerIpc();
  createWindow();
  createTray();
  powerMonitor.on("resume", () => {
    // TODO(P4): scheduler.catchUp(jobs)
  });
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Stay alive in the tray on every platform.
});
