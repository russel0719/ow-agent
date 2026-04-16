# OW2 메타 대시보드

오버워치 2 공식 통계 기반 메타 대시보드. GitHub Pages로 서빙되며 매일 자동 갱신됩니다.

**[→ 대시보드 보기](https://russel0719.github.io/ow-agent/)**

---

## 주요 기능

| 탭 | 내용 |
|----|------|
| **메타** | 9개 랭크(전체 ~ 챔피언)별 영웅 픽률·승률·메타 점수, 티어 분류, 90일 히스토리 차트 |
| **스타디움** | 역할군별 영웅 빌드 목록 (빌드 코드 클릭 → 클립보드 복사), 한국어 요약 설명 |
| **패치 노트** | 최신 패치의 영웅별·공통 변경사항 한국어 번역 |

---

## 데이터 자동 갱신

GitHub Actions가 **매일 오후 3시 KST (06:00 UTC)** 에 자동으로 실행됩니다.

```
.github/workflows/update-data.yml
cron: '0 6 * * *'   # 매일 15:00 KST
```

실행 순서:
1. Blizzard 공식 통계 (`overwatch.blizzard.com/ko-kr/rates/`) 크롤링 → `docs/data/meta.json`
2. 90일 히스토리 롤링 갱신 → `docs/data/meta_history.json`
3. **신규 영웅 자동 감지** → `data/heroes.json` 자동 추가
4. stadiumbuilds.io 빌드 크롤링 + Gemini 한국어 번역/요약 → `docs/data/stadium.json`
5. Blizzard 패치 노트 크롤링 + Gemini 한국어 번역 → `docs/data/patch.json`
6. `data/heroes.json` → `docs/data/heroes.json` 복사
7. `docs/data/` 커밋 & push → GitHub Pages 자동 배포

수동 실행: GitHub Actions 탭 → **Update OW Data** → **Run workflow**

---

## 로컬 실행

### 요구 사항

- Python 3.11+
- [uv](https://github.com/astral-sh/uv)

### 환경 설정

```bash
# 의존성 설치
uv sync

# 환경변수 설정
cp .env.example .env
# .env 에 GEMINI_API_KEY 입력
```

### 데이터 생성

```bash
uv run python scripts/generate_data.py
```

`docs/data/` 하위에 JSON 파일이 생성됩니다.

### 로컬 서버 실행

```bash
python -m http.server 8080 --directory docs
# http://localhost:8080 접속
```

---

## 프로젝트 구조

```
ow-agent/
├── .github/workflows/
│   └── update-data.yml        # 자동 갱신 스케줄 (매일 15:00 KST)
├── bot/utils/
│   ├── scrapers/
│   │   ├── meta_scraper.py    # Blizzard 공식 통계 크롤러
│   │   ├── stadium_scraper.py # stadiumbuilds.io 크롤러
│   │   └── patch_scraper.py   # Blizzard 패치 노트 크롤러
│   └── translator.py          # Gemini API 번역·요약 (배치 처리)
├── data/
│   ├── heroes.json            # 영웅 DB (자동 동기화)
│   └── meta_baseline.json     # 크롤링 실패 시 fallback 데이터
├── docs/                      # GitHub Pages 서빙 루트
│   ├── data/                  # 자동 생성 JSON (Actions이 커밋)
│   ├── views/
│   │   ├── meta.js            # 메타 통계 뷰 (Chart.js 히스토리)
│   │   ├── stadium.js         # 스타디움 빌드 뷰 (역할군별 분류)
│   │   └── patch.js           # 패치 노트 뷰
│   ├── app.js                 # 라우팅 및 공통 유틸
│   ├── index.html             # 진입점
│   └── style.css              # 다크 테마
└── scripts/
    └── generate_data.py       # 전체 데이터 생성 스크립트
```

---

## 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | Gemini API 키 (번역·요약에 사용). [Google AI Studio](https://aistudio.google.com/)에서 발급 |

GitHub Actions에서는 **Settings → Secrets → `GEMINI_API_KEY`** 로 등록합니다.

---

## 기술 스택

- **백엔드**: Python, aiohttp, BeautifulSoup4
- **번역·요약**: Google Gemini API (`gemini-3.1-flash-lite-preview`)
- **프론트엔드**: Vanilla JS (ES Modules), Chart.js, Tailwind CSS
- **배포**: GitHub Pages + GitHub Actions
