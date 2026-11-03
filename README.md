# Easily

**맡기면 끝나 있는 업무.** 컴퓨터에 상주하는 업무용 에이전트 하네스.

- **하네스** — 권한 모드, 훅, 스킬, 서브에이전트, 체크포인트(대화+파일 되감기), 컨텍스트 관리
- **자기개선** — 실행 기록 → 반성 → 메모리·스킬·프롬프트 개선안 → 평가 게이트 → 채택/롤백
- **예약** — 트레이 상주, cron·자연어 일정·파일·웹훅 트리거, 놓친 실행 보충
- **원클릭 MCP** — 카탈로그에서 누르면 설치·인증·연결·헬스체크까지
- **모든 모델** — Anthropic 기본, 주요 provider 프리셋 + **OpenAI 호환 API** · **Anthropic 호환 API**
- **업무 기능** — 문서·표·PDF, 메일·일정, 회의록, 지식베이스, 퀵 런처 …

> 상태: 골격 단계. 구현 계획은 [docs/PLAN.md](docs/PLAN.md).

## 구조

```
apps/desktop        Electron 앱 (React, CSS Modules)
packages/core       하네스 엔진 (Electron 비의존)
packages/mcp-catalog  원클릭 MCP 카탈로그 + 설치기
packages/cli        헤드리스 CLI
site/               공식 웹사이트 (GitHub Pages, 빌드 없음)
docs/               PLAN · ARCHITECTURE · DESIGN · FEATURES
```

## 개발

```bash
pnpm i
pnpm dev
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Phase 0–7 구현 계획과 완료 기준 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 구조, 기술 스택, 에이전트 루프, provider 설계 |
| [docs/DESIGN.md](docs/DESIGN.md) | 디자인 시스템, 토큰, 금지 목록 |
| [site/data/features.js](site/data/features.js) | 기능 카탈로그 (단일 진실 원천) |
| [CLAUDE.md](CLAUDE.md) | AI 코딩 에이전트용 작업 지침 |

## 배포

- 사이트: https://purplemacaron.github.io/easily/ — `main`에 `site/` 변경이 push되면 자동 배포
- 릴리스: `git tag v0.1.0 && git push --tags` → 3개 OS 설치 파일이 Releases에 올라감
