# CLAUDE.md — Easily 작업 지침

이 저장소는 **Easily**: 업무 전용 데스크톱 에이전트 하네스다 (Electron + TypeScript 모노레포 + GitHub Pages 사이트).
지금은 **골격 단계**다. 구조와 인터페이스는 정해졌고, 대부분의 구현은 `TODO(P<n>)` 주석으로 비어 있다.

## 시작할 때 반드시 읽을 것 (이 순서로)

1. `docs/PLAN.md` — 무엇을 어떤 순서로 만드는가. **위에서부터 체크박스 하나씩.**
2. `docs/ARCHITECTURE.md` — 무엇을 어디에 두는가. 새 모듈은 여기서 자리를 찾는다.
3. `docs/DESIGN.md` — UI를 건드리기 전에. §2 "AI 슬롭 금지 목록"은 매번 다시 확인.
4. `site/data/features.js` — 기능 카탈로그(ID 체계). 커밋 메시지와 TODO에 기능 ID를 쓴다.

## 명령

```bash
pnpm i                 # 설치 (Node 22+, pnpm 9+)
pnpm dev               # 데스크톱 앱 개발 모드
pnpm typecheck         # 전 패키지 타입 체크
pnpm test              # vitest
pnpm lint
pnpm gen:features      # site/data/features.js → docs/FEATURES.md
pnpm site              # 사이트 로컬 미리보기 (http://localhost:4321)
```

## 절대 규칙

- **`packages/core`는 electron을 import하지 않는다.** CLI와 스케줄러 워커가 같은 코어를 쓴다.
- **렌더러는 Node에 직접 접근하지 않는다.** 새 IPC는 `apps/desktop/src/shared/ipc.ts`에 zod 스키마와 함께 선언 → preload → main 순서로 추가.
- **코어 메시지 형식은 Anthropic Messages 형식.** 다른 provider는 어댑터에서 변환한다. 별도의 메시지 타입을 만들지 말 것. SDK 타입(`Anthropic.MessageParam` 등)을 재정의하지 말 것.
- **히스토리는 append-only.** 이전 메시지·thinking 블록을 수정/삭제하지 않는다. 시스템 프롬프트·툴 목록은 결정적으로 정렬해서 프롬프트 캐시를 지킨다.
- **API 키는 safeStorage 금고에만.** 설정 파일·로그·트레이스·에러 메시지에 평문 키가 나오면 버그다.
- **모델 ID를 추측해서 하드코딩하지 않는다.** Anthropic 기본값(`claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5`)만 코드에 있고, 나머지는 각 연결의 models 엔드포인트에서 가져온다.
- **provider 프리셋은 `packages/core/src/providers/presets.ts` 한 곳.** 사이트의 로고 목록(`site/app.js`)도 같이 갱신.
- **MCP 카탈로그 항목은 직접 설치해 확인하기 전까지 `verified: false`.** 패키지명·URL을 추측으로 채우지 말 것.
- **디자인 토큰 밖의 색·반경·그림자를 쓰지 않는다.** 새 값이 필요하면 `tokens.css`와 `DESIGN.md`를 먼저 고친다. Tailwind·컴포넌트 키트 도입 금지.
- 아이콘은 `lucide-react` 1.5 stroke, provider 로고는 `ProviderLogo` 컴포넌트로만.

## Claude API 사용 (core/providers/anthropic.ts)

- 공식 `@anthropic-ai/sdk` 사용. 스트리밍 + `finalMessage()`.
- `thinking: { type: "adaptive" }` + `output_config.effort`. `budget_tokens`, `temperature` 등 샘플링 파라미터 사용 금지(최신 모델에서 400).
- 강제 `tool_choice`(`any`/`tool`) 사용 금지 — `auto` + 지시문 + `strict: true`.
- `stop_reason` 분기: `tool_use` / `pause_turn`(그대로 재전송) / `max_tokens` / `refusal`(`stop_details` 확인) / `end_turn`.
- 병렬 tool_use 결과는 **하나의 user 메시지**에 모아서 반환.
- 의심스러우면 추측하지 말고 공식 문서를 확인한다.

## 코드 스타일

- TypeScript strict, ESM, 2 spaces, Prettier 기본값.
- 파일 상단 주석은 "이 모듈이 무엇을 책임지는가"와 관련 기능 ID만. 줄 단위 주석은 *왜*가 필요할 때만.
- 외부 입력(IPC, 설정 파일, 툴 입력, MCP 응답)은 전부 zod로 검증.
- UI 문자열은 한국어(명사형 레이블). 나중에 i18n 키로 옮기기 쉽게 컴포넌트 상단에 모아 둔다.

## 작업 흐름

1. `docs/PLAN.md`에서 다음 미완료 체크박스를 고른다.
2. 관련 `TODO(P<n>)`를 grep으로 찾는다: `TODO\(P1` 등.
3. 구현 → 테스트 추가 → `pnpm typecheck && pnpm test` 통과.
4. `site/data/features.js`의 해당 기능 `status` 갱신 → `pnpm gen:features`.
5. 커밋: Conventional Commits + 기능 ID. 예) `feat(core): openai-compatible adapter (M-003)`
6. PLAN.md 체크박스 체크. 설계가 바뀌었으면 ARCHITECTURE.md도 같은 커밋에서 수정.

## 환경 메모 (Windows)

- 저장소 경로가 길면(260자 초과) esbuild·electron 의 `postinstall` 이 실패한다. 이 클론은 **커밋하지 않는** 루트 `.npmrc` 에 `virtual-store-dir=C:/ez/vs` 를 두고 설치했다(`.git/info/exclude` 로 제외). 짧은 경로에 클론했다면 필요 없다.
- `pnpm dev` 로 만든 프로필을 건드리지 않으려면 `EASILY_USER_DATA=<임시 폴더>` 로 실행한다.
- IPC 채널을 추가할 때: `shared/ipc.ts`(zod + 응답 타입) → `shared/channels.ts` → `main/handlers.ts`(누락 시 컴파일 오류). `ipc.test.ts` 가 두 목록의 일치를 검사한다.

## 하지 말 것

- 계획에 없는 대규모 리팩터링, 의존성 무단 추가(추가 시 PR 설명에 이유).
- UI에 이모지 아이콘, 그라데이션, 큰 그림자, 16px 이상 반경.
- 검증되지 않은 사실(가격, 모델명, 패키지명, URL)을 코드나 사이트에 적기.
