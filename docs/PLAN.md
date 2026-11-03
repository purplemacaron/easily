# Easily — 구현 계획

> 구현 담당: Claude Sonnet. 이 문서의 **위에서부터 순서대로** 진행한다.
> 각 Phase는 "완료 기준"을 모두 만족해야 다음으로 넘어간다. 체크박스는 작업하면서 직접 체크한다.
> 기능 ID(`A-001` 등)는 `site/data/features.js`의 항목을 가리킨다.

## 제품 목표

1. **하네스 품질이 Claude Code 이상.** 에이전트 루프, 권한, 훅, 스킬, 서브에이전트, 체크포인트, 컨텍스트 관리 전부 1급.
2. **스스로 좋아진다.** 모든 실행을 기록하고, 반성하고, 메모리·스킬·프롬프트 개선안을 만들고, 평가로 검증한 뒤 채택한다.
3. **컴퓨터가 켜져 있으면 일한다.** 트레이 상주 + 예약 작업 + 트리거 + 놓친 작업 보충.
4. **MCP는 클릭 한 번.** 카탈로그에서 누르면 설치·인증·연결·헬스체크까지 끝.
5. **어떤 모델이든.** Anthropic 기본 + 유명 provider 프리셋 + OpenAI 호환 / Anthropic 호환 커스텀 엔드포인트.
6. **업무 도구 내장.** 문서·표·PDF·메일·캘린더·회의록·노트·할일·런처가 하네스 위에서 돈다.
7. **조용한 디자인.** `docs/DESIGN.md` 준수. 화이트 기본.

---

## Phase 0 — 기반 (이 저장소의 현재 상태 = 골격)

- [x] 모노레포 골격, 문서, 디자인 토큰, 앱 셸 목업, 사이트, 워크플로
- [x] `pnpm install` 후 `latest` 의존성을 설치된 버전(캐럿)으로 고정하고 lockfile 커밋
- [x] `pnpm typecheck` · `pnpm lint` · `pnpm test` 통과 (로컬 확인; CI 실행은 push 후 확인)
- [x] `pnpm dev` 로 Electron 창이 뜨고 UI가 보임 (main 프로세스 오류 없음 확인)
- [ ] GitHub 저장소 생성, Pages 소스를 "GitHub Actions"로 설정, 사이트 배포 확인
- [x] 폰트 번들(Pretendard Variable, JetBrains Mono) — `pretendard` / `@fontsource/jetbrains-mono` 패키지를 렌더러 번들에 포함(오프라인 동작)

**완료 기준:** 새 클론에서 `pnpm i && pnpm dev` 한 번으로 앱 실행, main 브랜치 푸시 시 사이트 자동 배포.

## Phase 1 — 에이전트 코어 (MVP)

- [ ] `core/providers`: Anthropic 어댑터 (스트리밍, adaptive thinking, effort, 서버 fallback, refusal/pause_turn/max_tokens 처리) — **서버 fallback(A-007)만 미구현**, 실제 API 키로는 아직 검증 못 함(가짜 SSE 서버로만 검증)
- [x] `core/providers`: **provider 레지스트리 + 프리셋 + 연결(connection) CRUD + 모델 목록 조회 + 능력 탐지** (`ARCHITECTURE.md §5-1`) — `ProviderHub`
- [x] `core/providers`: `openai`, `openai-compatible`, `anthropic-compatible` 어댑터 (변환기 포함); Bedrock(Mantle)·Vertex 는 Anthropic SDK 클라이언트, Gemini 는 OpenAI 호환 엔드포인트로 연결(미검증)
- [x] `core/agent/loop.ts`: 수동 루프 완성 — 병렬 툴 실행, 결과 묶음 반환, 중단(AbortSignal), 재시도(SDK 내장 재시도)
- [ ] `core/tools/builtin`: read, write, edit(문자열 치환), glob, grep, shell(PowerShell/bash), web_fetch, web_search(서버툴), todo — **web_search 만 미구현**
- [x] `core/permissions`: 모드 4종(ask / auto-edit / plan / yolo) + allow/deny 규칙 + 세션 단위 "항상 허용"
- [ ] `core/session`: SQLite 저장, 세션 목록/검색/이어하기/포크 — 파일 기반(JSON+JSONL) 저장으로 대체, 목록/이어하기 완료, **검색·포크 미구현**
- [x] 앱: 채팅 화면 실데이터 연결, 스트리밍 렌더(마크다운), 툴 호출 접기/펼치기, 권한 요청 인라인 카드(Enter=허용), Esc 중단
- [x] 앱: 설정 › 모델 — provider 로고 그리드, 연결 추가 시트(키·baseURL·모델 ID), 테스트 버튼(지연시간), 역할별 모델 지정
- [x] 비용/토큰 계산 및 표시 (provider별 단가 테이블, 캐시 적중 표시) — 계산·저장·`cost` 이벤트 완료(Anthropic 기본 3모델만 단가 있음), 표시는 인스펙터·턴 푸터에 완료

**완료 기준:** 폴더를 열고 "이 폴더의 md 파일을 요약해서 summary.md로 저장"을 Anthropic·OpenAI 호환(Ollama) 두 연결로 각각 성공. 쓰기 전 승인 카드가 뜬다.

## Phase 2 — 하네스 심화 (Claude Code 대비 우위 구간)

- [ ] 훅: `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStop, PreCompact` — 셸 명령 또는 JS 모듈, 차단/수정 가능 — **러너 완성(명령·JS 모듈·차단·수정·컨텍스트 주입). 루프가 발화하는 이벤트는 SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·Stop 5종**
- [ ] 스킬: `SKILL.md` 프런트매터 로딩, 점진적 공개, `/스킬명` 호출, 스킬 마켓(깃 URL 설치)
- [ ] 슬래시 명령: 내장 + 사용자 정의(`.easily/commands/*.md`)
- [ ] 서브에이전트: 정의 파일, 격리 컨텍스트, 병렬 실행, 모델/툴 제한, 결과 요약 반환
- [ ] 플랜 모드: 읽기 전용 탐색 → 계획 승인 → 실행, 계획을 체크리스트로 표시
- [ ] 체크포인트: 쓰기 툴 직전 섀도 git 스냅샷, **대화+파일 동시 되감기**, 특정 시점에서 분기 — **최소판만**: 쓰기 직전 파일 복사 + 파일 되감기(`rewind`). 섀도 git·대화 되감기·분기는 미구현
- [ ] 컨텍스트: 사용량 게이지, 자동 컴팩션(API compaction), 수동 `/compact`, 툴 결과 정리 — 게이지용 `cost` 이벤트(contextTokens)와 큰 툴 결과 파일 보관(H-021)만 완료
- [x] 메모리: 사용자/프로젝트/피드백/참조 4종, 1사실 1파일, 관련도 회수, `EASILY.md` 프로젝트 지침
- [ ] 백그라운드 작업: 장시간 셸 명령, 완료 알림, 출력 스트림 보기
- [ ] 병렬 세션 + git worktree 자동 생성
- [ ] 출력 스타일, 모델/effort 빠른 전환, 세션별 시스템 프롬프트 추가
- [x] 헤드리스 CLI `easily -p "..."` (JSON 출력, CI용)

**완료 기준:** `docs/benchmarks/`의 하네스 시나리오 20개(직접 작성) 중 18개 이상 무개입 성공. Claude Code와 같은 시나리오 비교표를 사이트에 게시.

## Phase 3 — 원클릭 MCP

- [ ] `mcp-catalog/catalog.json` 60+ 항목 (이름, 설명, 로고, 설치 방식 npx/uvx/docker/remote, 필요한 env, OAuth 여부)
- [x] 설치기: 런타임 감지(node/uv/docker) → 없으면 안내 or 내장 런타임 다운로드 → 설정 기록 → 연결 → `tools/list` 헬스체크 — 안내까지만(내장 런타임 다운로드 없음), 실패 시 전체 롤백. stdio·streamable HTTP 지원
- [ ] 원격 MCP OAuth (브라우저 열기 → `easily://oauth/callback` 딥링크 수신)
- [ ] 딥링크 `easily://mcp/install?id=...` — 사이트의 "Easily에 추가" 버튼 — **앱 쪽(설치 시트 열기)은 완료, 사이트 버튼 미구현**
- [ ] MCP 툴이 많을 때 툴 검색(지연 로딩)으로 컨텍스트 절약
- [ ] Claude Desktop / Claude Code / Cursor 의 기존 MCP 설정 가져오기
- [x] 서버별 on/off, 로그 보기, 재시작, 권한 규칙 — 권한은 `mcp__서버__툴` 글롭 규칙(settings.rules)

**완료 기준:** 깨끗한 Windows에서 GitHub·Slack·Notion·Filesystem MCP를 각각 클릭 1회 + 인증만으로 연결.

## Phase 4 — 예약 작업 & 자동화

- [x] 트레이 상주, 로그인 시 실행(설정, 기본 꺼짐), 창 닫아도 백그라운드 유지
- [ ] Job: cron 식 + 자연어("평일 9시") → cron 변환, 1회성 예약 — cron 식·1회성 완료, **자연어 변환 미구현**
- [ ] 트리거: 파일/폴더 변경, 앱 시작, 슬립 복귀, 로컬 웹훅(127.0.0.1), 이메일 수신(MCP 경유), 클립보드 패턴 — 앱 시작·슬립 복귀만
- [x] 놓친 실행 보충(슬립/종료 중이었던 작업), 동시 실행 제한, 재시도·백오프
- [x] 작업별 권한 프로필, 예산 상한(달러), 타임아웃 (토큰 상한은 없음)
- [x] 실행 기록 화면 (출력 요약, 비용, 변경 파일 수, 지금 실행, 세션 열기) — 예약 작업 화면에서 펼쳐 봄
- [ ] 결과 전달: OS 알림, 파일, 메일/슬랙(MCP), 앱 내 받은편지함 — OS 알림만
- [ ] 워크플로 빌더: 단계(프롬프트/툴/조건/반복/승인)를 연결한 파이프라인, 리스트 UI 우선(노드 그래프는 Phase 7)

**완료 기준:** "매일 08:30 받은 메일 요약 → 오늘 할 일 정리 → 알림" 작업이 노트북 덮었다 연 뒤에도 보충 실행됨.

## Phase 5 — 자기개선 엔진

`core/improve/` — 자세한 설계는 파일 상단 주석 참고.

- [ ] **Trace**: 모든 턴의 입력·툴 호출·결과·오류·사용자 수정·만족 신호(👍/👎, 되감기, 재시도)를 저장
- [ ] **Reflect**: 턴 종료 후 `fast` 모델이 "무엇이 비효율이었나 / 사용자가 고친 것은?"을 분석 → 교훈 후보
- [ ] **Memory 승격**: 반복 확인된 교훈만 메모리로 승격, 중복 병합, 오래된 사실 정리(주기 작업)
- [ ] **Skill 합성**: 같은 툴 시퀀스가 N회 성공 → 스킬 초안 자동 생성 제안
- [ ] **Prompt 진화**: 시스템 프롬프트·스킬·툴 설명의 패치 후보 생성
- [ ] **평가 게이트**: 골든 태스크 세트(사용자 실제 세션에서 추출 + 직접 추가) 재실행, `judge` 모델 채점, 기준선 대비 개선 시에만 채택 후보
- [ ] **개선안 화면**: diff, 점수 변화, 비용, 채택/거절/롤백. 자동 채택 토글(기본 끔)
- [ ] 버전 관리: 모든 프롬프트/스킬 변경은 버전으로 남고 1클릭 롤백
- [ ] 주간 리포트: 성공률, 평균 턴 수, 비용, 채택된 개선

**완료 기준:** 일부러 비효율적인 습관(예: 매번 전체 파일 읽기)을 가진 시나리오에서 1주 사용 후 평균 툴 호출 수가 측정 가능하게 감소.

## Phase 6 — 업무 기능

- [ ] 문서: DOCX/XLSX/PPTX/PDF 읽기·생성·편집 툴, 미리보기 패널
- [ ] 메일·캘린더·드라이브: Gmail/Outlook/Google Calendar MCP 프리셋 + 전용 화면(받은편지함 요약, 일정 브리핑)
- [ ] 회의: 시스템 오디오/마이크 녹음 → 전사 → 요약·액션아이템
- [ ] 노트 & 지식베이스: 로컬 폴더 인덱싱(임베딩), 질의, 출처 인용
- [ ] 할 일: 세션에서 생성된 할 일 통합, 마감 알림
- [ ] 퀵 런처: 전역 단축키(Alt+Space)로 어디서든 한 줄 지시
- [ ] 화면 캡처 → 질문, 클립보드 히스토리 → 변환
- [ ] 브라우저 자동화(Playwright) 툴, 컴퓨터 사용 툴(선택)
- [ ] 템플릿·프롬프트 라이브러리, 번역, 보고서 생성기

## Phase 7 — 출시 품질

- [ ] 자동 업데이트(electron-updater, GitHub Releases), 코드 서명(Win/macOS)
- [ ] 온보딩: 첫 실행 3단계(모델 연결 → MCP 추천 → 첫 작업)
- [ ] i18n: ko(기본), en
- [ ] 접근성: 키보드 전 기능, 스크린리더 레이블, 대비 AA
- [ ] 크래시 리포트·텔레메트리(옵트인, 로컬 우선)
- [ ] 팀 공유: `.easily/` 폴더를 git으로 공유(스킬·훅·명령·MCP 설정)
- [ ] 사이트: 문서 페이지, 변경 로그, 비교표, 다운로드 자동 링크(최신 릴리스)

---

## 작업 방식 (Sonnet용)

1. 한 번에 한 체크박스. 끝나면 테스트 → 커밋(`feat(core): ...` Conventional Commits).
2. 새 기능은 `site/data/features.js`의 해당 ID `status`를 `planned → building → done`으로 갱신.
3. 설계를 바꾸면 `docs/ARCHITECTURE.md`를 같은 커밋에서 갱신.
4. UI 작업 전 `docs/DESIGN.md` §2(금지 목록)를 다시 읽는다.
