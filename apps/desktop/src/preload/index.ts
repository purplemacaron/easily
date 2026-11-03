import { contextBridge, ipcRenderer } from "electron";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "../shared/channels";
import type { IpcChannel, IpcPayload, IpcResponse, PushChannel, PushPayloads } from "../shared/ipc";
import type { IpcResult } from "../shared/types";

// Only the channels declared in shared/channels.ts are reachable from the renderer.
const invokable = new Set<string>(INVOKE_CHANNELS);
const pushable = new Set<string>(PUSH_CHANNELS);

const api = {
  /** Every call resolves to `{ok:true,data}` or `{ok:false,error}`; it never rejects. */
  invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<IpcResponse<C>>> {
    if (!invokable.has(channel)) return Promise.resolve({ ok: false, error: `Unknown channel: ${channel}` });
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<IpcResponse<C>>>;
  },
  /** Subscribe to a push channel; returns the unsubscribe function. */
  on<C extends PushChannel>(channel: C, listener: (data: PushPayloads[C]) => void): () => void {
    if (!pushable.has(channel)) return () => undefined;
    const wrapped = (_e: Electron.IpcRendererEvent, data: PushPayloads[C]) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("easily", api);
export type EasilyApi = typeof api;
