# 아키텍처

## 시스템 구성

```
[GitHub Actions - 매일 15:00 KST]
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
GitHub Pages (Actions 배포)
https://russel0719.github.io/ow-agent/
        │
        ▼
[사용자 브라우저]
public/index.html + app.js + views/
  ├── 메타 통계 (meta.js)
  ├── 스타디움 빌드 (stadium.js)
  ├── 패치노트 (patch.js)
  └── AI 챗봇 (chat.js)
        │
        ▼ (챗봇 질문)
Cloudflare Worker (worker.js)
  ├── KV: 일일 20회 전체 제한
  └── NVIDIA API → Kimi K2 Instruct
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 백엔드 (데이터 수집) | Python 3.11, aiohttp, BeautifulSoup4, uv |
| 번역·요약 | Google Gemini API (`gemini-2.0-flash-lite`) |
| 챗봇 AI | NVIDIA API (Kimi K2 Instruct) |
| 프론트엔드 | Vanilla JS (ES Modules), Chart.js, Tailwind CSS |
| 챗봇 프록시 | Cloudflare Worker + KV |
| 배포 | GitHub Pages + GitHub Actions |

## 주요 파일 역할

| 파일 | 역할 |
|------|------|
| `scripts/generate_data.py` | Actions 진입점. 크롤링→번역→JSON 저장 전체 조율 |
| `bot/utils/scrapers/meta_scraper.py` | Blizzard 공식 통계 크롤러 |
| `bot/utils/scrapers/stadium_scraper.py` | stadiumbuilds.io 빌드 크롤러 |
| `bot/utils/scrapers/patch_scraper.py` | Blizzard 패치노트 크롤러 (ko-kr) |
| `bot/utils/translator.py` | NVIDIA API 배치 번역·요약 (캐시 포함) |
| `bot/utils/glossary.py` | 용어집 로더 (EN/KR 이름 양방향 조회) |
| `bot/utils/hero_data.py` | 영웅 DB 관리 (신규 영웅 자동 감지) |
| `data/heroes.json` | 영웅 DB (카운터, 시너지, 팁, aliases) |
| `data/ow_glossary.json` | 번역 용어집 (공통 + 영웅별 스킬명) |
| `public/app.js` | SPA 라우터 + `loadJSON()` 유틸 |
| `cloudflare-worker/worker.js` | CORS 프록시 + KV 일일 제한 |

## 데이터 흐름

```
크롤링 (영어/한국어 혼합)
    │
    ▼
번역 필요 여부 판단 (_has_korean())
    │
    ├─ 이미 한국어 → 건너뜀
    └─ 영어 → NVIDIA API + 용어집 적용
        │
        ▼
public/data/*.json 저장
    │
    ▼
브라우저 fetch() → 화면 렌더링
```

## 생성되는 JSON 파일

| 파일 | 내용 | 갱신 주기 |
|------|------|-----------|
| `meta.json` | 9개 랭크 × 영웅별 픽률·승률·티어 | 매일 |
| `meta_history.json` | 90일 rolling 히스토리 | 매일 |
| `map_meta.json` | 맵별 메타 통계 | 매일 |
| `map_meta_history.json` | 14일 맵 히스토리 | 매일 |
| `stadium.json` | 영웅별 스타디움 빌드 (번역+요약) | 매일 |
| `patch.json` | 최근 패치노트 (번역) | 매일 |
| `heroes.json` | 영웅 DB 복사본 | 매일 |
| `last_updated.json` | 갱신 타임스탬프 | 매일 |
