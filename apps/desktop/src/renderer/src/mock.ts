// Static mock data so the shell renders before Phase 1 wires real IPC. Delete when unused.

export interface MockSession {
  id: string;
  title: string;
  when: string;
  state: "live" | "ok" | "idle";
}

export const MOCK_SESSIONS: MockSession[] = [
  { id: "s1", title: "3분기 매출 보고서 정리", when: "지금", state: "live" },
  { id: "s2", title: "받은 메일 요약 (예약)", when: "08:30", state: "ok" },
  { id: "s3", title: "계약서 v3 조항 비교", when: "어제", state: "idle" },
  { id: "s4", title: "회의록 → 액션아이템", when: "월", state: "idle" },
  { id: "s5", title: "Notion 위키 구조 개편", when: "10/28", state: "idle" },
];

export type MockBlock =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string; ms: number; state: "ok" | "live" }
  | { kind: "approval"; title: string; diff: string[] };

export const MOCK_TRANSCRIPT: MockBlock[] = [
  { kind: "user", text: "sales/ 폴더의 3분기 엑셀 파일들 합쳐서 지역별 매출 요약 보고서 만들어줘. 표 하나, 핵심 3줄." },
  { kind: "tool", name: "glob", summary: "sales/**/*Q3*.xlsx → 4개 파일", ms: 38, state: "ok" },
  { kind: "tool", name: "xlsx.read", summary: "4개 파일 병렬 읽기 · 12,480행", ms: 912, state: "ok" },
  {
    kind: "assistant",
    text: "4개 지사 파일을 합쳤습니다. 서울·부산이 전체의 71%이고, 대구는 전 분기 대비 18% 감소했습니다. 보고서를 reports/Q3-summary.md 로 저장하려고 합니다.",
  },
  {
    kind: "approval",
    title: "write  reports/Q3-summary.md",
    diff: ["+ # 3분기 지역별 매출", "+ | 지역 | 매출 | 전분기 대비 |", "+ |---|---:|---:|", "+ | 서울 | 4.21억 | +6.2% |", "+ | 부산 | 2.87억 | +2.9% |"],
  },
  { kind: "tool", name: "memory.recall", summary: "'보고서 형식' 관련 메모 2개", ms: 14, state: "live" },
];
