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

import argparse
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
from bot.utils.scrapers.patch_scraper import fetch_recent_patches
from bot.utils.scrapers.stadium_scraper import fetch_all_builds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# hero_id → 정식 영문 표기 (title() 변환으로 처리 불가능한 예외)
_EN_NAME_EXCEPTIONS: dict[str, str] = {
    "dva":           "D.Va",
    "soldier76":     "Soldier: 76",
    "lucio":         "Lúcio",
    "torbjorn":      "Torbjörn",
    "junker_queen":  "Junker Queen",
    "wrecking_ball": "Wrecking Ball",
    "jetpack_cat":   "Jetpack Cat",
}


def _hero_id_to_en_name(hero_id: str) -> str:
    """hero_id → 정식 영문 display name."""
    if hero_id in _EN_NAME_EXCEPTIONS:
        return _EN_NAME_EXCEPTIONS[hero_id]
    return hero_id.replace("_", " ").title()

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

async def _generate_stadium(session: aiohttp.ClientSession, force: bool = False) -> bool:
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

        by_hero = _translate_stadium_data(by_hero, force=force)
        _save(DOCS_DATA / "stadium.json", by_hero)
        logger.info(f"  스타디움 완료: {len(builds)}개 빌드, {len(by_hero)}개 영웅")
        return True
    except Exception as e:
        logger.warning(f"  스타디움 실패: {e} — 기존 파일 유지")
        return False


# ── 패치 노트 ─────────────────────────────────────────────────────────────────

async def _generate_patch(session: aiohttp.ClientSession) -> bool:
    """최근 30일 패치 노트 → patch.json 생성 (누적 리스트)."""
    try:
        patches = await fetch_recent_patches(session, days=30)
        if not patches:
            raise ValueError("패치 데이터 없음")

        # 기존 patch.json 로드 (리스트 or 레거시 단일 객체)
        existing_raw = _load(DOCS_DATA / "patch.json")
        existing_list: list[dict] = existing_raw if isinstance(existing_raw, list) else []
        existing_by_url = {p["url"]: p for p in existing_list if isinstance(p, dict)}

        result: list[dict] = []
        for patch in patches:
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
            existing = existing_by_url.get(patch.url)
            data = _translate_patch_data(data, existing)
            result.append(data)

        _save(DOCS_DATA / "patch.json", result)
        logger.info(f"  패치 완료: {len(result)}개 ({', '.join(p['date'] for p in result)})")
        return True
    except Exception as e:
        logger.warning(f"  패치 실패: {e} — 기존 파일 유지")
        return False


# ── 번역 후처리 ───────────────────────────────────────────────────────────────

def _has_korean(text: str) -> bool:
    """텍스트에 한글 문자가 포함되어 있는지 확인."""
    return any('\uAC00' <= c <= '\uD7A3' for c in (text or ""))


def _translate_patch_data(data: dict, existing: dict | None = None) -> dict:
    """패치 노트 영문 → 한국어 번역.

    existing이 있고 동일 URL의 패치가 이미 한국어로 번역되어 있으면 기존 번역을 재사용한다.
    """
    from bot.utils.translator import translate, translate_list

    if (
        existing
        and existing.get("url") == data.get("url")
        and _has_korean(existing.get("title", ""))
        and existing.get("hero_changes")
    ):
        logger.info(f"  패치 번역 스킵: {data.get('date')} 이미 번역됨")
        return existing

    total = 1 + sum(1 + len(hc["changes"]) for hc in data["hero_changes"]) + len(data["general_changes"])
    logger.info(f"  패치 번역 시작: {total}건")

    data["title"] = translate(data["title"])
    for hc in data["hero_changes"]:
        hero_en = hc["hero"]                    # 번역 전 영문명 보존
        hc["hero"] = translate(hero_en)
        hc["changes"] = translate_list(
            hc["changes"],
            label=f"패치노트 번역 ({hc['hero']})",
            heroes=[hero_en],
        )
    data["general_changes"] = translate_list(data["general_changes"], label="패치노트 공통 변경사항 번역")

    logger.info("  패치 번역 완료")
    return data


def _translate_stadium_data(by_hero: dict, force: bool = False) -> dict:
    """스타디움 빌드 이름(번역) · 설명(3줄 요약) 한국어 처리 (빌드 코드 기반 캐시 활용)."""
    from bot.utils.translator import translate_list, translate_stadium_names, summarize_list

    # 기존 stadium.json에서 이미 번역된 내용 로드 (재실행 시 중복 처리 방지)
    # force=True 시 캐시 무시 → 전체 재번역
    prev: dict[str, dict] = {}
    if not force:
        existing = _load(DOCS_DATA / "stadium.json")
        if isinstance(existing, dict):
            for builds in existing.values():
                for b in builds:
                    code = b.get("code", "")
                    name = b.get("name", "")
                    if code and _has_korean(name):
                        prev[code] = {"name": name, "description": b.get("description", "")}

    # 신규 빌드만 추출 (소속 영웅 함께 추적)
    new_builds: list[dict] = []
    new_build_heroes: list[str] = []
    for hero_en, builds in by_hero.items():
        for build in builds:
            code = build.get("code", "")
            if code in prev:
                build["name"] = prev[code]["name"]
                build["description"] = prev[code]["description"]
            else:
                new_builds.append(build)
                new_build_heroes.append(hero_en)

    if new_builds:
        names = [b["name"] for b in new_builds]
        descs = [b.get("description") or "" for b in new_builds]
        unique_heroes = list(dict.fromkeys(new_build_heroes))   # 순서 유지 중복 제거

        logger.info(f"  스타디움 신규 처리: {len(new_builds)}건 (이름 번역 + 설명 요약)")
        translated_names = translate_stadium_names(names, heroes=unique_heroes)
        summarized_descs = summarize_list(descs, label="스타디움 빌드 설명 요약", heroes=unique_heroes)

        for build, name, desc in zip(new_builds, translated_names, summarized_descs):
            build["name"] = name
            build["description"] = desc

    logger.info(f"  스타디움 번역: 신규 {len(new_builds)}건, 캐시 재사용 {len(prev)}건")
    return by_hero


# ── 영웅 DB ──────────────────────────────────────────────────────────────────

def _sync_heroes_json(all_ranks: dict) -> None:
    """Blizzard 공식 메타 통계 기반으로 data/heroes.json 자동 동기화.

    신규 영웅 발견 시 name / role / aliases 만 채워 추가한다.
    기존 항목은 수정하지 않는다.
    """
    heroes_path = ROOT / "data" / "heroes.json"
    heroes_data: dict = _load(heroes_path)  # type: ignore
    if not isinstance(heroes_data, dict):
        heroes_data = {}
    heroes: dict = heroes_data.setdefault("heroes", {})
    existing_ids = set(heroes.keys())

    # 모든 랭크를 순회해 hero_id → {role, hero_name} 수집 (중복 제거)
    meta_map: dict[str, dict] = {}
    for rank_heroes in all_ranks.values():
        for h in rank_heroes:
            if h["hero_id"] not in meta_map:
                meta_map[h["hero_id"]] = {
                    "role": h["role"],
                    "hero_name": h["hero_name"],
                }

    added: list[str] = []
    for hero_id, info in meta_map.items():
        if hero_id in existing_ids:
            continue
        en_name = _hero_id_to_en_name(hero_id)
        heroes[hero_id] = {
            "name": en_name,
            "role": info["role"],
            "aliases": [info["hero_name"], hero_id],
        }
        added.append(f"{en_name}({info['role']})")

    if added:
        logger.info(f"  heroes.json 자동 추가: {added}")
        _save(heroes_path, heroes_data)
    else:
        logger.info("  heroes.json: 신규 영웅 없음")


def _copy_heroes() -> None:
    """data/heroes.json → docs/data/heroes.json 복사."""
    src = ROOT / "data" / "heroes.json"
    dst = DOCS_DATA / "heroes.json"
    shutil.copy2(src, dst)
    logger.info(f"  영웅 DB 복사 완료 ({dst.stat().st_size // 1024}KB)")


# ── 메인 ─────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="OW 데이터 생성 스크립트")
    p.add_argument(
        "--force-stadium",
        action="store_true",
        help="스타디움 빌드 번역 캐시 무시하고 전체 재번역",
    )
    return p.parse_args()


async def main() -> None:
    args = _parse_args()
    logger.info("=== OW 데이터 생성 시작 ===")
    if args.force_stadium:
        logger.info("  --force-stadium: 스타디움 전체 재번역 모드")
    sources: dict[str, str] = {}

    async with aiohttp.ClientSession() as session:
        # 1. 메타 통계
        all_ranks = await _generate_meta(session)
        if all_ranks:
            sources["meta"] = "live"
            _update_history(all_ranks)
            _sync_heroes_json(all_ranks)
        else:
            sources["meta"] = "fallback"
            logger.warning("  메타 전체 실패 — history 갱신 건너뜀")

        # 2. 스타디움 빌드
        sources["stadium"] = "live" if await _generate_stadium(session, force=args.force_stadium) else "fallback"

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
