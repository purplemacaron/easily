import { ChevronRight, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CatalogItemDTO, McpServerDTO, McpStatusDTO } from "../../../shared/types";
import { ProviderLogo } from "../components/ProviderLogo";
import { EmptyLine, Notice, Sheet, Switch } from "../components/ui";
import { call } from "../lib/ipc";
import { useMcp, type InstallStep } from "../stores/mcp";
import { useUi } from "../stores/ui";
import styles from "./McpView.module.css";

const CATEGORY_LABEL: Record<CatalogItemDTO["category"], string> = {
  core: "기본",
  web: "웹",
  dev: "개발",
  work: "업무",
  data: "데이터",
  media: "미디어",
};
const STEP_LABEL: Record<InstallStep["step"], string> = {
  detectRuntime: "런타임 확인",
  collectInputs: "입력 확인",
  writeConfig: "설정 저장",
  connect: "서버 연결",
  healthCheck: "상태 확인",
};
const STATE_DOT: Record<McpStatusDTO["state"], string | undefined> = { connected: "ok", connecting: "live", error: "err", disabled: "off" };

export function McpView() {
  const { catalog, servers, loaded, load, setEnabled, restart, remove } = useMcp();
  const confirm = useUi((s) => s.confirm);
  const installId = useUi((s) => s.mcpInstallId);
  const setInstallId = useUi((s) => s.setMcpInstallId);
  const [installing, setInstalling] = useState<CatalogItemDTO | null>(null);
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [category, setCategory] = useState<CatalogItemDTO["category"] | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => void load(), [load]);

  // Deep link / palette: open the install sheet for a catalog id once the catalog is here.
  useEffect(() => {
    if (!installId || !loaded) return;
    const entry = catalog.find((c) => c.id === installId);
    setInstallId(null);
    if (!entry) useUi.getState().toast(`카탈로그에 없는 항목입니다: ${installId}`);
    else if (!entry.installed && entry.supported) setInstalling(entry);
    else if (entry.installed) useUi.getState().toast(`${entry.name}은(는) 이미 설치되어 있습니다.`, "info");
  }, [installId, loaded, catalog, setInstallId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter(
      (c) => (category === "all" || c.category === category) && (!q || `${c.name} ${c.description} ${c.id}`.toLowerCase().includes(q)),
    );
  }, [catalog, category, query]);

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>MCP</h1>
          <button className="btn" onClick={() => setCustom(true)}>
            <Plus size={14} strokeWidth={1.5} />
            직접 추가
          </button>
        </header>

        {servers.length > 0 && (
          <>
            <h2 className="block-title" style={{ marginTop: 0 }}>
              설치됨
            </h2>
            <div className="list">
              {servers.map((s) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  expanded={open === s.id}
                  onToggle={() => setOpen(open === s.id ? null : s.id)}
                  onEnabled={(v) => void setEnabled(s.id, v)}
                  onRestart={() => void restart(s.id)}
                  onRemove={async () => {
                    if (await confirm({ title: "MCP 제거", body: s.name, confirmLabel: "제거", danger: true })) void remove(s.id);
                  }}
                />
              ))}
            </div>
          </>
        )}

        <h2 className="block-title">카탈로그</h2>
        <div className={styles.filters}>
          <input className="input" style={{ maxWidth: 220 }} placeholder="검색" aria-label="카탈로그 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="segmented" role="group" aria-label="분류">
            {(["all", ...Object.keys(CATEGORY_LABEL)] as Array<CatalogItemDTO["category"] | "all">).map((c) => (
              <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
                {c === "all" ? "전체" : CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        {loaded && shown.length === 0 && <EmptyLine text="항목이 없습니다" />}
        <div className="list">
          {shown.map((c) => {
            const missing = c.runtime && !c.runtime.available;
            const blocked = !c.supported || missing;
            const reason = !c.supported ? c.unsupportedReason : missing ? `${c.runtime!.command} 필요` : undefined;
            return (
              <div key={c.id} className="row">
                <ProviderLogo slug={c.logo} name={c.name} size={18} />
                <div className="row-main">
                  <div className="row-title">
                    {c.name}
                    {c.verified && <span className={`badge ${styles.badge}`}>검증됨</span>}
                  </div>
                  <div className="row-sub" title={c.description}>
                    {reason ? <span className={missing ? "err-text" : undefined}>{reason}</span> : c.description}
                  </div>
                </div>
                {c.installed ? (
                  <span className="muted">설치됨</span>
                ) : (
                  <button className="btn" disabled={!!blocked} title={reason} onClick={() => setInstalling(c)}>
                    설치
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {installing && <InstallSheet entry={installing} onClose={() => setInstalling(null)} />}
      {custom && <CustomSheet onClose={() => setCustom(false)} />}
    </div>
  );
}

function ServerRow(props: {
  server: McpServerDTO;
  expanded: boolean;
  onToggle(): void;
  onEnabled(v: boolean): void;
  onRestart(): void;
  onRemove(): void;
}) {
  const { server: s } = props;
  const st = s.status;
  return (
    <div>
      <div className="row">
        <button className={styles.expand} aria-expanded={props.expanded} onClick={props.onToggle}>
          <ChevronRight size={14} strokeWidth={1.5} className={styles.chev} data-open={props.expanded} />
          <span className="dot" data-state={STATE_DOT[st.state]} />
          <span className="row-main">
            <span className="row-title" style={{ display: "block" }}>
              {s.name}
            </span>
            <span className="row-sub" style={{ display: "block" }}>
              {st.state === "error" ? <span className="err-text">{st.error ?? "오류"}</span> : st.state === "connected" ? `도구 ${st.toolCount}개${st.latencyMs !== undefined ? ` · ${st.latencyMs}ms` : ""}` : st.state === "connecting" ? "연결 중" : "꺼짐"}
            </span>
          </span>
        </button>
        <Switch checked={s.enabled} label={`${s.name} 사용`} onChange={props.onEnabled} />
        <button className="icon-btn" aria-label="재시작" disabled={!s.enabled} onClick={props.onRestart}>
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
        <button className="icon-btn" aria-label="제거" onClick={props.onRemove}>
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>
      {props.expanded && (
        <div className={styles.detail}>
          {st.tools.length > 0 && <p className={styles.tools}>{st.tools.map((t) => t.name).join("  ")}</p>}
          <pre className={styles.log}>{st.log.length ? st.log.slice(-120).join("\n") : "로그 없음"}</pre>
        </div>
      )}
    </div>
  );
}

function InstallSheet({ entry, onClose }: { entry: CatalogItemDTO; onClose(): void }) {
  const { install, progress, clearProgress } = useMcp();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = progress[entry.id] ?? [];

  useEffect(() => () => clearProgress(entry.id), [entry.id, clearProgress]);

  const pick = async (key: string, multi: boolean) => {
    const r = await call("app:pickFolder", {});
    if (!r.ok || !r.data) return;
    setValues((v) => ({ ...v, [key]: multi ? [...(v[key] ? v[key]!.split("\n") : []), r.data!].join("\n") : r.data! }));
  };

  const submit = async () => {
    for (const i of entry.inputs) {
      if (i.required && !values[i.key]?.trim()) return setError(`${i.label} 값이 필요합니다.`);
    }
    setError(null);
    setBusy(true);
    const err = await install(entry.id, values);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title={
        <>
          <ProviderLogo slug={entry.logo} name={entry.name} size={20} />
          {entry.name}
        </>
      }
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "설치 중" : "설치"}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        {entry.inputs.map((i) => (
          <div key={i.key} className="field">
            <span>
              {i.label}
              {!i.required && " (선택)"}
            </span>
            {i.kind === "folder" && (
              <div className="field-row">
                <input className="input mono" value={values[i.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [i.key]: e.target.value }))} />
                <button className="btn" onClick={() => void pick(i.key, false)}>
                  선택
                </button>
              </div>
            )}
            {i.kind === "folder-list" && (
              <div className={styles.folders}>
                {(values[i.key] ? values[i.key]!.split("\n") : []).map((f, idx) => (
                  <div key={idx} className={styles.folder}>
                    <span className="mono truncate">{f}</span>
                    <button
                      className="icon-btn"
                      aria-label="폴더 제거"
                      onClick={() => setValues((v) => ({ ...v, [i.key]: v[i.key]!.split("\n").filter((_, j) => j !== idx).join("\n") }))}
                    >
                      <X size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
                <button className="btn" style={{ justifySelf: "start" }} onClick={() => void pick(i.key, true)}>
                  <Plus size={14} strokeWidth={1.5} />
                  폴더 추가
                </button>
              </div>
            )}
            {(i.kind === "text" || i.kind === "url" || i.kind === "secret") && (
              <input
                className="input mono"
                type={i.kind === "secret" ? "password" : i.kind === "url" ? "url" : "text"}
                autoComplete="off"
                value={values[i.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [i.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        {steps.length > 0 && (
          <div className={styles.steps}>
            {steps.map((s) => (
              <div key={s.step} className={styles.step}>
                <span className="dot" data-state={s.state === "running" ? "live" : s.state === "done" ? "ok" : "err"} />
                <span>{STEP_LABEL[s.step]}</span>
                {s.message && <span className={s.state === "failed" ? "err-text truncate" : "muted truncate"}>{s.message}</span>}
              </div>
            ))}
          </div>
        )}
        <Notice text={error} />
      </div>
    </Sheet>
  );
}

/** Split on whitespace, honouring double quotes. */
export function splitArgs(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** "KEY=value" / "Name: value" lines → object. */
function parsePairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(sep);
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function CustomSheet({ onClose }: { onClose(): void }) {
  const addCustom = useMcp((s) => s.addCustom);
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError("이름을 입력하세요.");
    setError(null);
    setBusy(true);
    let err: string | null;
    if (type === "stdio") {
      const parts = splitArgs(command);
      if (parts.length === 0) {
        setBusy(false);
        return setError("실행 명령을 입력하세요.");
      }
      err = await addCustom({ name: name.trim(), command: parts[0], args: parts.slice(1), env: parsePairs(env, "=") });
    } else {
      if (!url.trim()) {
        setBusy(false);
        return setError("URL을 입력하세요.");
      }
      err = await addCustom({ name: name.trim(), url: url.trim(), headers: parsePairs(headers, ":") });
    }
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title="MCP 직접 추가"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            추가
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <label className="field">
          <span>이름</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="segmented" style={{ justifySelf: "start" }} role="group" aria-label="종류">
          <button aria-pressed={type === "stdio"} onClick={() => setType("stdio")}>
            명령
          </button>
          <button aria-pressed={type === "http"} onClick={() => setType("http")}>
            URL
          </button>
        </div>
        {type === "stdio" ? (
          <>
            <label className="field">
              <span>명령과 인자</span>
              <input className="input mono" placeholder="npx -y @scope/server" value={command} onChange={(e) => setCommand(e.target.value)} />
            </label>
            <label className="field">
              <span>환경 변수 (줄마다 KEY=값, 선택)</span>
              <textarea className="textarea mono" rows={3} value={env} onChange={(e) => setEnv(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>URL</span>
              <input className="input mono" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="field">
              <span>헤더 (줄마다 Name: 값, 선택)</span>
              <textarea className="textarea mono" rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </label>
          </>
        )}
        <Notice text={error} />
      </div>
    </Sheet>
  );
}
