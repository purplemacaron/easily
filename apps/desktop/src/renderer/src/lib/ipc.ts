/**
 * Typed wrapper over window.easily.invoke. Every call resolves to {ok, data|error}; failures are
 * surfaced as a toast unless the caller handles the error itself ({ quiet: true }).
 */
import type { IpcChannel, IpcPayload, IpcResponse } from "../../../shared/ipc";
import type { IpcResult } from "../../../shared/types";
import { useUi } from "../stores/ui";

export async function call<C extends IpcChannel>(
  channel: C,
  payload: IpcPayload<C>,
  opts: { quiet?: boolean } = {},
): Promise<IpcResult<IpcResponse<C>>> {
  let result: IpcResult<IpcResponse<C>>;
  try {
    result = await window.easily.invoke(channel, payload);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!result.ok && !opts.quiet) useUi.getState().toast(result.error);
  return result;
}

/** Resolve to the data, or `undefined` after reporting the error. */
export async function callData<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResponse<C> | undefined> {
  const r = await call(channel, payload);
  return r.ok ? r.data : undefined;
}

export function openExternal(url: string): void {
  void call("app:openExternal", { url });
}
