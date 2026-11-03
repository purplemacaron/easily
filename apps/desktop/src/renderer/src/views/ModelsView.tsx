import { Plus, Trash2 } from "lucide-react";
// presets.ts has no runtime deps, so the renderer imports it through the dedicated `./presets` export.
import { PROVIDER_PRESETS, type PresetGroup, type ProviderPreset } from "@easily/core/presets";
import { useEffect, useState } from "react";
import type { ConnectionDTO, ModelRole } from "../../../shared/types";
import { ProviderLogo } from "../components/ProviderLogo";
import { Notice, Sheet } from "../components/ui";
import { openExternal } from "../lib/ipc";
import { ROLE_LABEL } from "../lib/labels";
import { useProviders } from "../stores/providers";
import { useUi } from "../stores/ui";
import styles from "./ModelsView.module.css";

const GROUPS: Array<{ id: PresetGroup; label: string }> = [
  { id: "featured", label: "주요" },
  { id: "custom", label: "호환 API" },
  { id: "cloud", label: "클라우드" },
  { id: "inference", label: "추론 플랫폼" },
  { id: "regional", label: "지역" },
  { id: "local", label: "로컬" },
];
const ROLES: ModelRole[] = ["main", "fast", "subagent", "judge"];

const presetOf = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id);

export function ModelsView() {
  const { data, tests, load, test, remove, setRole } = useProviders();
  const confirm = useUi((s) => s.confirm);
  const [picked, setPicked] = useState<ProviderPreset | null>(null);

  useEffect(() => void load(), [load]);

  const connections = data?.connections ?? [];
  const rolesOf = (c: ConnectionDTO) => ROLES.filter((r) => data?.roles[r]?.connectionId === c.id);

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>모델</h1>
        </header>

        {connections.length > 0 && (
          <>
            <h2 className="block-title" style={{ marginTop: 0 }}>
              연결됨
            </h2>
            <div className="list">
              {connections.map((c) => {
                const preset = presetOf(c.presetId);
                const t = tests[c.id];
                return (
                  <div key={c.id} className="row">
                    <ProviderLogo slug={preset?.logo ?? "easily:openai-compatible"} name={preset?.name ?? c.label} size={18} />
                    <div className="row-main">
                      <div className="row-title">
                        {c.label}
                        {rolesOf(c).map((r) => (
                          <span key={r} className={`badge ${styles.role}`}>
                            {ROLE_LABEL[r]}
                          </span>
                        ))}
                      </div>
                      <div className="row-sub mono">
                        {c.baseURL || preset?.name}
                        {c.keyLast4 ? ` · ••••${c.keyLast4}` : ""}
                        {` · 모델 ${c.models.length}개`}
                      </div>
                    </div>
                    {t && t !== "running" && (
                      <span className={styles.testResult} title={t.error}>
                        <span className="dot" data-state={t.ok ? "ok" : "err"} />
                        {t.ok ? `${t.latencyMs}ms` : <span className="err-text truncate">{t.error ?? "실패"}</span>}
                      </span>
                    )}
                    <button className="btn" disabled={t === "running"} onClick={() => void test(c.id)}>
                      {t === "running" ? "확인 중" : "테스트"}
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="삭제"
                      onClick={async () => {
                        if (await confirm({ title: "연결 삭제", body: c.label, confirmLabel: "삭제", danger: true })) void remove(c.id);
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                );
              })}
            </div>

            <h2 className="block-title">역할</h2>
            <div className="list">
              {ROLES.map((role) => {
                const b = data?.roles[role];
                return (
                  <div key={role} className="row">
                    <span className={styles.roleName}>{ROLE_LABEL[role]}</span>
                    <select
                      className={`select ${styles.roleSelect}`}
                      aria-label={ROLE_LABEL[role]}
                      value={b ? `${b.connectionId}|${b.model}` : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return void setRole(role, null);
                        const at = v.indexOf("|");
                        void setRole(role, v.slice(0, at), v.slice(at + 1));
                      }}
                    >
                      <option value="">{role === "main" ? "자동" : "주 모델 사용"}</option>
                      {connections.map((c) => (
                        <optgroup key={c.id} label={c.label}>
                          {c.models.map((m) => (
                            <option key={m.id} value={`${c.id}|${m.id}`}>
                              {m.displayName ?? m.id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {GROUPS.map((g) => (
          <section key={g.id}>
            <h2 className="block-title">{g.label}</h2>
            <div className={styles.grid}>
              {PROVIDER_PRESETS.filter((p) => p.group === g.id).map((p) => (
                <button key={p.id} className={styles.tile} onClick={() => setPicked(p)}>
                  <ProviderLogo slug={p.logo} name={p.name} size={g.id === "custom" ? 22 : 18} />
                  <span className="truncate">{p.name}</span>
                  <Plus size={14} strokeWidth={1.5} className={styles.plus} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {picked && <ConnectSheet preset={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}

function ConnectSheet({ preset, onClose }: { preset: ProviderPreset; onClose(): void }) {
  const connect = useProviders((s) => s.connect);
  const [label, setLabel] = useState(preset.name);
  const [baseURL, setBaseURL] = useState(preset.baseURL);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compatible = preset.kind === "openai-compatible" || preset.kind === "anthropic-compatible";

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await connect({
      presetId: preset.id,
      label: label.trim() || preset.name,
      baseURL: baseURL.trim(),
      apiKey: apiKey || undefined,
      extra,
      model: model.trim() || undefined,
    });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title={
        <>
          <ProviderLogo slug={preset.logo} name={preset.name} size={20} />
          {preset.name}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {preset.keyUrl && (
            <button className={`btn btn-quiet ${styles.keyLink}`} onClick={() => openExternal(preset.keyUrl!)}>
              키 발급
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "연결 중" : "연결"}
          </button>
        </>
      }
    >
      <div
        className={styles.form}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === "INPUT" && !busy) void submit();
        }}
      >
        <label className="field">
          <span>이름</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {(preset.editableBaseURL || preset.baseURL) && (
          <label className="field">
            <span>Base URL</span>
            <input
              className="input mono"
              value={baseURL}
              placeholder="https://example.com/v1"
              readOnly={!preset.editableBaseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>API 키{!preset.requiresKey && " (선택)"}</span>
          <input className="input mono" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
        {preset.extraFields?.map((f) => (
          <label key={f.key} className="field">
            <span>
              {f.label}
              {!f.required && " (선택)"}
            </span>
            <input
              className="input mono"
              value={extra[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))}
            />
          </label>
        ))}
        {compatible && (
          <label className="field">
            <span>모델 ID (선택)</span>
            <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
        )}
        <Notice text={error} />
      </div>
    </Sheet>
  );
}
