import { useState } from "react";
import { call } from "../lib/ipc";
import { useSessions } from "../stores/sessions";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { Sheet } from "./ui";

/** Folder for the new session: defaults to the settings' default folder, otherwise the home folder (main decides). */
export function NewSessionSheet() {
  const close = () => useUi.getState().setNewSession(false);
  const defaultCwd = useSettings((s) => s.settings?.defaultCwd);
  const create = useSessions((s) => s.create);
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const id = await create(cwd.trim() || undefined);
    setBusy(false);
    if (id) close();
  };

  return (
    <Sheet
      title="새 세션"
      width={440}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
            시작
          </button>
        </>
      }
    >
      <div
        className="field"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void start();
        }}
      >
        <span>작업 폴더</span>
        <div className="field-row">
          <input className="input mono" value={cwd} placeholder="홈 폴더" onChange={(e) => setCwd(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              const r = await call("app:pickFolder", {});
              if (r.ok && r.data) setCwd(r.data);
            }}
          >
            선택
          </button>
        </div>
      </div>
    </Sheet>
  );
}
