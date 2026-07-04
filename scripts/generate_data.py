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
from datetime import UTC, datetime
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가 (bot.utils.* import 가능하도록)
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import aiohttp  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from bot.utils import cache  # noqa: E402
from bot.utils.scrapers.meta_scraper import (  # noqa: E402
    RANK_PARAM,
    _calculate_scores,
    _score_to_tier,
    fetch_meta,
    load_fallback,
)
from bot.utils.scrapers.patch_scraper import fetch_recent_patches  # noqa: E402
from bot.utils.scrapers.stadium_scraper import fetch_all_builds  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# hero_id → 정식 영문 표기 (title() 변환으로 처리 불가능한 예외)
_EN_NAME_EXCEPTIONS: dict[str, str] = {
    "dva": "D.Va",
    "soldier76": "Soldier: 76",
    "lucio": "Lúcio",
    "torbjorn": "Torbjörn",
    "junker_queen": "Junker Queen",
    "wrecking_ball": "Wrecking Ball",
    "jetpack_cat": "Jetpack Cat",
}


def _hero_id_to_en_name(hero_id: str) -> str:
    """hero_id → 정식 영문 display name."""
    if hero_id in _EN_NAME_EXCEPTIONS:
        return _EN_NAME_EXCEPTIONS[hero_id]
    return hero_id.replace("_", " ").title()


DOCS_DATA = ROOT / "public" / "data"
DOCS_DATA.mkdir(parents=True, exist_ok=True)

HISTORY_RANKS = {  # 히스토리 저장 대상 랭크 (챔피언은 그랜드마스터와 동일하여 제외)
    "전체",
    "브론즈",
    "실버",
    "골드",
    "플래티넘",
    "다이아몬드",
    "마스터",
    "그랜드마스터",
}
HISTORY_DAYS = 90  # rolling window 일수
MAP_HISTORY_DAYS = 14  # 맵별 히스토리 rolling window 일수

# 맵 ID → 한국어 이름 (맵별 메타 수집용)
MAP_IDS: dict[str, str] = {
    # 제어 (Control)
    "antarctic-peninsula": "남극 반도",
    "busan": "부산",
    "ilios": "일리오스",
    "lijiang-tower": "리장 타워",
    "nepal": "네팔",
    "oasis": "오아시스",
    "samoa": "사모아",
    # 호위 (Escort)
    "circuit-royal": "서킷 로얄",
    "dorado": "도라도",
    "havana": "하바나",
    "junkertown": "쓰레기촌",
    "rialto": "리알토",
    "route-66": "66번 국도",
    "shambali-monastery": "샴발리 수도원",
    "watchpoint-gibraltar": "감시 기지: 지브롤터",
    # 혼합 (Hybrid)
    "blizzard-world": "블리자드 월드",
    "eichenwalde": "아이헨발데",
    "hollywood": "할리우드",
    "kings-row": "왕의 길",
    "midtown": "미드타운",
    "numbani": "눔바니",
    "paraiso": "파라이수",
    # 밀기 (Push)
    "colosseum": "콜로세오",
    "esperanca": "이스페란사",
    "new-queen-street": "뉴 퀸 스트리트",
    "runasapi": "루나사피",
    # 플래시포인트 (Flashpoint)
    "new-junk-city": "뉴 정크 시티",
    "suravasa": "수라바사",
    # 격돌 (Clash)
    "hanaoka": "하나오카",
    "throne-of-anubis": "아누비스의 왕좌",
}


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
    # 기존 meta.json에서 portrait_url 보존 맵 구축 — 업데이트 중 덮어쓰기 방지
    saved_portrait_map: dict[str, str] = {}
    existing_meta = _load(DOCS_DATA / "meta.json")
    if isinstance(existing_meta, dict):
        for heroes in existing_meta.values():
            for h in heroes if isinstance(heroes, list) else []:
                pid = h.get("hero_id", "")
                if pid and h.get("portrait_url") and pid not in saved_portrait_map:
                    saved_portrait_map[pid] = h["portrait_url"]

    all_ranks: dict[str, list] = {}
    all_heroes_raw: dict[str, list] = {}  # HeroMeta 보존 (ban_rate fallback용)
    failed = 0

    for rank_ko in set(RANK_PARAM.keys()) - {"챔피언"}:
        try:
            heroes = await fetch_meta(session, rank_ko)
            if heroes:
                all_heroes_raw[rank_ko] = heroes
                all_ranks[rank_ko] = [_hero_to_dict(h) for h in heroes]
                has_ban = any(h.ban_rate > 0 for h in heroes)
                ban_label = "있음" if has_ban else "없음"
                logger.info(f"  메타 완료: {rank_ko} ({len(heroes)}명, 밴률={ban_label})")
            else:
                raise ValueError("빈 데이터")
        except Exception as e:
            logger.warning(f"  메타 실패 {rank_ko}: {e} — fallback 사용")
            fallback = load_fallback(rank_ko)
            if fallback:
                all_heroes_raw[rank_ko] = fallback
                all_ranks[rank_ko] = [_hero_to_dict(h) for h in fallback]
            else:
                failed += 1

    if not all_ranks:
        return None

    # 모든 rq에서 ban_rate 없는 랭크: meta_history.json 최근값으로 보완 후 재계산
    for rank_ko, heroes in list(all_heroes_raw.items()):
        if any(h.ban_rate > 0 for h in heroes):
            continue
        date, last_ban = _get_last_known_ban_rates(rank_ko)
        if not last_ban:
            continue
        for h in heroes:
            h.ban_rate = last_ban.get(h.hero_id, 0.0)
        recalculated = _calculate_scores(heroes)
        all_heroes_raw[rank_ko] = recalculated
        all_ranks[rank_ko] = [_hero_to_dict(h) for h in recalculated]
        logger.warning(f"  {rank_ko}: ban_rate 없음 → {date} 히스토리 값으로 보완 후 재계산")

    # Blizzard API가 tier 파라미터를 무시하고 전 랭크에 동일 데이터를 반환할 때
    # 감지 후 stale 캐시로 교체
    if "전체" in all_ranks:
        global_key = frozenset(
            (h["hero_id"], h["pick_rate"], h["win_rate"]) for h in all_ranks["전체"]
        )
        portrait_map = {
            h["hero_id"]: h.get("portrait_url") or saved_portrait_map.get(h["hero_id"], "")
            for h in all_ranks["전체"]
        }
        for rank_ko in list(all_ranks.keys()):
            if rank_ko in ("전체", "챔피언"):
                continue
            rank_key = frozenset(
                (h["hero_id"], h["pick_rate"], h["win_rate"]) for h in all_ranks[rank_ko]
            )
            if rank_key == global_key:
                stale = cache.get_stale(f"meta_{rank_ko}")
                if stale:
                    for h in stale:
                        fallback_portrait = saved_portrait_map.get(h["hero_id"], "")
                        h["portrait_url"] = portrait_map.get(h["hero_id"]) or fallback_portrait
                        h["tier"] = _score_to_tier(h["meta_score"])
                    all_ranks[rank_ko] = stale
                    logger.info(f"  동일 데이터 감지 → stale 캐시 교체: {rank_ko}")
                else:
                    # CI 환경 등 캐시 없을 때 → meta_baseline.json fallback 사용
                    fallback = load_fallback(rank_ko)
                    if fallback:
                        hero_dicts = [_hero_to_dict(h) for h in fallback]
                        for h in hero_dicts:
                            h["portrait_url"] = portrait_map.get(
                                h["hero_id"]
                            ) or saved_portrait_map.get(h["hero_id"], "")
                        all_ranks[rank_ko] = hero_dicts
                        logger.info(f"  동일 데이터 감지 → fallback 교체: {rank_ko}")

    # 챔피언 = 그랜드마스터 복사
    if "그랜드마스터" in all_ranks:
        all_ranks["챔피언"] = all_ranks["그랜드마스터"]

    _save(DOCS_DATA / "meta.json", all_ranks)
    return all_ranks


def _get_last_known_ban_rates(rank_ko: str) -> tuple[str, dict[str, float]]:
    """meta_history.json에서 가장 최근 ban_rate > 0 데이터를 반환. 없으면 ("", {})."""
    history: dict = _load(DOCS_DATA / "meta_history.json")  # type: ignore
    for date in sorted(history.get(rank_ko, {}).keys(), reverse=True):
        heroes = history[rank_ko][date]
        if any(h.get("ban_rate", 0) > 0 for h in heroes):
            return date, {h["hero_id"]: h["ban_rate"] for h in heroes}
    return "", {}


def _update_history(all_ranks: dict) -> None:
    """meta_history.json 에 오늘 날짜 데이터 추가 (90일 rolling)."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    history_path = DOCS_DATA / "meta_history.json"
    history: dict[str, dict] = _load(history_path)  # type: ignore

    for rank_ko in HISTORY_RANKS:
        if rank_ko not in all_ranks:
            continue
        if rank_ko not in history:
            history[rank_ko] = {}

        # 오늘 스냅샷 저장 (점수·픽률·승률·밴률·존재감·티어만 저장해 크기 절약)
        history[rank_ko][today] = [
            {
                "hero_id": h["hero_id"],
                "hero_name": h["hero_name"],
                "meta_score": h["meta_score"],
                "pick_rate": h["pick_rate"],
                "win_rate": h["win_rate"],
                "ban_rate": h.get("ban_rate", 0.0),
                "presence_rate": h.get("presence_rate", 0.0),
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


async def _generate_map_meta(session: aiohttp.ClientSession) -> bool:
    """맵별 메타 통계 스크래핑 → map_meta.json 생성 (전체 랭크 기준)."""
    result: dict[str, list] = {}
    ok = 0
    for map_id, map_ko in MAP_IDS.items():
        try:
            heroes = await fetch_meta(session, rank="전체", map_id=map_id)
            if heroes:
                result[map_id] = [_hero_to_dict(h) for h in heroes]
                logger.info(f"  맵 완료: {map_ko} ({len(heroes)}명)")
                ok += 1
            else:
                logger.warning(f"  맵 데이터 없음: {map_ko}")
        except Exception as e:
            logger.warning(f"  맵 실패 {map_ko}: {e}")

    if result:
        _save(DOCS_DATA / "map_meta.json", result)
        logger.info(f"  맵별 메타 완료: {ok}/{len(MAP_IDS)}개 맵")
        _update_map_history(result)
        return True
    logger.warning("  맵별 메타: 수집된 데이터 없음")
    return False


def _update_map_history(map_result: dict) -> None:
    """map_meta_history.json에 오늘 날짜 맵별 스냅샷 추가 (14일 rolling)."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    history_path = DOCS_DATA / "map_meta_history.json"
    history: dict = _load(history_path)  # type: ignore

    for map_id, heroes in map_result.items():
        if map_id not in history:
            history[map_id] = {}
        history[map_id][today] = [
            {"hero_id": h["hero_id"], "meta_score": h["meta_score"]} for h in heroes
        ]
        sorted_dates = sorted(history[map_id].keys())
        if len(sorted_dates) > MAP_HISTORY_DAYS:
            for old_date in sorted_dates[: len(sorted_dates) - MAP_HISTORY_DAYS]:
                del history[map_id][old_date]

    _save(history_path, history)


def _hero_to_dict(h) -> dict:
    d = {
        "hero_id": h.hero_id,
        "hero_name": h.hero_name,
        "role": h.role,
        "pick_rate": h.pick_rate,
        "win_rate": h.win_rate,
        "ban_rate": h.ban_rate,
        "meta_score": h.meta_score,
        "tier": h.tier,
        "presence_rate": h.presence_rate,
        "ban_efficiency": h.ban_efficiency,
    }
    if h.portrait_url:
        d["portrait_url"] = h.portrait_url
    return d


# ── 스타디움 빌드 ─────────────────────────────────────────────────────────────


async def _generate_stadium(session: aiohttp.ClientSession, force: bool = False) -> bool:
    """모든 영웅 빌드 → stadium.json 생성 (영웅명 키로 그룹화)."""
    try:
        builds = await fetch_all_builds(session)
        if not builds:
            raise ValueError("빌드 데이터 없음")

        by_hero: dict[str, list] = {}
        for b in builds:
            by_hero.setdefault(b.hero, []).append(
                {
                    "name": b.name,
                    "code": b.code,
                    "description": b.description,
                    "playstyle": b.playstyle,
                    "upvotes": b.upvotes,
                    "stats": b.stats,
                    "cost": b.cost,
                    "created_at": b.created_at,
                    "popular_rank": b.popular_rank,
                    "latest_rank": b.latest_rank,
                    "items": b.items,
                }
            )

        by_hero = _translate_stadium_data(by_hero, force=force)
        _save(DOCS_DATA / "stadium.json", by_hero)
        logger.info(f"  스타디움 완료: {len(builds)}개 빌드, {len(by_hero)}개 영웅")
        return True
    except Exception as e:
        logger.warning(f"  스타디움 실패: {e} — 기존 파일 유지")
        return False


# ── 패치 노트 ─────────────────────────────────────────────────────────────────


async def _generate_patch(
    session: aiohttp.ClientSession,
    portrait_by_name: dict[str, str] | None = None,
) -> bool:
    """최근 14일 패치 노트 → patch.json 생성 (누적 리스트)."""
    try:
        patches = await fetch_recent_patches(session, days=14)
        if not patches:
            raise ValueError("패치 데이터 없음")

        # 기존 patch.json 로드 (리스트 or 레거시 단일 객체)
        existing_raw = _load(DOCS_DATA / "patch.json")
        existing_list: list[dict] = existing_raw if isinstance(existing_raw, list) else []
        existing_by_date = {p["date"]: p for p in existing_list if isinstance(p, dict)}

        seen_dates: set[str] = set()
        result: list[dict] = []
        for patch in patches:
            if patch.date in seen_dates:
                continue
            seen_dates.add(patch.date)
            existing = existing_by_date.get(patch.date)

            # 기존 패치의 영웅별 portrait_url 보존
            existing_hc_portraits = {
                hc["hero"]: hc.get("portrait_url", "")
                for hc in (existing.get("hero_changes", []) if existing else [])
            }
            data = {
                "title": patch.title,
                "date": patch.date,
                "url": patch.url,
                "hero_changes": [
                    {
                        "hero": hc.hero,
                        "changes": hc.changes,
                        "is_stadium": hc.is_stadium,
                        "portrait_url": (portrait_by_name or {}).get(hc.hero, "")
                        or existing_hc_portraits.get(hc.hero, ""),
                    }
                    for hc in patch.hero_changes
                ],
                "general_changes": patch.general_changes,
            }
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
    return any("\uac00" <= c <= "\ud7a3" for c in (text or ""))


def _translate_patch_data(data: dict, existing: dict | None = None) -> dict:
    """패치 노트 한국어 처리.

    translation_source 필드로 번역 출처를 구분:
    - "official": Blizzard 공식 한국어 패치노트 (우선)
    - "llm": 영어 원문을 LLM으로 번역한 결과

    공식 한국어가 올라오면 기존 LLM 번역을 교체한다.
    """
    from bot.utils.glossary import get_korean_name

    def _fix_hero_names(patch: dict) -> None:
        """영어로 남아있는 영웅명을 glossary/heroes 기반으로 한국어로 교체."""
        for hc in patch.get("hero_changes", []):
            if not _has_korean(hc.get("hero", "")):
                kr = get_korean_name(hc["hero"])
                if kr:
                    hc["hero"] = kr

    def _sync_is_stadium(target: dict, source: dict) -> None:
        """신규 크롤링의 is_stadium 값을 기존 데이터에 동기화 (영웅명 매칭)."""
        source_map = {
            hc.get("hero", ""): hc.get("is_stadium", False) for hc in source.get("hero_changes", [])
        }
        if not source_map:
            return
        for hc in target.get("hero_changes", []):
            hero = hc.get("hero", "")
            if hero in source_map:
                hc["is_stadium"] = source_map[hero]

    same_date = existing and existing.get("date") == data.get("date")

    # 크롤링 원본이 공식 한국어인지 판단 (제목 기준)
    # 번역 비용이 없으므로 항상 신규 크롤링 데이터를 사용해 is_stadium 등 최신 반영
    if _has_korean(data.get("title", "")):
        src = existing.get("translation_source", "-") if existing else "-"
        logger.info(f"  패치 공식 한국어 적용: {data.get('date')} (기존: {src})")
        _fix_hero_names(data)
        data["translation_source"] = "official"
        return data

    # 원본이 영어 → 기존 번역(LLM·official 모두) 재사용 + is_stadium 동기화
    if same_date and _has_korean(existing.get("title", "")) and existing.get("hero_changes"):
        src = existing.get("translation_source", "unknown")
        logger.info(f"  패치 스킵: {data.get('date')} 기존 번역 재사용 ({src})")
        _fix_hero_names(existing)
        _sync_is_stadium(existing, data)
        return existing

    # LLM 번역 진행
    logger.info("  패치 LLM 번역 시작")
    from bot.utils.translator import translate, translate_list

    if not _has_korean(data["title"]):
        data["title"] = translate(data["title"])

    for hc in data["hero_changes"]:
        hero_raw = hc["hero"]
        if not _has_korean(hero_raw):
            # glossary/heroes 우선, 없으면 LLM
            kr = get_korean_name(hero_raw)
            hc["hero"] = kr if kr else translate(hero_raw)

        # 이미 한국어인 항목은 건너뛰고 영어 항목만 번역
        indices = [i for i, c in enumerate(hc["changes"]) if not _has_korean(c)]
        if indices:
            texts = [hc["changes"][i] for i in indices]
            translated = translate_list(
                texts,
                label=f"패치노트 번역 ({hc['hero']})",
                heroes=[hero_raw],
            )
            for idx, t in zip(indices, translated, strict=False):
                hc["changes"][idx] = t

    general_indices = [i for i, c in enumerate(data["general_changes"]) if not _has_korean(c)]
    if general_indices:
        texts = [data["general_changes"][i] for i in general_indices]
        translated = translate_list(texts, label="패치노트 공통 변경사항 번역")
        for idx, t in zip(general_indices, translated, strict=False):
            data["general_changes"][idx] = t

    data["translation_source"] = "llm"
    logger.info("  패치 LLM 번역 완료")
    return data


def _translate_stadium_data(by_hero: dict, force: bool = False) -> dict:
    """스타디움 빌드 이름(번역)·설명(3줄 요약)·아이템 이름/효과 한국어 처리.

    빌드는 `code`, 아이템은 `name_en`을 캐시 키로 삼아 기존 stadium.json에
    이미 번역된 내용이 있으면 재사용한다 (재실행 시 중복 LLM 호출 방지).
    """
    from bot.utils.translator import summarize_list, translate_list, translate_stadium_names

    # 기존 stadium.json에서 이미 번역된 내용 로드 (재실행 시 중복 처리 방지)
    # force=True 시 캐시 무시 → 전체 재번역
    prev: dict[str, dict] = {}
    item_prev: dict[str, dict] = {}
    if not force:
        existing = _load(DOCS_DATA / "stadium.json")
        if isinstance(existing, dict):
            for builds in existing.values():
                for b in builds:
                    code = b.get("code", "")
                    name = b.get("name", "")
                    if code and _has_korean(name):
                        prev[code] = {"name": name, "description": b.get("description", "")}
                    for it in b.get("items", []):
                        name_en = it.get("name_en", "")
                        if name_en and _has_korean(it.get("name", "")):
                            item_prev.setdefault(
                                name_en, {"name": it["name"], "effect": it.get("effect", "")}
                            )

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
        unique_heroes = list(dict.fromkeys(new_build_heroes))  # 순서 유지 중복 제거

        logger.info(f"  스타디움 신규 처리: {len(new_builds)}건 (이름 번역 + 설명 요약)")
        translated_names = translate_stadium_names(names, heroes=unique_heroes)
        summarized_descs = summarize_list(
            descs, label="스타디움 빌드 설명 요약", heroes=unique_heroes
        )

        for build, name, desc in zip(new_builds, translated_names, summarized_descs, strict=False):
            build["name"] = name
            build["description"] = desc

    logger.info(f"  스타디움 번역: 신규 {len(new_builds)}건, 캐시 재사용 {len(prev)}건")

    # 아이템 이름/효과 번역 (전체 빌드에서 고유 아이템만 name_en 기준으로 수집)
    all_items = [
        it for builds in by_hero.values() for build in builds for it in build.get("items", [])
    ]
    unique_new_items: dict[str, dict] = {}
    for it in all_items:
        name_en = it.get("name_en", "")
        if name_en and name_en not in item_prev and name_en not in unique_new_items:
            unique_new_items[name_en] = it

    if unique_new_items:
        item_names = list(unique_new_items.keys())
        item_effects = [it.get("effect_en") or "" for it in unique_new_items.values()]

        logger.info(f"  스타디움 아이템 신규 처리: {len(item_names)}건 (이름/효과 번역)")
        translated_item_names = translate_list(item_names, label="스타디움 아이템 이름 번역")
        translated_item_effects = translate_list(item_effects, label="스타디움 아이템 효과 번역")

        for name_en, tname, teffect in zip(
            item_names, translated_item_names, translated_item_effects, strict=False
        ):
            item_prev[name_en] = {"name": tname, "effect": teffect}

    for it in all_items:
        cached = item_prev.get(it.get("name_en", ""))
        if cached:
            it["name"] = cached["name"]
            it["effect"] = cached["effect"]
        else:
            it["name"] = it.get("name_en", "")
            it["effect"] = it.get("effect_en") or ""

    logger.info(
        f"  스타디움 아이템 번역: 신규 {len(unique_new_items)}건, "
        f"캐시 재사용 {len(item_prev) - len(unique_new_items)}건"
    )
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

    has_ban_rate = False
    async with aiohttp.ClientSession() as session:
        # 1. 메타 통계
        all_ranks = await _generate_meta(session)
        if all_ranks:
            sources["meta"] = "live"
            has_ban_rate = any(
                h.get("ban_rate", 0) > 0 for heroes in all_ranks.values() for h in heroes
            )
            _update_history(all_ranks)
            _sync_heroes_json(all_ranks)
        else:
            sources["meta"] = "fallback"
            logger.warning("  메타 전체 실패 — history 갱신 건너뜀")

        # 2. 맵별 메타
        sources["map_meta"] = "live" if await _generate_map_meta(session) else "fallback"

        # 3. 스타디움 빌드
        stadium_ok = await _generate_stadium(session, force=args.force_stadium)
        sources["stadium"] = "live" if stadium_ok else "fallback"

        # 4. 패치 노트 (메타 portrait_url을 영웅명 기준으로 전달)
        portrait_by_name: dict[str, str] = {}
        if all_ranks:
            for heroes in all_ranks.values():
                for h in heroes:
                    name = h.get("hero_name", "")
                    if name and h.get("portrait_url") and name not in portrait_by_name:
                        portrait_by_name[name] = h["portrait_url"]
        patch_ok = await _generate_patch(session, portrait_by_name=portrait_by_name)
        sources["patch"] = "live" if patch_ok else "fallback"

    # 4. 영웅 DB 복사
    _copy_heroes()

    # 5. last_updated.json
    _save(
        DOCS_DATA / "last_updated.json",
        {
            "timestamp": datetime.now(UTC).isoformat(),
            "sources": sources,
            "has_ban_rate": has_ban_rate,
        },
    )

    logger.info(f"=== 완료: {sources} ===")


if __name__ == "__main__":
    asyncio.run(main())
