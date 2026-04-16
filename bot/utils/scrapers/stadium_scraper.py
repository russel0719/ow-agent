"""
스타디움 모드 빌드 스크래퍼.

수집 순서:
1. stadiumbuilds.io Supabase API 호출
2. 실패 시 data/stadium_builds.json 하드코딩 fallback
"""
import json
import logging
import unicodedata
import re
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp

logger = logging.getLogger(__name__)

FALLBACK_PATH = Path(__file__).parent.parent.parent.parent / "data" / "stadium_builds.json"

SUPABASE_URL = "https://api.stadiumbuilds.io"
# stadiumbuilds.io 사이트의 공개 anon 키 (JS 번들에 노출된 공개 키)
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZHZldG9mYnNveW5rZnBybG9zIiwicm9sZSI6"
    "ImFub24iLCJpYXQiOjE3NDU3Mjc0NDEsImV4cCI6MjA2MTMwMzQ0MX0"
    ".Moy2MzlEQ0w1cqvnMs3qAV6Mzdm8R1v_YSo7Zw93mG8"
)
API_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Accept": "application/json",
}

# 스타디움 미지원 영웅 (API에 없는 영웅)
_HERO_ID_CACHE: dict[str, str] = {}  # 정규화된 영어이름 → supabase hero_id


@dataclass
class StadiumBuild:
    hero: str
    name: str
    code: str
    description: str
    playstyle: str
    source: str = "stadiumbuilds.io"
    upvotes: int = 0


async def fetch_builds(session: aiohttp.ClientSession, hero: str) -> list[StadiumBuild]:
    """영웅 이름으로 스타디움 빌드를 stadiumbuilds.io에서 검색."""
    hero_id = await _resolve_hero_id(session, hero)
    if not hero_id:
        logger.info(f"Supabase에서 영웅 ID 없음: {hero}, fallback 사용")
        return _load_fallback(hero)

    builds = await _fetch_from_supabase(session, hero, hero_id)
    if builds:
        return builds

    logger.info(f"Supabase 빌드 없음, fallback 사용: {hero}")
    return _load_fallback(hero)


async def fetch_all_builds(session: aiohttp.ClientSession) -> list[StadiumBuild]:
    """모든 영웅의 빌드를 가져옵니다. (일일 업데이트용)"""
    heroes = await _fetch_heroes(session)
    all_builds: list[StadiumBuild] = []

    for supa_hero in heroes:
        hero_id = supa_hero["id"]
        hero_name = supa_hero["name"]
        hero_key = _normalize_name(hero_name)

        builds = await _fetch_from_supabase(session, hero_name, hero_id, limit=5)
        all_builds.extend(builds)

    return all_builds


async def _resolve_hero_id(session: aiohttp.ClientSession, hero: str) -> str | None:
    """영웅 이름/별칭에서 Supabase hero_id를 찾습니다."""
    # heroes.json에서 영웅 정보 조회
    try:
        from bot.utils.hero_data import get_hero
        hero_data = get_hero(hero)
        if hero_data:
            en_name = hero_data.get("name", "")
        else:
            en_name = hero
    except Exception:
        en_name = hero

    # Supabase 영웅 목록에서 매칭
    supa_heroes = await _fetch_heroes(session)
    if not supa_heroes:
        return None

    norm_target = _normalize_name(en_name)
    for h in supa_heroes:
        if _normalize_name(h["name"]) == norm_target:
            return h["id"]

    # 부분 일치 시도
    for h in supa_heroes:
        if norm_target in _normalize_name(h["name"]) or _normalize_name(h["name"]) in norm_target:
            return h["id"]

    return None


async def _fetch_heroes(session: aiohttp.ClientSession) -> list[dict]:
    """Supabase에서 스타디움 영웅 목록을 가져옵니다."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/heroes"
        params = {
            "select": "id,name,role",
            "enabled": "eq.true",
            "order": "name.asc",
        }
        async with session.get(
            url, params=params, headers=API_HEADERS,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()
    except Exception as e:
        logger.warning(f"Supabase 영웅 목록 조회 실패: {e}")
        return []


async def _fetch_from_supabase(
    session: aiohttp.ClientSession,
    hero_name: str,
    hero_id: str,
    limit: int = 5,
) -> list[StadiumBuild]:
    """Supabase에서 특정 영웅의 인기 빌드를 가져옵니다."""
    try:
        url = f"{SUPABASE_URL}/rest/v1/builds"
        params = {
            "select": "title,build_code,notes,likes,view_count,hotness_score,build_tag",
            "hero_id": f"eq.{hero_id}",
            "public": "eq.true",
            "build_code": "not.is.null",
            "order": "likes.desc",
            "limit": str(limit),
        }
        async with session.get(
            url, params=params, headers=API_HEADERS,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
    except Exception as e:
        logger.warning(f"Supabase 빌드 조회 실패 ({hero_name}): {e}")
        return []

    builds: list[StadiumBuild] = []
    for item in data:
        code = item.get("build_code") or ""
        if not code:
            continue

        title = item.get("title") or f"{hero_name} 빌드"
        notes = item.get("notes") or ""
        likes = item.get("likes") or 0
        build_tag = item.get("build_tag") or ""

        description = _clean_description(notes, title)
        playstyle = _tag_to_playstyle(build_tag, title + " " + notes)

        builds.append(
            StadiumBuild(
                hero=hero_name,
                name=title[:60],
                code=code,
                description=description,
                playstyle=playstyle,
                source="stadiumbuilds.io",
                upvotes=likes,
            )
        )

    return builds


def _clean_description(notes: str, title: str) -> str:
    """마크다운/특수기호 정리 후 설명 텍스트 반환."""
    if not notes:
        return title[:200]
    # 마크다운 이미지/링크 제거
    text = re.sub(r"!\[.*?\]\(.*?\)", "", notes)
    # 마크다운 헤더/bold 제거
    text = re.sub(r"#{1,6}\s*", "", text)
    text = re.sub(r"\*{1,3}(.*?)\*{1,3}", r"\1", text)
    # 대괄호 이스케이프 제거 (stadiumbuilds 특수 마크업)
    text = re.sub(r"\[(\w[\w\s:_-]*?)\]", r"\1", text)
    # 여러 줄 → 공백
    text = re.sub(r"\n+", " ", text)
    text = text.strip()
    return text[:250] + "..." if len(text) > 250 else text or title[:200]


def _tag_to_playstyle(tag: str, content: str) -> str:
    """build_tag 또는 내용에서 플레이스타일 추론."""
    tag_lower = tag.lower()
    content_lower = content.lower()

    if any(w in tag_lower for w in ["meta", "메타"]):
        return "메타형"
    if any(w in content_lower for w in ["aggressive", "dive", "공격", "돌진", "carry"]):
        return "공격형"
    if any(w in content_lower for w in ["tank", "bruiser", "버티기", "생존", "sustain", "survival"]):
        return "생존형"
    if any(w in content_lower for w in ["poke", "range", "원거리", "dps", "damage"]):
        return "딜형"
    if any(w in content_lower for w in ["heal", "support", "힐", "지원"]):
        return "지원형"
    return "균형형"


def _normalize_name(name: str) -> str:
    """영웅 이름 정규화 (특수문자, 공백 제거, 소문자)."""
    normalized = unicodedata.normalize("NFD", name)
    ascii_str = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_str.lower())


def _load_fallback(hero: str) -> list[StadiumBuild]:
    """하드코딩 fallback 데이터 로드."""
    if not FALLBACK_PATH.exists():
        return []
    try:
        with FALLBACK_PATH.open(encoding="utf-8") as f:
            data = json.load(f)

        # heroes.json을 통해 영문 이름 해석 시도
        try:
            from bot.utils.hero_data import get_hero
            hero_data = get_hero(hero)
            en_name = hero_data.get("name", hero) if hero_data else hero
        except Exception:
            en_name = hero

        norm_en = _normalize_name(en_name)
        norm_raw = _normalize_name(hero)

        return [
            StadiumBuild(**b)
            for b in data.get("builds", [])
            if _normalize_name(b.get("hero", "")) in {norm_en, norm_raw}
        ]
    except Exception as e:
        logger.warning(f"Fallback 로드 실패: {e}")
        return []
