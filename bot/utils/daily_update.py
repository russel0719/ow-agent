"""
일일 데이터 업데이트 모듈.

매일 스케줄러에 의해 호출되어 다음 데이터를 갱신합니다:
1. 오버워치 메타 통계 (Blizzard 공식 사이트, 전 랭크)
2. 스타디움 빌드 (stadiumbuilds.io, 전 영웅)
3. 최신 패치 노트 (Blizzard 공식 사이트)

갱신된 데이터는 캐시와 fallback 파일에 저장됩니다.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import aiohttp

from bot.utils import cache
from bot.utils.scrapers.meta_scraper import (
    RANK_PARAM,
    HeroMeta,
    fetch_meta,
    _calculate_scores,
)
from bot.utils.scrapers.stadium_scraper import (
    StadiumBuild,
    fetch_all_builds,
)
from bot.utils.scrapers.patch_scraper import (
    PatchNote,
    fetch_latest_patch,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent.parent / "data"
META_FALLBACK_PATH = DATA_DIR / "meta_baseline.json"
STADIUM_FALLBACK_PATH = DATA_DIR / "stadium_builds.json"

META_CACHE_TTL = 86400      # 24시간 (일일 업데이트)
STADIUM_CACHE_TTL = 86400   # 24시간
PATCH_CACHE_TTL = 43200     # 12시간


async def run_daily_update() -> dict:
    """모든 데이터를 갱신합니다. 결과 요약 dict 반환."""
    logger.info("=== 일일 데이터 업데이트 시작 ===")
    results = {}

    async with aiohttp.ClientSession() as session:
        results["meta"] = await _update_meta(session)
        results["stadium"] = await _update_stadium_builds(session)
        results["patch"] = await _update_patch(session)

    logger.info(f"=== 일일 업데이트 완료: {results} ===")
    return results


async def _update_meta(session: aiohttp.ClientSession) -> str:
    """전 랭크 메타 통계 갱신."""
    updated = 0
    failed = 0
    all_rank_data: dict[str, list[dict]] = {}

    # 챔피언은 그랜드마스터와 동일하므로 중복 제외
    unique_ranks = {v: k for k, v in RANK_PARAM.items() if v != "챔피언"}
    ranks_to_fetch = {v: k for k, v in RANK_PARAM.items()}

    for rank_ko in set(RANK_PARAM.keys()) - {"챔피언"}:
        try:
            heroes = await fetch_meta(session, rank_ko)
            if heroes:
                hero_dicts = [_hero_to_dict(h) for h in heroes]
                cache.set(f"meta_{rank_ko}", hero_dicts, META_CACHE_TTL)
                all_rank_data[rank_ko] = hero_dicts
                logger.info(f"  메타 업데이트 완료: {rank_ko} ({len(heroes)}명)")
                updated += 1
            else:
                failed += 1
                logger.warning(f"  메타 업데이트 실패: {rank_ko}")
        except Exception as e:
            failed += 1
            logger.error(f"  메타 업데이트 오류 ({rank_ko}): {e}")

    # 챔피언 = 그랜드마스터 복사
    if "그랜드마스터" in all_rank_data:
        all_rank_data["챔피언"] = all_rank_data["그랜드마스터"]
        cache.set("meta_챔피언", all_rank_data["챔피언"], META_CACHE_TTL)

    # fallback 파일 갱신
    if all_rank_data:
        _save_json(META_FALLBACK_PATH, all_rank_data)
        logger.info(f"  meta_baseline.json 업데이트 완료 ({len(all_rank_data)} 랭크)")

    return f"성공 {updated}, 실패 {failed}"


async def _update_stadium_builds(session: aiohttp.ClientSession) -> str:
    """전 영웅 스타디움 빌드 갱신."""
    try:
        from bot.utils.scrapers.stadium_scraper import _normalize_name
        builds = await fetch_all_builds(session)
        if not builds:
            return "빌드 데이터 없음"

        # 영웅별로 캐시 저장 (정규화된 이름 사용)
        by_hero: dict[str, list[dict]] = {}
        for b in builds:
            key = _normalize_name(b.hero)
            by_hero.setdefault(key, []).append(_build_to_dict(b))

        for hero_name, build_dicts in by_hero.items():
            cache.set(f"stadium_{hero_name}", build_dicts, STADIUM_CACHE_TTL)

        # fallback 파일 갱신
        all_builds = [_build_to_dict(b) for b in builds]
        _save_json(STADIUM_FALLBACK_PATH, {"builds": all_builds})
        logger.info(f"  스타디움 빌드 업데이트 완료 ({len(builds)}개 빌드, {len(by_hero)} 영웅)")
        return f"{len(builds)}개 빌드, {len(by_hero)}명 영웅"

    except Exception as e:
        logger.error(f"  스타디움 빌드 업데이트 오류: {e}")
        return f"오류: {e}"


async def _update_patch(session: aiohttp.ClientSession) -> str:
    """최신 패치 노트 갱신."""
    try:
        patch = await fetch_latest_patch(session)
        if not patch:
            return "패치 데이터 없음"

        patch_dict = _patch_to_dict(patch)
        cache.set("patch_latest", patch_dict, PATCH_CACHE_TTL)
        logger.info(f"  패치 업데이트 완료: {patch.title} ({patch.date})")
        return f"{patch.title}"

    except Exception as e:
        logger.error(f"  패치 업데이트 오류: {e}")
        return f"오류: {e}"


def _hero_to_dict(h: HeroMeta) -> dict:
    return {
        "hero_id": h.hero_id,
        "hero_name": h.hero_name,
        "role": h.role,
        "pick_rate": h.pick_rate,
        "win_rate": h.win_rate,
        "ban_rate": h.ban_rate,
        "meta_score": h.meta_score,
        "tier": h.tier,
    }


def _build_to_dict(b: StadiumBuild) -> dict:
    return {
        "hero": b.hero,
        "name": b.name,
        "code": b.code,
        "description": b.description,
        "playstyle": b.playstyle,
        "source": b.source,
        "upvotes": b.upvotes,
    }


def _patch_to_dict(patch: PatchNote) -> dict:
    return {
        "title": patch.title,
        "date": patch.date,
        "url": patch.url,
        "hero_changes": [
            {
                "hero": hc.hero,
                "changes": hc.changes,
                "is_stadium": hc.is_stadium,
            }
            for hc in patch.hero_changes
        ],
        "general_changes": patch.general_changes,
    }


def _save_json(path: Path, data: dict) -> None:
    """JSON 파일에 데이터 저장."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
