"""기존 public/data/*.json 을 Supabase(ow_agent 스키마)로 1회 백필.

Supabase 이관 시 히스토리 차트 연속성을 위해 현재 커밋된 로컬 데이터를 옮긴다.
이후 매일 갱신은 scripts/generate_data.py 가 Supabase에 누적한다.

사용법 (로컬, 자격증명 필요):
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run python scripts/backfill_supabase.py
  (또는 .env 에 두 값 설정 후 `uv run python scripts/backfill_supabase.py`)

멱등: PK 기준 upsert 이므로 여러 번 실행해도 안전하다.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from bot.utils.supabase_sync import SupabaseStore  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATA = ROOT / "public" / "data"

# datasets 테이블 blob 대상 (repo 유지 파일 heroes/maps 는 제외)
BLOB_DATASETS = ["meta", "map_meta", "stadium", "patch", "last_updated"]
_BATCH = 200  # PostgREST 요청당 행 수


def _load(name: str):
    path = DATA / f"{name}.json"
    if not path.exists():
        logger.warning(f"  {name}.json 없음 — 건너뜀")
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _upsert_batched(fn, rows: list[dict], label: str) -> None:
    total = 0
    for i in range(0, len(rows), _BATCH):
        chunk = rows[i : i + _BATCH]
        if fn(chunk):
            total += len(chunk)
        else:
            logger.error(f"  {label} 배치 실패 (offset {i}) — 중단")
            return
    logger.info(f"  {label}: {total}행 upsert 완료")


def main() -> None:
    store = SupabaseStore()
    if not store.enabled:
        logger.error(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. "
            ".env 또는 셸 환경에 설정 후 다시 실행하세요."
        )
        sys.exit(1)

    # 1. blob 스냅샷
    for name in BLOB_DATASETS:
        data = _load(name)
        if data is None:
            continue
        if store.put_dataset(name, data):
            logger.info(f"  datasets['{name}'] upsert 완료")
        else:
            logger.error(f"  datasets['{name}'] upsert 실패")

    # 2. meta_history: {rank: {date: heroes}} → 행 분해
    meta_hist = _load("meta_history") or {}
    rows = [
        {"rank": rank, "snapshot_date": date, "heroes": heroes}
        for rank, by_date in meta_hist.items()
        for date, heroes in by_date.items()
    ]
    _upsert_batched(store.upsert_meta_history, rows, "meta_history")

    # 3. map_meta_history: {map_id: {date: entries}} → 행 분해
    map_hist = _load("map_meta_history") or {}
    rows = [
        {"map_id": map_id, "snapshot_date": date, "entries": entries}
        for map_id, by_date in map_hist.items()
        for date, entries in by_date.items()
    ]
    _upsert_batched(store.upsert_map_history, rows, "map_meta_history")

    logger.info("=== 백필 완료 ===")


if __name__ == "__main__":
    main()
