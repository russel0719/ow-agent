# 데이터 파이프라인

## 전체 실행 순서 (`scripts/generate_data.py`)

```
1. meta 크롤링      → public/data/meta.json, meta_history.json
2. map_meta 크롤링  → public/data/map_meta.json, map_meta_history.json
3. 영웅 DB 동기화   → data/heroes.json (신규 영웅 자동 추가)
4. stadium 크롤링   → public/data/stadium.json (번역·요약 포함)
5. patch 크롤링     → public/data/patch.json (번역 포함)
6. heroes.json 복사 → public/data/heroes.json
7. last_updated.json 저장
```

수동 실행:
```bash
uv run python scripts/generate_data.py
```

## 크롤러

### `bot/utils/scrapers/meta_scraper.py`
- **소스**: `https://overwatch.blizzard.com/ko-kr/rates/`
- 9개 랭크(전체~챔피언) × 전 영웅 픽률·승률·메타점수 수집
- 90일 히스토리 rolling 업데이트

### `bot/utils/scrapers/stadium_scraper.py`
- **소스**: `https://stadiumbuilds.io/`
- 영웅별 인기 빌드 목록 (코드, 추천수, 설명)
- 신규 빌드만 번역 (빌드 코드 기반 캐시)

### `bot/utils/scrapers/patch_scraper.py`
- **소스**: `https://overwatch.blizzard.com/ko-kr/news/patch-notes/`
- 최근 14일 이내 패치 수집
- 한국어 URL이지만 패치 초기에는 영어로 제공될 수 있음 → 번역 로직 적용

## 번역 파이프라인

### `bot/utils/translator.py`
- **모델**: `moonshotai/kimi-k2-instruct` (NVIDIA API)
- **배치 처리**: 최대 10건/요청
- **캐시**: 프로세스 내 메모리 캐시 (`_CACHE` dict)
- **재시도**: 429 시 지수 백오프 (최대 5회)

번역 함수:
```python
translate(text)                    # 단일 텍스트
translate_list(texts, heroes=[])   # 리스트 배치 번역
translate_stadium_names(texts)     # 스타디움 빌드 이름 전용
summarize_list(texts)              # 3줄 요약
```

### `bot/utils/glossary.py`
- **데이터**: `data/ow_glossary.json`
- `get_glossary_section(hero_en_names)` — 번역 프롬프트에 주입할 용어 문자열 반환
- EN 이름과 KR 이름 양방향으로 영웅 조회 가능 (`_name_to_id()`)

### 번역 적용 조건
- `_has_korean(text)` — 텍스트에 한글이 있으면 True
- 이미 한국어인 텍스트는 번역 API 호출 건너뜀 (불필요한 비용 방지)

## 새 영웅 추가 방법

### 1. `data/heroes.json` 수동 추가

```json
{
  "heroes": {
    "new_hero": {
      "name": "New Hero",
      "role": "damage",
      "aliases": ["뉴히어로", "new hero", "nh"],
      "counters": ["tracer", "genji"],
      "countered_by": ["ana", "sigma"],
      "synergies": ["lucio", "mercy"],
      "tips": [
        "팁 1",
        "팁 2"
      ]
    }
  }
}
```

### 2. `data/ow_glossary.json` 수동 추가

```json
{
  "heroes": {
    "new_hero": {
      "name": { "New Hero": "뉴히어로" },
      "skills": {
        "Skill One": "스킬 일",
        "Ultimate": "궁극기명"
      },
      "keys": {
        "Skill One": "Shift"
      }
    }
  }
}
```

> `generate_data.py`의 `_sync_heroes()` 함수가 Blizzard 공식 통계에서 새 영웅을 감지하면
> `data/heroes.json`에 자동으로 기본 항목을 추가합니다. 카운터·시너지·팁·aliases는 수동 입력 필요.

## GitHub Actions 시크릿

| 시크릿 | 용도 |
|--------|------|
| `GEMINI_API_KEY` | Gemini API (번역·요약) |
| `NVIDIA_API_KEY` | NVIDIA API (Kimi K2, 패치노트 번역) |

Settings → Secrets and variables → Actions 에서 등록.
