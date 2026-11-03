import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { MemoryFileDTO } from "../../../shared/types";
import { EmptyLine, Notice, Sheet } from "../components/ui";
import { fmtDateTime } from "../lib/format";
import { useMemory } from "../stores/memory";
import { useUi } from "../stores/ui";
import styles from "./MemoryView.module.css";

const TYPE_LABEL: Record<MemoryFileDTO["type"], string> = {
  user: "사용자",
  feedback: "피드백",
  project: "프로젝트",
  reference: "참조",
};

export function MemoryView() {
  const { files, loaded, load } = useMemory();
  const [editing, setEditing] = useState<MemoryFileDTO | "new" | null>(null);

  useEffect(() => void load(), [load]);

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>메모리</h1>
          {files.length > 0 && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={14} strokeWidth={1.5} />새 메모리
            </button>
          )}
        </header>

        {loaded && files.length === 0 && <EmptyLine text="메모리가 없습니다" action={{ label: "새 메모리", onClick: () => setEditing("new") }} />}

        <div className="list">
          {files.map((f) => (
            <button key={f.name} className={`row ${styles.item}`} onClick={() => setEditing(f)}>
              <div className="row-main">
                <div className="row-title">{f.name}</div>
                <div className="row-sub">{f.description}</div>
              </div>
              <span className="badge">{TYPE_LABEL[f.type]}</span>
              <span className={styles.when}>{fmtDateTime(f.updatedAt)}</span>
            </button>
          ))}
        </div>
      </div>

      {editing && <MemorySheet file={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MemorySheet({ file, onClose }: { file: MemoryFileDTO | null; onClose(): void }) {
  const { upsert, remove } = useMemory();
  const confirm = useUi((s) => s.confirm);
  const [name, setName] = useState(file?.name ?? "");
  const [description, setDescription] = useState(file?.description ?? "");
  const [type, setType] = useState<MemoryFileDTO["type"]>(file?.type ?? "user");
  const [body, setBody] = useState(file?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("이름을 입력하세요.");
    setBusy(true);
    const err = await upsert({ name: name.trim(), description: description.trim(), type, body });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title={file ? file.name : "새 메모리"}
      width={560}
      onClose={onClose}
      footer={
        <>
          {file && (
            <button
              className="btn btn-danger"
              style={{ marginRight: "auto" }}
              onClick={async () => {
                if (await confirm({ title: "메모리 삭제", body: file.name, confirmLabel: "삭제", danger: true })) {
                  await remove(file.name);
                  onClose();
                }
              }}
            >
              삭제
            </button>
          )}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      {!file && (
        <label className="field">
          <span>이름</span>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <div className={styles.two}>
        <label className="field">
          <span>설명</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span>종류</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as MemoryFileDTO["type"])}>
            {(Object.keys(TYPE_LABEL) as Array<MemoryFileDTO["type"]>).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>내용</span>
        <textarea className="textarea" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <Notice text={error} />
    </Sheet>
  );
}
