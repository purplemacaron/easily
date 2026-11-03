/** UI strings for enums (Korean, noun forms). Kept together so they can move to i18n keys later. */
import type { Effort, ModelRole, PermissionMode, ToolRisk, TurnReason } from "../../../shared/types";

export const MODE_LABEL: Record<PermissionMode, string> = {
  ask: "확인",
  "auto-edit": "자동 편집",
  plan: "계획",
  yolo: "전체 허용",
};

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  xhigh: "매우 높음",
  max: "최대",
};

export const ROLE_LABEL: Record<ModelRole, string> = {
  main: "주 모델",
  fast: "빠른 모델",
  subagent: "서브에이전트",
  judge: "판정",
};

export const RISK_LABEL: Record<ToolRisk, string> = {
  read: "읽기",
  write: "쓰기",
  exec: "실행",
  network: "네트워크",
};

export const REASON_LABEL: Record<TurnReason, string> = {
  end_turn: "완료",
  refusal: "모델이 응답을 거부했습니다",
  max_tokens: "출력 한도에 도달했습니다",
  aborted: "중단됨",
  error: "오류",
  budget: "예산 한도 초과",
  timeout: "시간 초과",
};
