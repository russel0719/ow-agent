# CLAUDE.md

오버워치 2 메타 대시보드. Blizzard 공식 통계를 매일 크롤링하고 번역해 GitHub Pages로 서빙하는 정적 웹앱.

**라이브**: https://russel0719.github.io/ow-agent/

## 핵심 명령어

```bash
# 의존성 설치
uv sync

# 데이터 생성 (public/data/ 하위 JSON 전체 갱신)
uv run python scripts/generate_data.py

# 로컬 서버 실행
python -m http.server 8080 --directory public
# → http://localhost:8080
```

## 프로젝트 구조

| 경로 | 설명 |
|------|------|
| `public/` | GitHub Pages 서빙 루트 (웹 앱 정적 파일) |
| `public/data/` | 자동 생성 JSON (GitHub Actions가 매일 커밋) |
| `public/views/` | 뷰 컴포넌트 (meta, stadium, patch, chat) |
| `bot/utils/` | 크롤러, 번역기, 용어집 유틸리티 |
| `scripts/generate_data.py` | 전체 데이터 생성 스크립트 (Actions 진입점) |
| `data/heroes.json` | 영웅 DB — 카운터·시너지·팁 (수동 관리) |
| `data/ow_glossary.json` | 번역 용어집 — 영웅명·스킬명 (수동 관리) |
| `cloudflare-worker/worker.js` | 챗봇 AI 프록시 (NVIDIA API + KV 일일 제한) |
| `.github/workflows/update-data.yml` | 매일 15:00 KST 자동 갱신 + Pages 배포 |

## 환경변수

| 변수 | 필수 | 용도 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | 번역·요약 (Google Gemini) |
| `NVIDIA_API_KEY` | ✅ | 챗봇 AI (Kimi K2) + 로컬 번역 |

GitHub Actions: **Settings → Secrets** 에 등록.
로컬 개발: `.env` 파일에 설정 (`.env.example` 참고).

## 세부 문서

- [아키텍처](docs/architecture.md) — 시스템 구성, 기술 스택, 데이터 흐름
- [데이터 파이프라인](docs/data-pipeline.md) — 크롤러, 번역, 새 영웅 추가 방법
- [프론트엔드](docs/frontend.md) — 라우팅, 뷰 컴포넌트, 로컬 개발
- [챗봇 / Cloudflare](docs/chatbot.md) — Worker 배포, KV 제한 설정
