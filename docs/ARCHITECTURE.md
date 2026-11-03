# Easily — 아키텍처

> 이 문서는 "어디에 무엇을 넣는가"의 기준이다. 새 모듈을 만들기 전에 반드시 여기서 자리를 찾고, 없으면 이 문서를 먼저 고친다.

## 1. 한 줄 요약

**Easily = 로컬 우선(local-first) 데스크톱 에이전트 하네스.**
Electron 셸 위에, Electron에 의존하지 않는 순수 TypeScript 하네스 엔진(`@easily/core`)이 돌고,
같은 엔진을 CLI(`easily`)와 스케줄러 워커가 공유한다.

```
┌──────────────────────────── apps/desktop (Electron) ────────────────────────────┐
│  Renderer (React)            Preload (contextBridge)       Main process          │
│  ─ 세션/채팅 UI               ─ window.easily.* 타입 API      ─ IPC 라우터            │
│  ─ 커맨드 팔레트              ─ 이벤트 구독                   ─ Tray / 로그인 시 실행    │
│  ─ MCP 스토어 / 스케줄 / ...                                  ─ Scheduler (croner)    │
│                                                             ─ Deep link easily://   │
│                                                             ─ safeStorage (비밀값)   │
│                                     │                                            │
│                                     ▼                                            │
│                       ┌──────── @easily/core ────────┐                           │
│                       │ Agent loop · Providers       │ ◄── packages/cli 도 동일 사용 │
│                       │ Tools · Permissions · Hooks  │                           │
│                       │ Skills · Subagents · Memory  │                           │
│                       │ Context(compaction) · Store  │                           │
│                       │ Checkpoints · Improve(자기개선)│                           │
│                       │ MCP client manager           │                           │
│                       └──────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────────────┘
          │ stdio / streamable HTTP                     │ HTTPS
          ▼                                             ▼
   MCP 서버들 (catalog에서 원클릭 설치)              Anthropic API (기본) / 기타 provider
```

## 2. 저장소 구조

```
easily/
├─ apps/
│  └─ desktop/                 Electron 앱 (electron-vite + React + TS)
│     ├─ src/main/             메인 프로세스: 창, 트레이, IPC, 스케줄러, 딥링크, 업데이트
│     ├─ src/preload/          contextBridge — 렌더러에 노출되는 유일한 API
│     └─ src/renderer/         React UI (디자인 토큰은 styles/tokens.css 단 하나)
├─ packages/
│  ├─ core/                    @easily/core — 하네스 엔진 (Electron import 금지)
│  ├─ mcp-catalog/             @easily/mcp-catalog — 원클릭 MCP 카탈로그 + 설치기
│  └─ cli/                     @easily/cli — 헤드리스 실행, 스케줄 워커, CI용
├─ site/                       GitHub Pages 공식 웹사이트 (빌드 없는 정적 HTML/CSS/JS)
│  └─ data/features.js         ★ 기능 목록의 단일 진실 원천 (사이트와 FEATURES.md 공용)
├─ docs/                       설계 문서 (이 파일, PLAN, DESIGN, FEATURES)
├─ scripts/                    개발 스크립트 (gen-features-md.mjs 등)
└─ .github/workflows/          ci.yml · pages.yml · release.yml
```

## 3. 기술 스택 (결정됨 — 바꾸려면 PR에 근거를 남길 것)

| 영역 | 선택 | 이유 |
|---|---|---|
| 셸 | **Electron** + electron-vite | MCP SDK·child_process·node 생태계를 그대로 사용. 트레이/로그인 실행/powerMonitor 기본 제공 |
| UI | React 18 + TypeScript, **CSS Modules + CSS 변수** | Tailwind/컴포넌트 키트 금지 — 기본값 미감(=AI 슬롭) 차단 |
| 상태 | Zustand (renderer), core는 순수 이벤트 이미터 | 단순 |
| 저장소 | SQLite (`better-sqlite3`) + Drizzle ORM, 파일은 `userData/` | 로컬 우선, 동기식이라 하네스 루프에 적합 |
| LLM | `@anthropic-ai/sdk` (기본 `claude-opus-5-5`), provider 인터페이스로 확장 | 하네스 품질은 모델 품질 |
| MCP | `@modelcontextprotocol/sdk` client (stdio + streamable HTTP + OAuth) | 표준 |
| 스케줄 | `croner` + Electron `powerMonitor` | 순수 JS, 슬립 복귀 시 놓친 작업 보충 실행 |
| 비밀값 | Electron `safeStorage` (OS 키체인 암호화) | API 키 평문 저장 금지 |
| 검증 | `zod` | 툴 입력, IPC 페이로드, 설정 파일 전부 |
| 테스트 | Vitest (core), Playwright (Electron e2e) | |
| 패키징 | electron-builder → GitHub Releases, electron-updater 자동 업데이트 | |
| 패키지 매니저 | pnpm workspaces | |

## 4. 핵심 개념 (core 도메인 모델)

| 개념 | 설명 | 위치 |
|---|---|---|
| **Session** | 대화 1개. 메시지·툴 호출·체크포인트·비용을 가진다 | `core/src/session` |
| **Turn** | 사용자 입력 1회 → 루프가 끝날 때까지 | `core/src/agent/loop.ts` |
| **Provider** | LLM 호출 추상화. `stream(request) → events` | `core/src/providers` |
| **Tool** | zod 스키마 + `run()` + 권한 등급(`read`/`write`/`exec`/`network`) | `core/src/tools` |
| **Permission** | 모드(ask / auto-edit / plan / yolo) + 규칙(allow/deny glob) | `core/src/permissions` |
| **Hook** | 라이프사이클 이벤트에 붙는 사용자 스크립트/JS 함수 | `core/src/hooks` |
| **Skill** | `SKILL.md` + 리소스 폴더. 필요할 때만 로드 (점진적 공개) | `core/src/skills` |
| **Subagent** | 격리 컨텍스트로 위임 실행, 결과 요약만 돌려받음 | `core/src/agent/subagent.ts` |
| **Memory** | 사용자/프로젝트/피드백 사실을 파일 단위로 저장, 관련도 검색 | `core/src/memory` |
| **Checkpoint** | 파일 변경 전 스냅샷(섀도 git), 대화+파일 동시 되감기 | `core/src/checkpoints` |
| **Job** | 스케줄된 작업 정의 (cron/트리거 + 프롬프트 + 권한 프로필) | `core/src/scheduler` |
| **Trace** | 모든 턴의 구조화 로그 — 자기개선의 원재료 | `core/src/improve/trace.ts` |
| **Improvement** | 자기개선 제안(메모리/스킬/프롬프트 패치) + 평가 결과 + 채택 여부 | `core/src/improve` |

## 5. 에이전트 루프 (요약)

```
user input
  → hooks.UserPromptSubmit
  → context.build()        system(고정, 캐시) + memory 회수 + skills 목록 + 툴 정의
  → provider.stream()      adaptive thinking, effort, 스트리밍, eager_input_streaming
  → stop_reason 분기
       tool_use   → 각 tool: zod 검증 → permissions.check → hooks.PreToolUse
                    → checkpoint(쓰기 툴이면) → run (병렬 가능한 것은 병렬)
                    → hooks.PostToolUse → tool_result 를 한 user 메시지로 모아 append
       pause_turn → assistant 내용 append 후 재호출
       max_tokens → 이어쓰기 or 사용자에게 알림
       refusal    → 서버 fallback 결과 확인, 없으면 UI에 사유 표시
       end_turn   → hooks.Stop → trace 저장 → improve.reflect() (비동기, 저비용 모델)
  → context.maybeCompact() 토큰 임계치 초과 시
```

규칙:
- **append-only 히스토리.** 이전 메시지/thinking 블록을 절대 수정·삭제하지 않는다(preserved thinking 규칙). 컴팩션은 API compaction 블록 또는 새 세션 분기로 처리.
- 시스템 프롬프트·툴 목록은 **결정적 정렬**로 프롬프트 캐시를 보존. 시간/날짜 같은 변동값은 마지막 캐시 지점 뒤에.
- 병렬 tool_use의 결과는 **하나의 user 메시지**로 묶어서 돌려준다.

## 5-1. 모델 Provider (멀티 API 키)

provider는 **"종류(kind)" × "인스턴스(connection)"** 구조다. 종류는 코드로 구현된 어댑터 6개뿐이고,
나머지 유명 서비스는 전부 그 어댑터 위의 **프리셋**(기본 baseURL + 로고 + 키 발급 링크)이다.
사용자는 같은 종류의 연결을 여러 개 만들 수 있다 (예: 회사 프록시용 Anthropic 호환 2개).

| kind (어댑터) | SDK | 프리셋 |
|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` | Anthropic (기본, `claude-opus-5-5`) |
| `anthropic-compatible` ★ | `@anthropic-ai/sdk` + 사용자 `baseURL` | **커스텀 Anthropic 호환 API**, Moonshot(Kimi)·Zhipu(GLM)·DeepSeek 의 Anthropic 엔드포인트, 사내 프록시 |
| `openai` | `openai` | OpenAI, Azure OpenAI |
| `openai-compatible` ★ | `openai` + 사용자 `baseURL` | **커스텀 OpenAI 호환 API**, OpenRouter, Groq, Together, Fireworks, Mistral, xAI, DeepSeek, Perplexity, Qwen(DashScope), Ollama, LM Studio, vLLM |
| `gemini` | `@google/genai` | Google Gemini |
| `bedrock` / `vertex` | `@anthropic-ai/bedrock-sdk`(Mantle) / `@anthropic-ai/vertex-sdk` | AWS Bedrock, Google Vertex AI 의 Claude |

규칙:
- 프리셋 목록은 `packages/core/src/providers/presets.ts` 한 곳. 각 항목은 `id, name, kind, baseURL, logo, keyUrl, docsUrl`.
- **모델 ID는 하드코딩하지 않는다** (Anthropic 기본값 제외). 연결 생성 시 `/v1/models`(또는 각 SDK의 models.list)를 호출해 목록을 받아 캐시하고, 실패하면 사용자가 직접 입력.
- 호환 API 연결은 생성 시 **능력 탐지(capability probe)** 를 한다: 스트리밍, 툴 호출, 병렬 툴, 이미지 입력, thinking 지원 여부를 짧은 테스트 요청으로 확인해 `capabilities`에 저장 → 루프가 그에 맞춰 요청을 만든다 (예: 툴 미지원이면 툴 없이 텍스트 모드).
- core 내부 메시지 포맷은 Anthropic Messages 형식이 기준. 다른 kind 어댑터는 입출력을 이 형식으로 변환한다 (`providers/translate/openai.ts`, `gemini.ts`).
- 라우팅: 역할별 모델 지정 — `main`(대화), `fast`(요약·반성·분류), `subagent`, `judge`(자기개선 평가). 각각 다른 연결을 고를 수 있다. 실패 시 폴백 체인.
- 키는 연결별로 safeStorage에 저장. UI에는 끝 4자리만 표시.

### 로고
- 앱: `@lobehub/icons` (React, 단색/컬러 provider 로고 세트)를 사용하고 `logo` 필드에 그 슬러그를 넣는다. 커스텀 호환 연결은 자체 아이콘(`OpenAI 호환` = 꺾쇠 플러그, `Anthropic 호환` = 동일 형태 다른 글리프)을 `apps/desktop/src/renderer/src/assets/providers/`에 둔다.
- 사이트: 같은 슬러그의 정적 SVG(`@lobehub/icons-static-svg`, jsDelivr)를 **회색조**로 표시 — 로고 벽이 사이트를 지배하지 않게.
- 로고는 각 회사의 상표다. "지원 provider 표시" 용도로만 쓰고, 색·비율을 변형하지 않는다.

## 6. 프로세스 & IPC 규칙

- 렌더러는 Node/파일시스템에 직접 접근하지 않는다. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- 모든 IPC 채널은 `apps/desktop/src/shared/ipc.ts` 한 곳에 **이름 + zod 스키마**로 선언한다. preload는 그 목록만 노출.
- core 이벤트(`text_delta`, `tool_start`, `tool_end`, `permission_request`, `cost`, ...)는 main이 구독 → `webContents.send('session:event', ...)`로 전달.
- 장시간 작업(스케줄, 서브에이전트)은 main의 `utilityProcess`에서 실행해 UI 프리즈 방지.

## 7. 데이터 위치

```
%APPDATA%/Easily/  (macOS: ~/Library/Application Support/Easily)
├─ easily.db                 세션, 메시지, 잡, 실행기록, 트레이스, 개선안
├─ settings.json             사용자 설정 (zod 스키마로 마이그레이션)
├─ secrets.bin               safeStorage로 암호화된 키
├─ memory/                   메모리 파일 (MEMORY.md 인덱스 + 1사실 1파일)
├─ skills/                   사용자 스킬 (자기개선이 만든 스킬 포함, 버전 관리됨)
├─ checkpoints/<session>/    섀도 git 저장소
└─ logs/
```
프로젝트 단위 설정은 작업 폴더의 `.easily/` (settings, skills, hooks, EASILY.md).

## 8. 보안 원칙

1. 비밀값은 safeStorage 밖으로 평문 저장 금지. 로그·트레이스에서 자동 마스킹.
2. 툴 실행은 권한 등급 + 규칙 + 모드로 3중 체크. 기본 모드는 `ask`.
3. 웹페이지/파일/MCP 응답 속 지시문은 **데이터**로 취급(프롬프트 인젝션 방어 시스템 프롬프트 + 툴 결과 태깅).
4. 자기개선이 만든 변경은 항상 **diff + 평가 점수**와 함께 제안되고, 자동 채택은 사용자가 켠 경우에만.
5. 스케줄 작업은 별도 권한 프로필(기본: 읽기 전용 + 지정 폴더 쓰기)로 실행.
