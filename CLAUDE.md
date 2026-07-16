# CLAUDE.md

오버워치 2 메타 대시보드. Blizzard 공식 통계를 매일 크롤링하고 번역해 정적 웹앱으로 서빙한다.

- **라이브(정식)**: https://russel0719.github.io/ow-agent/ — canonical·sitemap 기준 주소
- **미러**: https://ow-agent.vercel.app — 같은 산출물, 짧은 링크용. canonical은 github.io를 가리키므로 검색 색인은 정식 주소로 통합된다

두 호스팅 모두 Actions가 매일 생성한 동일한 `public/`을 받는다 — Pages는 아티팩트로, Vercel은 CLI 업로드로. 커밋된 파일을 서빙하는 게 아니므로 일일 커밋 없이도 최신이 유지된다.

## 핵심 명령어

```bash
# 의존성 설치
uv sync

# 데이터 생성 (Supabase ow_agent 저장 + 로컬 JSON 산출. 자격증명 없으면 로컬 폴백)
uv run python scripts/generate_data.py

# 페이지 생성 (SEO 메타·정적 콘텐츠·meta.html·sitemap 갱신 — 데이터 생성 후 실행)
uv run python scripts/generate_pages.py

# (최초 1회) 기존 public/data 히스토리를 Supabase로 백필 — 자격증명 필요
uv run python scripts/backfill_supabase.py

# 로컬 서버 실행
python -m http.server 8080 --directory public
# → http://localhost:8080
```

## 프로젝트 구조

| 경로 | 설명 |
|------|------|
| `public/` | 서빙 루트 (웹 앱 정적 파일) — Pages·Vercel 양쪽이 이 디렉토리를 그대로 받는다 |
| `public/data/` | `heroes.json`·`maps.json`만 커밋. 매일 갱신 데이터는 Supabase(gitignore·CI 로컬 산출물) |
| `public/views/` | 뷰 컴포넌트 (home, meta, analysis, divergence, stadium, patch) |
| `bot/utils/` | 크롤러, 번역기, 용어집 유틸리티 |
| `bot/utils/supabase_sync.py` | Supabase(ow_agent) read/write 래퍼 (자격증명 없으면 로컬 폴백) |
| `scripts/generate_data.py` | 전체 데이터 생성 + Supabase upsert (Actions 진입점) |
| `scripts/generate_pages.py` | SEO 메타·정적 콘텐츠·sitemap 생성기 (데이터 생성 후 실행) |
| `scripts/backfill_supabase.py` | 기존 히스토리를 Supabase로 1회 이관 (수동) |
| `supabase/` | Supabase CLI 설정·마이그레이션 (`migrations/`, `config.toml`) |
| `data/heroes.json` | 영웅 DB — 카운터·시너지·팁 (수동 관리) |
| `data/ow_glossary.json` | 번역 용어집 — 영웅명·스킬명 (수동 관리) |
| `data/site_config.json` | 사이트 설정 — 도메인·Supabase URL/anon 키·GA4·AdSense/AdFit ID (수동 관리, 값 채우면 생성기가 활성화) |
| `public/index.html` | 진입점 — `==SEO==`/`==STATIC==`/`==ADFIT==` 마커 블록은 생성기가 관리 (직접 수정 금지) |
| `public/meta.html` | 랭크별 티어표 정적 페이지 (전체 자동 생성 — 직접 수정 금지) |
| `public/privacy.html` | 개인정보처리방침 (수동 관리) |
| `public/views/analysis.js` | 메타 분석 탭 — 통합 지수·존재감·밴 효율 시각화 |
| `cloudflare-worker-api/` | 외부 공개 REST API (`/v1/*`, wrangler 기반 Cloudflare Worker) |
| `vercel.json` | Vercel Git 연동 배포 비활성화 (`git.deploymentEnabled: false`). 배포는 Actions의 CLI 업로드로만 — 아래 주의 참고 |
| `.github/workflows/update-data.yml` | 매일 15:00 KST 자동 갱신 + Pages 배포 + Vercel 배포 |
| `.github/workflows/deploy-api-worker.yml` | `cloudflare-worker-api/**` 변경 시 자동 `wrangler deploy` |

> **Vercel Git 연동을 켜지 말 것.** 매일 재생성되는 `meta.html`·`hero/*.html`·`sitemap.xml`은 커밋하지 않으므로, Git 연동으로 배포하면 이 SEO 페이지들이 마지막 커밋 시점 데이터로 굳는다. 또 repo 루트의 `pyproject.toml` 때문에 Vercel이 Python 앱으로 오탐해 빌드가 깨진다. 두 문제 모두 Actions에서 `--prebuilt`로 `public/`을 직접 업로드해 회피한다.

## 환경변수

| 변수 | 필수 | 용도 |
|------|------|------|
| `CEREBRAS_API_KEY` | ✅ | 번역·요약 (gpt-oss-120b, `scripts/generate_data.py` → `bot/utils/translator.py`) |
| `SUPABASE_URL` | ✅(CI) | 매일 갱신 데이터 저장 대상 (Supabase 프로젝트 URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅(CI) | Supabase 쓰기 (RLS 우회, Actions·백필 전용 — 클라이언트 노출 금지) |
| `SUPABASE_ANON_KEY` | ✅(읽기) | 브라우저·워커 읽기 키(공개). 브라우저는 `data/site_config.json`, 워커는 `cloudflare-worker-api/wrangler.toml`의 `[vars]` |
| `CLOUDFLARE_API_TOKEN` | ✅ | `cloudflare-worker-api/` 자동 배포 (GitHub Actions 전용) |
| `VERCEL_TOKEN` | ⬜ | Vercel 미러 배포 (GitHub Actions 전용). **미설정 시 Vercel 배포 스텝만 건너뛰고 Pages는 정상 배포** |
| `VERCEL_ORG_ID` | ⬜ | Vercel 배포 대상 팀/계정 ID (`.vercel/project.json`의 `orgId`) |
| `VERCEL_PROJECT_ID` | ⬜ | Vercel 배포 대상 프로젝트 ID (`.vercel/project.json`의 `projectId`) |

GitHub Actions: **Settings → Secrets** 에 등록.
로컬 개발: `.env` 파일에 설정 (`.env.example` 참고). Supabase 자격증명이 없으면 로컬 JSON 폴백으로 동작한다.

이관 활성화 순서는 `~/.claude/docs/projects/ow-agent.md`의 "이관 활성화 순서" 참고.

## 세부 문서

- [아키텍처](docs/architecture.md) — 시스템 구성, 기술 스택, 데이터 흐름
- [데이터 파이프라인](docs/data-pipeline.md) — 크롤러, 번역, 새 영웅 추가 방법
- [프론트엔드](docs/frontend.md) — 라우팅, 뷰 컴포넌트, 로컬 개발
- [외부 공개 API](docs/api.md) — `/v1/*` 엔드포인트 레퍼런스, Worker 배포
- [수익화 가이드](docs/monetization.md) — AdSense/AdFit/GA4/Search Console 체크리스트, 법적 리스크, site_config.json 사용법
