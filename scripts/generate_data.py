"""
OW2 웹 데이터 생성 스크립트.

GitHub Actions 또는 로컬에서 실행:
  uv run python scripts/generate_data.py

docs/data/ 에 다음 파일을 생성/갱신합니다:
  meta.json          - 9개 랭크 × 50명 현재 스냅샷
  meta_history.json  - 전체·그랜드마스터 90일 rolling 히스토리
  stadium.json       - 영웅별 빌드 목록
  patch.json         - 최신 패치 노트
  heroes.json        - 정적 영웅 DB (data/heroes.json 복사)
  last_updated.json  - 갱신 시각 및 소스 상태
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가 (bot.utils.* import 가능하도록)
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import aiohttp
from dotenv import load_dotenv

load_dotenv()

from bot.utils.scrapers.meta_scraper import RANK_PARAM, fetch_meta, load_fallback
from bot.utils.scrapers.patch_scraper import fetch_latest_patch
from bot.utils.scrapers.stadium_scraper import fetch_all_builds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DOCS_DATA = ROOT / "docs" / "data"
DOCS_DATA.mkdir(parents=True, exist_ok=True)

HISTORY_RANKS = {"전체", "그랜드마스터"}  # 히스토리 저장 대상 랭크
HISTORY_DAYS = 90                           # rolling window 일수


def _save(path: Path, data: object) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"  → {path.name} 저장 ({path.stat().st_size // 1024}KB)")


def _load(path: Path) -> object:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return json.load(f)


# ── 메타 통계 ────────────────────────────────────────────────────────────────

async def _generate_meta(session: aiohttp.ClientSession) -> dict | None:
    """전 랭크 메타 통계 스크래핑 → meta.json 생성."""
    all_ranks: dict[str, list] = {}
    failed = 0

    for rank_ko in set(RANK_PARAM.keys()) - {"챔피언"}:
        try:
            heroes = await fetch_meta(session, rank_ko)
            if heroes:
                all_ranks[rank_ko] = [_hero_to_dict(h) for h in heroes]
                logger.info(f"  메타 완료: {rank_ko} ({len(heroes)}명)")
            else:
                raise ValueError("빈 데이터")
        except Exception as e:
            logger.warning(f"  메타 실패 {rank_ko}: {e} — fallback 사용")
            fallback = load_fallback(rank_ko)
            if fallback:
                all_ranks[rank_ko] = [_hero_to_dict(h) for h in fallback]
            else:
                failed += 1

    if not all_ranks:
        return None

    # 챔피언 = 그랜드마스터 복사
    if "그랜드마스터" in all_ranks:
        all_ranks["챔피언"] = all_ranks["그랜드마스터"]

    _save(DOCS_DATA / "meta.json", all_ranks)
    return all_ranks


def _update_history(all_ranks: dict) -> None:
    """meta_history.json 에 오늘 날짜 데이터 추가 (90일 rolling)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    history_path = DOCS_DATA / "meta_history.json"
    history: dict[str, dict] = _load(history_path)  # type: ignore

    for rank_ko in HISTORY_RANKS:
        if rank_ko not in all_ranks:
            continue
        if rank_ko not in history:
            history[rank_ko] = {}

        # 오늘 스냅샷 저장 (점수·픽률·승률·티어만 저장해 크기 절약)
        history[rank_ko][today] = [
            {
                "hero_id": h["hero_id"],
                "hero_name": h["hero_name"],
                "meta_score": h["meta_score"],
                "pick_rate": h["pick_rate"],
                "win_rate": h["win_rate"],
                "tier": h["tier"],
            }
            for h in all_ranks[rank_ko]
        ]

        # 최근 HISTORY_DAYS 일치만 유지
        sorted_dates = sorted(history[rank_ko].keys())
        if len(sorted_dates) > HISTORY_DAYS:
            for old_date in sorted_dates[: len(sorted_dates) - HISTORY_DAYS]:
                del history[rank_ko][old_date]

    _save(history_path, history)


def _hero_to_dict(h) -> dict:
    return {
        "hero_id": h.hero_id,
        "hero_name": h.hero_name,
        "role": h.role,
        "pick_rate": h.pick_rate,
        "win_rate": h.win_rate,
        "meta_score": h.meta_score,
        "tier": h.tier,
    }


# ── 스타디움 빌드 ─────────────────────────────────────────────────────────────

async def _generate_stadium(session: aiohttp.ClientSession) -> bool:
    """모든 영웅 빌드 → stadium.json 생성 (영웅명 키로 그룹화)."""
    try:
        builds = await fetch_all_builds(session)
        if not builds:
            raise ValueError("빌드 데이터 없음")

        by_hero: dict[str, list] = {}
        for b in builds:
            by_hero.setdefault(b.hero, []).append({
                "name": b.name,
                "code": b.code,
                "description": b.description,
                "playstyle": b.playstyle,
                "upvotes": b.upvotes,
            })

        by_hero = _translate_stadium_data(by_hero)
        _save(DOCS_DATA / "stadium.json", by_hero)
        logger.info(f"  스타디움 완료: {len(builds)}개 빌드, {len(by_hero)}개 영웅")
        return True
    except Exception as e:
        logger.warning(f"  스타디움 실패: {e} — 기존 파일 유지")
        return False


# ── 패치 노트 ─────────────────────────────────────────────────────────────────

async def _generate_patch(session: aiohttp.ClientSession) -> bool:
    """최신 패치 노트 → patch.json 생성."""
    try:
        patch = await fetch_latest_patch(session)
        if not patch:
            raise ValueError("패치 데이터 없음")

        data = {
            "title": patch.title,
            "date": patch.date,
            "url": patch.url,
            "hero_changes": [
                {"hero": hc.hero, "changes": hc.changes, "is_stadium": hc.is_stadium}
                for hc in patch.hero_changes
            ],
            "general_changes": patch.general_changes,
        }
        data = _translate_patch_data(data)
        _save(DOCS_DATA / "patch.json", data)
        logger.info(f"  패치 완료: {data['title']} ({patch.date})")
        return True
    except Exception as e:
        logger.warning(f"  패치 실패: {e} — 기존 파일 유지")
        return False


# ── 번역 후처리 ───────────────────────────────────────────────────────────────

def _has_korean(text: str) -> bool:
    """텍스트에 한글 문자가 포함되어 있는지 확인."""
    return any('\uAC00' <= c <= '\uD7A3' for c in (text or ""))


def _translate_patch_data(data: dict) -> dict:
    """패치 노트 영문 → 한국어 번역."""
    from bot.utils.translator import translate, translate_list

    total = 1 + sum(1 + len(hc["changes"]) for hc in data["hero_changes"]) + len(data["general_changes"])
    logger.info(f"  패치 번역 시작: {total}건")

    data["title"] = translate(data["title"])
    for hc in data["hero_changes"]:
        hc["hero"] = translate(hc["hero"])
        hc["changes"] = translate_list(hc["changes"])
    data["general_changes"] = translate_list(data["general_changes"])

    logger.info("  패치 번역 완료")
    return data


def _translate_stadium_data(by_hero: dict) -> dict:
    """스타디움 빌드 이름·설명 영문 → 한국어 번역 (빌드 코드 기반 캐시 활용)."""
    from bot.utils.translator import translate

    # 기존 stadium.json에서 이미 번역된 내용 로드 (재실행 시 중복 번역 방지)
    # 한글이 포함된 경우에만 번역된 것으로 간주
    existing = _load(DOCS_DATA / "stadium.json")
    prev: dict[str, dict] = {}
    if isinstance(existing, dict):
        for builds in existing.values():
            for b in builds:
                code = b.get("code", "")
                name = b.get("name", "")
                if code and _has_korean(name):
                    prev[code] = {"name": name, "description": b.get("description", "")}

    new_count = 0
    for builds in by_hero.values():
        for build in builds:
            code = build.get("code", "")
            if code in prev:
                build["name"] = prev[code]["name"]
                build["description"] = prev[code]["description"]
            else:
                build["name"] = translate(build["name"])
                build["description"] = translate(build["description"])
                new_count += 1

    logger.info(f"  스타디움 번역: 신규 {new_count}건, 캐시 재사용 {len(prev)}건")
    return by_hero


# ── 영웅 DB ──────────────────────────────────────────────────────────────────

def _copy_heroes() -> None:
    """data/heroes.json → docs/data/heroes.json 복사."""
    src = ROOT / "data" / "heroes.json"
    dst = DOCS_DATA / "heroes.json"
    shutil.copy2(src, dst)
    logger.info(f"  영웅 DB 복사 완료 ({dst.stat().st_size // 1024}KB)")


# ── 메인 ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    logger.info("=== OW 데이터 생성 시작 ===")
    sources: dict[str, str] = {}

    async with aiohttp.ClientSession() as session:
        # 1. 메타 통계
        all_ranks = await _generate_meta(session)
        if all_ranks:
            sources["meta"] = "live"
            _update_history(all_ranks)
        else:
            sources["meta"] = "fallback"
            logger.warning("  메타 전체 실패 — history 갱신 건너뜀")

        # 2. 스타디움 빌드
        sources["stadium"] = "live" if await _generate_stadium(session) else "fallback"

        # 3. 패치 노트
        sources["patch"] = "live" if await _generate_patch(session) else "fallback"

    # 4. 영웅 DB 복사
    _copy_heroes()

    # 5. last_updated.json
    _save(DOCS_DATA / "last_updated.json", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sources": sources,
    })

    logger.info(f"=== 완료: {sources} ===")


if __name__ == "__main__":
    asyncio.run(main())
