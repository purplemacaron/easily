import { Plus } from "lucide-react";
import { useState } from "react";
// Deep import: presets.ts has no runtime deps, so the renderer can use it directly.
import { PROVIDER_PRESETS, type PresetGroup, type ProviderPreset } from "@easily/core/src/providers/presets";
import { ProviderLogo } from "../components/ProviderLogo";
import styles from "./ModelsView.module.css";

const GROUPS: Array<{ id: PresetGroup; label: string }> = [
  { id: "featured", label: "주요" },
  { id: "custom", label: "호환 API" },
  { id: "cloud", label: "클라우드" },
  { id: "inference", label: "추론 플랫폼" },
  { id: "regional", label: "지역" },
  { id: "local", label: "로컬" },
];

/** Settings › 모델 (M-001..M-022). Mock connections until Phase 1 wires provider:* IPC. */
export function ModelsView() {
  const [picked, setPicked] = useState<ProviderPreset | null>(null);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>모델</h1>
      </header>

      <section className={styles.block}>
        <h2>연결됨</h2>
        <div className={styles.table}>
          <ConnectionRow slug="anthropic" name="Anthropic" label="개인" detail="claude-opus-5-5 · main" ms={212} />
          <ConnectionRow slug="easily:anthropic-compatible" name="Anthropic 호환" label="사내 프록시" detail="llm.corp.internal/v1 · subagent" ms={88} />
          <ConnectionRow slug="ollama" name="Ollama" label="로컬" detail="127.0.0.1:11434 · fast" ms={31} />
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g.id} className={styles.block}>
          <h2>{g.label}</h2>
          <div className={styles.grid} data-group={g.id}>
            {PROVIDER_PRESETS.filter((p) => p.group === g.id).map((p) => (
              <button key={p.id} className={styles.tile} onClick={() => setPicked(p)}>
                <ProviderLogo slug={p.logo} name={p.name} size={g.id === "custom" ? 22 : 18} />
                <span className={styles.tileName}>{p.name}</span>
                <Plus size={14} strokeWidth={1.5} className={styles.tilePlus} />
              </button>
            ))}
          </div>
        </section>
      ))}

      {picked && (
        <div className={styles.sheetBackdrop} onClick={() => setPicked(null)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${picked.name} 연결`}>
            <div className={styles.sheetHead}>
              <ProviderLogo slug={picked.logo} name={picked.name} size={22} />
              <h3>{picked.name} 연결</h3>
            </div>
            <label>
              이름
              <input defaultValue={picked.name} />
            </label>
            {(picked.editableBaseURL || picked.baseURL) && (
              <label>
                Base URL
                <input defaultValue={picked.baseURL} placeholder="https://example.com/v1" readOnly={!picked.editableBaseURL} />
              </label>
            )}
            <label>
              API 키{!picked.requiresKey && <span className={styles.optional}>선택</span>}
              <input type="password" placeholder="sk-…" />
            </label>
            {picked.extraFields?.map((f) => (
              <label key={f.key}>
                {f.label}
                <input placeholder={f.placeholder} />
              </label>
            ))}
            <div className={styles.sheetFoot}>
              {picked.keyUrl && <span className={styles.keyLink}>키 발급 ↗</span>}
              <button className="btn">연결 테스트</button>
              <button className="btn btn-primary">추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionRow(props: { slug: string; name: string; label: string; detail: string; ms: number }) {
  return (
    <div className={styles.conn}>
      <ProviderLogo slug={props.slug} name={props.name} size={18} />
      <span className={styles.connName}>{props.label}</span>
      <span className={styles.connDetail}>{props.detail}</span>
      <span className="dot" data-state="ok" />
      <span className={styles.connMs}>{props.ms}ms</span>
    </div>
  );
}
