/** App-wide UI state: route, panels, toasts, the shared confirm dialog. */
import { create } from "zustand";

export type Route = "session" | "jobs" | "mcp" | "memory" | "models" | "settings";

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve(ok: boolean): void;
}

interface UiState {
  route: Route;
  setRoute(r: Route): void;
  inspectorOpen: boolean;
  toggleInspector(): void;
  paletteOpen: boolean;
  setPalette(open: boolean): void;
  newSessionOpen: boolean;
  setNewSession(open: boolean): void;
  /** Catalog id whose install sheet should open (deep link / palette). */
  mcpInstallId: string | null;
  setMcpInstallId(id: string | null): void;
  toasts: Toast[];
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  confirmReq: ConfirmRequest | null;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  answerConfirm(ok: boolean): void;
}

let toastSeq = 0;

export const useUi = create<UiState>()((set, get) => ({
  route: "session",
  setRoute: (route) => set({ route }),
  inspectorOpen: false,
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  newSessionOpen: false,
  setNewSession: (newSessionOpen) => set({ newSessionOpen }),
  mcpInstallId: null,
  setMcpInstallId: (mcpInstallId) => set({ mcpInstallId }),
  toasts: [],
  toast: (text, kind = "error") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  confirmReq: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      get().confirmReq?.resolve(false);
      set({ confirmReq: { ...opts, resolve } });
    }),
  answerConfirm: (ok) => {
    const req = get().confirmReq;
    set({ confirmReq: null });
    req?.resolve(ok);
  },
}));
