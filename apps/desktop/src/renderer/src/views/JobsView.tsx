import { ChevronRight, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { JobDTO, RunRecordDTO, TriggerDTO } from "../../../shared/types";
import { EmptyLine, Notice, Sheet, Switch } from "../components/ui";
import { fmtDateTime, fmtUsd, toLocalInput, truncate } from "../lib/format";
import { call } from "../lib/ipc";
import { useJobs } from "../stores/jobs";
import { useSessions } from "../stores/sessions";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import styles from "./JobsView.module.css";

export const CRON_PRESETS: Array<{ id: string; label: string; expr: string }> = [
  { id: "weekday9", label: "평일 09:00", expr: "0 9 * * 1-5" },
  { id: "daily9", label: "매일 09:00", expr: "0 9 * * *" },
  { id: "weekly", label: "매주 월요일 09:00", expr: "0 9 * * 1" },
  { id: "hourly", label: "매시 정각", expr: "0 * * * *" },
];

export function triggerLabel(t: TriggerDTO): string {
  switch (t.type) {
    case "cron":
      return CRON_PRESETS.find((p) => p.expr === t.expr)?.label ?? t.expr;
    case "once":
      return `한 번 · ${fmtDateTime(t.at)}`;
    case "app_start":
      return "앱 시작";
    case "resume":
      return "절전 해제";
  }
}

const RUN_LABEL: Record<RunRecordDTO["status"], string> = {
  running: "실행 중",
  ok: "완료",
  error: "오류",
  aborted: "중단",
  budget: "예산 초과",
  timeout: "시간 초과",
  refusal: "거부",
};
const runDot = (s: RunRecordDTO["status"]) => (s === "running" ? "live" : s === "ok" ? "ok" : s === "aborted" ? undefined : "err");

export function JobsView() {
  const { jobs, loaded, runs, load, loadRuns, update, remove, runNow, stop } = useJobs();
  const confirm = useUi((s) => s.confirm);
  const [editing, setEditing] = useState<JobDTO | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => void load(), [load]);

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>예약 작업</h1>
          {jobs.length > 0 && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={14} strokeWidth={1.5} />새 작업
            </button>
          )}
        </header>

        {loaded && jobs.length === 0 && <EmptyLine text="예약 작업이 없습니다" action={{ label: "새 작업", onClick: () => setEditing("new") }} />}

        <div className="list">
          {jobs.map((j) => {
            const expanded = open === j.id;
            return (
              <div key={j.id}>
                <div className="row">
                  <button
                    className={styles.expand}
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpen(expanded ? null : j.id);
                      if (!expanded) void loadRuns(j.id);
                    }}
                  >
                    <ChevronRight size={14} strokeWidth={1.5} className={styles.chev} data-open={expanded} />
                    <span className="dot" data-state={j.running ? "live" : j.enabled ? undefined : "off"} />
                    <span className="row-main">
                      <span className="row-title" style={{ display: "block" }}>
                        {j.name}
                      </span>
                      <span className="row-sub" style={{ display: "block" }}>
                        {triggerLabel(j.trigger)}
                        {j.running ? " · 실행 중" : j.nextRunAt && j.enabled ? ` · 다음 ${fmtDateTime(j.nextRunAt)}` : ""}
                        {j.lastRunAt ? ` · 마지막 ${fmtDateTime(j.lastRunAt)}` : ""}
                      </span>
                    </span>
                  </button>
                  <Switch checked={j.enabled} label={`${j.name} 사용`} onChange={(v) => void update(j.id, { enabled: v })} />
                  {j.running ? (
                    <button className="icon-btn" aria-label="중지" onClick={() => void stop(j.id)}>
                      <Square size={14} strokeWidth={1.5} />
                    </button>
                  ) : (
                    <button className="icon-btn" aria-label="지금 실행" onClick={() => void runNow(j.id)}>
                      <Play size={14} strokeWidth={1.5} />
                    </button>
                  )}
                  <button className="icon-btn" aria-label="편집" onClick={() => setEditing(j)}>
                    <Pencil size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="삭제"
                    onClick={async () => {
                      if (await confirm({ title: "작업 삭제", body: j.name, confirmLabel: "삭제", danger: true })) void remove(j.id);
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
                {expanded && <RunHistory runs={runs[j.id]} />}
              </div>
            );
          })}
        </div>
      </div>

      {editing && <JobForm job={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RunHistory({ runs }: { runs: RunRecordDTO[] | undefined }) {
  const select = useSessions((s) => s.select);
  if (!runs) return <div className={styles.runs} />;
  if (runs.length === 0) return <div className={styles.runs}><span className="muted">실행 기록 없음</span></div>;
  return (
    <div className={styles.runs}>
      {runs.map((r) => (
        <div key={r.id} className={styles.run}>
          <span className="dot" data-state={runDot(r.status)} />
          <span className={styles.runTime}>{fmtDateTime(r.startedAt)}</span>
          <span className={styles.runStatus}>{RUN_LABEL[r.status]}</span>
          <span className={styles.runSummary} title={r.detail ?? r.summary}>
            {truncate(r.detail ?? r.summary ?? "", 90)}
          </span>
          {r.changedFiles.length > 0 && <span className="muted">파일 {r.changedFiles.length}</span>}
          <span className={styles.runCost}>{fmtUsd(r.costUsd)}</span>
          {r.sessionId && (
            <button className="btn btn-quiet" style={{ height: 22, padding: "0 6px" }} onClick={() => void select(r.sessionId!)}>
              열기
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type TriggerKind = TriggerDTO["type"];

function JobForm({ job, onClose }: { job: JobDTO | null; onClose(): void }) {
  const { create, update } = useJobs();
  const defaultCwd = useSettings((s) => s.settings?.defaultCwd);

  const initialCron = job?.trigger.type === "cron" ? job.trigger.expr : CRON_PRESETS[0]!.expr;
  const [name, setName] = useState(job?.name ?? "");
  const [prompt, setPrompt] = useState(job?.prompt ?? "");
  const [cwd, setCwd] = useState(job?.cwd ?? defaultCwd ?? "");
  const [kind, setKind] = useState<TriggerKind>(job?.trigger.type ?? "cron");
  const [preset, setPreset] = useState(CRON_PRESETS.find((p) => p.expr === initialCron)?.id ?? "custom");
  const [expr, setExpr] = useState(initialCron);
  const [at, setAt] = useState(job?.trigger.type === "once" ? toLocalInput(job.trigger.at) : toLocalInput(Date.now() + 3600_000));
  const [mode, setMode] = useState<"plan" | "auto-edit">(job?.profile.mode ?? "plan");
  const [allowNetwork, setAllowNetwork] = useState(job?.profile.allowNetwork ?? false);
  const [maxUsd, setMaxUsd] = useState(job?.limits.maxUsd?.toString() ?? "");
  const [maxMinutes, setMaxMinutes] = useState(job?.limits.maxMinutes?.toString() ?? "");
  const [retries, setRetries] = useState(String(job?.limits.retries ?? 0));
  const [catchUp, setCatchUp] = useState(job?.catchUp ?? true);
  const [notify, setNotify] = useState(job ? job.deliver.includes("notify") : true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPreset = (id: string) => {
    setPreset(id);
    const p = CRON_PRESETS.find((x) => x.id === id);
    if (p) setExpr(p.expr);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("이름을 입력하세요.");
    if (!prompt.trim()) return setError("프롬프트를 입력하세요.");
    if (!cwd.trim()) return setError("작업 폴더를 선택하세요.");
    let trigger: TriggerDTO;
    if (kind === "cron") {
      if (!expr.trim()) return setError("크론 식을 입력하세요.");
      trigger = { type: "cron", expr: expr.trim(), tz: job?.trigger.type === "cron" ? job.trigger.tz : undefined };
    } else if (kind === "once") {
      const ts = new Date(at).getTime();
      if (!Number.isFinite(ts)) return setError("실행 시각을 입력하세요.");
      trigger = { type: "once", at: ts };
    } else trigger = { type: kind };

    const usd = maxUsd.trim() ? Number(maxUsd) : undefined;
    const minutes = maxMinutes.trim() ? Number(maxMinutes) : undefined;
    if ((usd !== undefined && !(usd > 0)) || (minutes !== undefined && !(minutes > 0))) return setError("한도는 0보다 큰 숫자여야 합니다.");
    const r = Number(retries);
    if (!Number.isInteger(r) || r < 0 || r > 5) return setError("재시도는 0–5 사이의 정수입니다.");

    const deliver = new Set(job?.deliver ?? []);
    if (notify) deliver.add("notify");
    else deliver.delete("notify");

    const input = {
      name: name.trim(),
      enabled: job?.enabled ?? true,
      trigger,
      prompt: prompt.trim(),
      cwd: cwd.trim(),
      profile: {
        mode,
        writableDirs: mode === "auto-edit" ? (job?.profile.writableDirs.length ? job.profile.writableDirs : [cwd.trim()]) : [],
        allowNetwork,
      },
      limits: { maxUsd: usd, maxMinutes: minutes, retries: r },
      deliver: [...deliver],
      catchUp,
    };
    setBusy(true);
    const err = job ? await update(job.id, input) : await create(input);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title={job ? "작업 편집" : "새 작업"}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {job ? "저장" : "만들기"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>이름</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>프롬프트</span>
        <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="field">
        <span>작업 폴더</span>
        <div className="field-row">
          <input className="input mono" value={cwd} onChange={(e) => setCwd(e.target.value)} />
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

      <div className="field">
        <span>실행 조건</span>
        <div className="segmented" role="group" aria-label="실행 조건">
          {(
            [
              ["cron", "반복"],
              ["once", "한 번"],
              ["app_start", "앱 시작"],
              ["resume", "절전 해제"],
            ] as Array<[TriggerKind, string]>
          ).map(([k, label]) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {kind === "cron" && (
        <div className="field-row">
          <select className="select" style={{ width: 190 }} aria-label="반복 프리셋" value={preset} onChange={(e) => onPreset(e.target.value)}>
            {CRON_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">직접 입력</option>
          </select>
          <input
            className="input mono"
            aria-label="크론 식"
            value={expr}
            onChange={(e) => {
              setExpr(e.target.value);
              setPreset(CRON_PRESETS.find((p) => p.expr === e.target.value.trim())?.id ?? "custom");
            }}
          />
        </div>
      )}
      {kind === "once" && <input className="input" type="datetime-local" aria-label="실행 시각" value={at} onChange={(e) => setAt(e.target.value)} />}

      <div className="field">
        <span>권한</span>
        <div className="field-row">
          <select className="select" style={{ width: 190 }} aria-label="권한 프로필" value={mode} onChange={(e) => setMode(e.target.value as "plan" | "auto-edit")}>
            <option value="plan">계획 (읽기 전용)</option>
            <option value="auto-edit">자동 편집</option>
          </select>
        </div>
      </div>
      <div className={styles.grid3}>
        <label className="field">
          <span>비용 한도 ($)</span>
          <input className="input mono" inputMode="decimal" value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} />
        </label>
        <label className="field">
          <span>시간 한도 (분)</span>
          <input className="input mono" inputMode="decimal" value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} />
        </label>
        <label className="field">
          <span>재시도</span>
          <input className="input mono" inputMode="numeric" value={retries} onChange={(e) => setRetries(e.target.value)} />
        </label>
      </div>
      <div className={styles.toggles}>
        <label>
          <Switch checked={allowNetwork} label="네트워크 허용" onChange={setAllowNetwork} />
          네트워크 허용
        </label>
        <label>
          <Switch checked={catchUp} label="놓친 실행 보충" onChange={setCatchUp} />
          놓친 실행 보충
        </label>
        <label>
          <Switch checked={notify} label="완료 알림" onChange={setNotify} />
          완료 알림
        </label>
      </div>
      <Notice text={error} />
    </Sheet>
  );
}
