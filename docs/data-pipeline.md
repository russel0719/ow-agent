# 데이터 파이프라인

## 전체 실행 순서 (`scripts/generate_data.py`)

```
1. meta 크롤링      → public/data/meta.json, meta_history.json
2. map_meta 크롤링  → public/data/map_meta.json, map_meta_history.json
3. 영웅 DB 동기화   → data/heroes.json (신규 영웅 자동 추가)
4. stadium 크롤링   → public/data/stadium.json (번역·요약 포함)
5. patch 크롤링     → public/data/patch.json (번역 + translation_source 태깅)
6. heroes.json 복사 → public/data/heroes.json
7. last_updated.json 저장
```

수동 실행:
```bash
uv run python scripts/generate_data.py
```

패치만 재실행:
```bash
# patch.json 삭제 후 패치 부분만 실행
rm public/data/patch.json && uv run python -c "
import asyncio, sys
sys.path.insert(0, '.')
import aiohttp
from scripts.generate_data import _generate_patch

async def run():
    async with aiohttp.ClientSession() as session:
        await _generate_patch(session)

asyncio.run(run())
"
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
- **데이터**: `data/ow_glossary.json` (수동) + `data/heroes.json` (자동 갱신) 통합
- `get_glossary_section(hero_en_names)` — 번역 프롬프트에 주입할 용어 문자열 반환
- `get_korean_name(en_name)` — 영어 영웅명 → 한국어 이름 (glossary → heroes.json aliases 순)
- `_name_to_id()` — glossary.json + heroes.json aliases 통합 역방향 테이블
  - glossary에 없는 신규 영웅도 heroes.json aliases로 자동 인식

### 패치노트 번역 흐름 (`_translate_patch_data`)

```
크롤링 원본
    │
    ▼
제목이 한국어? (_has_korean)
    │
    ├─ YES (공식 한국어)
    │   ├─ 영어 영웅명 있으면 glossary/heroes.json으로 변환 (_fix_hero_names)
    │   ├─ 기존이 "official"이면 재사용
    │   └─ 저장: translation_source = "official"
    │
    └─ NO (영어, 패치 초기)
        ├─ 기존 번역(LLM·official) 있으면 재사용
        └─ 없으면 LLM 번역 시작
            ├─ 영웅명: get_korean_name() 우선, 없으면 translate()
            ├─ 변경사항: 영어 항목만 선별 번역
            └─ 저장: translation_source = "llm"

다음 실행 시: llm → official 자동 교체 (공식 한국어 올라오면)
```

`translation_source` 필드:
- `"official"` — Blizzard 공식 한국어 패치노트
- `"llm"` — 영어 원문을 LLM으로 번역한 결과

### 번역 적용 조건
- `_has_korean(text)` — 텍스트에 한글이 있으면 True
- 이미 한국어인 텍스트는 번역 API 호출 건너뜀 (불필요한 비용 방지)

## 새 영웅 추가 방법

신규 영웅은 `_sync_heroes_json()`이 Blizzard 공식 통계에서 자동 감지해 `data/heroes.json`에 추가합니다.
추가된 즉시 `glossary.py`의 `_name_to_id()`가 heroes.json aliases를 포함하므로 번역 파이프라인에서 자동으로 인식됩니다.

수동으로 보완할 항목:

### `data/heroes.json`

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
      "tips": ["팁 1", "팁 2"]
    }
  }
}
```

> aliases 첫 번째 항목을 한국어로 설정하면 패치노트 영어 영웅명 자동 변환에 활용됩니다.

### `data/ow_glossary.json` (선택, 스킬명 번역 품질 향상)

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

## GitHub Actions 시크릿

| 시크릿 | 용도 |
|--------|------|
| `NVIDIA_API_KEY` | NVIDIA API (Kimi K2, 번역·요약) |

Settings → Secrets and variables → Actions 에서 등록.
