import type { Effort, PermissionMode, SettingsDTO } from "../../../shared/types";
import { Switch } from "../components/ui";
import { call } from "../lib/ipc";
import { EFFORT_LABEL, MODE_LABEL } from "../lib/labels";
import { useSettings } from "../stores/settings";
import styles from "./SettingsView.module.css";

const THEMES: Array<[SettingsDTO["theme"], string]> = [
  ["light", "라이트"],
  ["dark", "다크"],
  ["system", "시스템"],
];

export function SettingsView() {
  const { settings, info, set } = useSettings();
  if (!settings) return <div className="page" />;

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>설정</h1>
        </header>

        <div className="list">
          <div className="row">
            <span className={styles.label}>테마</span>
            <div className="segmented" role="group" aria-label="테마">
              {THEMES.map(([v, label]) => (
                <button key={v} aria-pressed={settings.theme === v} onClick={() => void set({ theme: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="row">
            <span className={styles.label}>기본 권한 모드</span>
            <select className={`select ${styles.select}`} aria-label="기본 권한 모드" value={settings.permissionMode} onChange={(e) => void set({ permissionMode: e.target.value as PermissionMode })}>
              {(Object.keys(MODE_LABEL) as PermissionMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          <div className="row">
            <span className={styles.label}>노력 수준</span>
            <select className={`select ${styles.select}`} aria-label="노력 수준" value={settings.effort} onChange={(e) => void set({ effort: e.target.value as Effort })}>
              {(Object.keys(EFFORT_LABEL) as Effort[]).map((m) => (
                <option key={m} value={m}>
                  {EFFORT_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          <div className="row">
            <span className={styles.label}>로그인 시 실행</span>
            <Switch checked={settings.launchAtLogin} label="로그인 시 실행" onChange={(v) => void set({ launchAtLogin: v })} />
          </div>

          <div className="row">
            <span className={styles.label}>기본 폴더</span>
            <span className={`mono truncate ${styles.path}`} title={settings.defaultCwd}>
              {settings.defaultCwd ?? "홈 폴더"}
            </span>
            <button
              className="btn"
              onClick={async () => {
                const r = await call("app:pickFolder", {});
                if (r.ok && r.data) void set({ defaultCwd: r.data });
              }}
            >
              선택
            </button>
          </div>

          <div className="row">
            <span className={styles.label}>데이터 폴더</span>
            <span className={`mono truncate ${styles.path}`} title={info?.dataDir}>
              {info?.dataDir ?? ""}
            </span>
          </div>

          <div className="row">
            <span className={styles.label}>버전</span>
            <span className="mono muted">{info ? `${info.version} · ${info.platform}` : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
