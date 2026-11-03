import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannel, IpcPayload, PushChannel } from "../shared/ipc";

const api = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<unknown> {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: PushChannel, listener: (data: unknown) => void): () => void {
    const wrapped = (_e: Electron.IpcRendererEvent, data: unknown) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("easily", api);
export type EasilyApi = typeof api;
