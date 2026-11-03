import { create } from "zustand";
import type { IpcPayload } from "../../../shared/ipc";
import type { AppInfoDTO, SettingsDTO } from "../../../shared/types";
import { call } from "../lib/ipc";

type Patch = IpcPayload<"settings:set">;

/** Resolve "system" to a concrete theme and put it on <html data-theme>. */
export function applyTheme(theme: SettingsDTO["theme"]): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable: the theme just loads a moment later next time
  }
}

const THEME_KEY = "easily.theme";

/** Apply the last used theme before the first paint (settings arrive a moment later). */
export function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    // ignore
  }
  applyTheme(saved === "dark" || saved === "system" ? saved : "light");
}

interface SettingsState {
  settings: SettingsDTO | null;
  info: AppInfoDTO | null;
  load(): Promise<void>;
  set(patch: Patch): Promise<boolean>;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: null,
  info: null,
  load: async () => {
    const [s, i] = await Promise.all([call("settings:get", {}), call("app:info", {})]);
    if (s.ok) {
      set({ settings: s.data });
      applyTheme(s.data.theme);
    }
    if (i.ok) set({ info: i.data });
  },
  set: async (patch) => {
    const prev = get().settings;
    if (prev) set({ settings: { ...prev, ...patch } as SettingsDTO });
    if (patch.theme) applyTheme(patch.theme);
    const r = await call("settings:set", patch);
    if (r.ok) {
      set({ settings: r.data });
      applyTheme(r.data.theme);
      return true;
    }
    if (prev) {
      set({ settings: prev });
      applyTheme(prev.theme);
    }
    return false;
  },
}));
