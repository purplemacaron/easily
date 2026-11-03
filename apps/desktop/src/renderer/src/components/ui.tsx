/** Small shared building blocks: sheet, inline notice, toasts, confirm dialog, switch. */
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useUi } from "../stores/ui";
import styles from "./ui.module.css";

export function Sheet(props: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("input:not([readonly]):not([type=checkbox]), textarea, select");
    (first ?? el?.querySelector<HTMLElement>("button"))?.focus();
  }, []);
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={ref}
        className={styles.sheet}
        style={{ width: props.width ?? 460 }}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            props.onClose();
          }
        }}
      >
        <div className={styles.sheetHead}>
          <h3>{props.title}</h3>
          <button className="icon-btn" aria-label="닫기" onClick={props.onClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className={styles.sheetBody}>{props.children}</div>
        {props.footer && <div className={styles.sheetFoot}>{props.footer}</div>}
      </div>
    </div>
  );
}

/** Inline error under a form. */
export function Notice({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className={styles.notice} role="alert">
      {text}
    </p>
  );
}

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className={styles.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-kind={t.kind} role={t.kind === "error" ? "alert" : "status"}>
          <span className={styles.toastText}>{t.text}</span>
          <button className="icon-btn" aria-label="닫기" onClick={() => dismiss(t.id)}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const req = useUi((s) => s.confirmReq);
  const answer = useUi((s) => s.answerConfirm);
  if (!req) return null;
  return (
    <Sheet
      title={req.title}
      width={400}
      onClose={() => answer(false)}
      footer={
        <>
          <button className="btn" onClick={() => answer(false)}>
            취소
          </button>
          <button className={req.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => answer(true)} autoFocus>
            {req.confirmLabel}
          </button>
        </>
      }
    >
      {req.body && <p className={styles.confirmBody}>{req.body}</p>}
    </Sheet>
  );
}

export function Switch(props: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="switch"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export function EmptyLine(props: { text: string; action?: { label: string; onClick(): void } }) {
  return (
    <div className="empty-line">
      <span>{props.text}</span>
      {props.action && (
        <button className="btn" onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}
