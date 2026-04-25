# 아키텍처

## 시스템 구성

```
[GitHub Actions - 매일 15:00 KST + main push 시]
        │
        ▼
scripts/generate_data.py
  ├── Blizzard 크롤링 (meta_scraper.py)
  ├── stadiumbuilds.io 크롤링 (stadium_scraper.py)
  ├── Blizzard 패치노트 크롤링 (patch_scraper.py)
  └── NVIDIA API 번역/요약 (translator.py + glossary.py)
        │
        ▼
public/data/*.json  ──→  git commit & push
        │
        ▼
GitHub Pages (Actions 기반 배포)
https://russel0719.github.io/ow-agent/
        │
        ▼
[사용자 브라우저]
public/index.html + app.js + views/
  ├── 홈 대시보드 (home.js) — AI 요약, TOP3, 초상화 버블 차트
  ├── 메타 통계 (meta.js) — 패치 날짜 세로선 포함
  ├── 스타디움 빌드 (stadium.js)
  ├── 패치노트 (patch.js)
  └── AI 챗봇 (chat.js)
        │
        ▼ (홈 AI 요약 / 챗봇 질문)
Cloudflare Worker (worker.js)
  ├── GET: 남은 횟수 조회
  ├── KV: 전체 일일 20회 제한 (ow:chat:YYYY-MM-DD)
  └── NVIDIA API → Kimi K2 Instruct
        │ 응답 + X-Remaining-Count 헤더
        ▼
[브라우저: 남은 횟수 UI 업데이트]
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 (데이터 수집) | Python 3.11, aiohttp, BeautifulSoup4, uv |
| 번역·요약 | NVIDIA API (Kimi K2 Instruct) |
| 챗봇 AI | NVIDIA API (Kimi K2 Instruct) |
| 프론트엔드 | Vanilla JS (ES Modules), Chart.js, Tailwind CSS |
| 챗봇 프록시 | Cloudflare Worker + KV |
| 배포 | GitHub Pages + GitHub Actions (Actions 기반 배포) |

## 주요 파일 역할

| 파일 | 역할 |
|------|------|
| `scripts/generate_data.py` | Actions 진입점. 크롤링→번역→JSON 저장 전체 조율 |
| `bot/utils/scrapers/meta_scraper.py` | Blizzard 공식 통계 크롤러 |
| `bot/utils/scrapers/stadium_scraper.py` | stadiumbuilds.io 빌드 크롤러 |
| `bot/utils/scrapers/patch_scraper.py` | Blizzard 패치노트 크롤러 (ko-kr) |
| `bot/utils/translator.py` | NVIDIA API 배치 번역·요약 (캐시 포함) |
| `bot/utils/glossary.py` | 용어집 로더. glossary.json + heroes.json aliases 통합 조회 |
| `bot/utils/hero_data.py` | 영웅 DB 관리 (신규 영웅 자동 감지) |
| `data/heroes.json` | 영웅 DB (카운터, 시너지, 팁, aliases) — 매일 자동 갱신 |
| `data/ow_glossary.json` | 번역 용어집 (공통 + 영웅별 스킬명) — 수동 관리 |
| `public/app.js` | SPA 라우터 + `loadJSON()` + `WORKER_URL` / `getPortraitIndex()` export |
| `public/views/home.js` | 홈 대시보드 (AI 요약, 꿀/똥 TOP3, 초상화 버블 차트) |
| `cloudflare-worker/worker.js` | CORS 프록시 + KV 일일 제한 + GET 남은 횟수 조회 |

## 데이터 흐름

### 패치노트 번역

```
크롤링 (ko-kr URL → 영어 or 한국어)
    │
    ▼
제목 한국어 판단 (_has_korean(title))
    │
    ├─ 한국어 (공식) ──→ translation_source: "official"
    │   └─ 영어 영웅명만 있으면 glossary/heroes.json으로 변환
    │
    └─ 영어 (패치 초기) ──→ LLM 번역
        ├─ 영웅명: glossary → heroes.json aliases 순 조회 후 한국어 치환
        ├─ 변경사항: 이미 한국어인 항목 건너뛰고 영어만 번역
        └─ translation_source: "llm"

다음 실행 시: "llm" → "official" 자동 교체 (공식 한국어 올라오면)
```

### 영웅명 조회 (`glossary.py`)

```
_name_to_id() 테이블 빌드
    ├─ glossary.json name 필드 (수동, 우선)
    └─ heroes.json aliases (자동 갱신, 신규 영웅 보완)

→ 신규 영웅이 heroes.json에 추가되면 즉시 번역 파이프라인에서 인식
```

## 생성되는 JSON 파일

| 파일 | 내용 | 갱신 주기 |
|------|------|-----------|
| `meta.json` | 9개 랭크 × 영웅별 픽률·승률·티어 | 매일 |
| `meta_history.json` | 90일 rolling 히스토리 | 매일 |
| `map_meta.json` | 맵별 메타 통계 | 매일 |
| `map_meta_history.json` | 14일 맵 히스토리 | 매일 |
| `stadium.json` | 영웅별 스타디움 빌드 (번역+요약) | 매일 |
| `patch.json` | 최근 패치노트 + `translation_source` 필드 | 매일 |
| `heroes.json` | 영웅 DB 복사본 | 매일 |
| `last_updated.json` | 갱신 타임스탬프 | 매일 |
