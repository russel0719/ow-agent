"""
스타디움 모드 빌드 스크래퍼.

수집 순서:
1. Reddit r/OverwatchUniversity / r/Overwatch 검색 (JSON API, 인증 불필요)
2. 실패 시 data/stadium_builds.json 하드코딩 fallback
"""
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp

logger = logging.getLogger(__name__)

FALLBACK_PATH = Path(__file__).parent.parent.parent.parent / "data" / "stadium_builds.json"

REDDIT_SEARCH_URL = "https://www.reddit.com/search.json"
REDDIT_HEADERS = {
    "User-Agent": "ow-discord-bot/1.0 (by /u/owbotdev)"
}


@dataclass
class StadiumBuild:
    hero: str
    name: str
    code: str
    description: str
    playstyle: str
    source: str = "커뮤니티"
    upvotes: int = 0


async def fetch_builds(session: aiohttp.ClientSession, hero: str) -> list[StadiumBuild]:
    """영웅 이름으로 스타디움 빌드를 Reddit에서 검색."""
    builds = await _search_reddit(session, hero)
    if builds:
        return builds

    logger.info(f"Reddit 검색 결과 없음, fallback 사용: {hero}")
    return _load_fallback(hero)


async def _search_reddit(session: aiohttp.ClientSession, hero: str) -> list[StadiumBuild]:
    params = {
        "q": f"overwatch stadium build {hero} code",
        "sort": "relevance",
        "t": "month",
        "limit": 10,
        "type": "link",
    }
    try:
        async with session.get(
            REDDIT_SEARCH_URL,
            params=params,
            headers=REDDIT_HEADERS,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
    except Exception as e:
        logger.warning(f"Reddit 검색 실패: {e}")
        return []

    builds: list[StadiumBuild] = []
    posts = data.get("data", {}).get("children", [])

    for post in posts:
        p = post.get("data", {})
        title: str = p.get("title", "")
        selftext: str = p.get("selftext", "")
        score: int = p.get("score", 0)
        url: str = p.get("url", "")

        content = f"{title}\n{selftext}"
        codes = _extract_codes(content)
        if not codes:
            continue

        hero_lower = hero.lower()
        if hero_lower not in title.lower() and hero_lower not in selftext.lower():
            continue

        for code in codes[:2]:  # 게시글당 최대 2개 코드
            build_name = _extract_build_name(title) or f"{hero.title()} 빌드"
            description = _trim(selftext, 200) or title
            builds.append(
                StadiumBuild(
                    hero=hero,
                    name=build_name,
                    code=code,
                    description=description,
                    playstyle=_infer_playstyle(title + selftext),
                    source=f"Reddit ({url})",
                    upvotes=score,
                )
            )

    # 추천수 기준 정렬
    builds.sort(key=lambda b: b.upvotes, reverse=True)
    return builds[:5]


def _extract_codes(text: str) -> list[str]:
    """빌드 코드 패턴 추출 (예: ABCD-1234, XXXX-YYYY)."""
    patterns = [
        r"\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b",
        r"\b([A-Z]{4,8}[0-9]{2,4})\b",
    ]
    found = []
    for pat in patterns:
        found.extend(re.findall(pat, text, re.IGNORECASE))
    return list(dict.fromkeys(found))  # 중복 제거


def _extract_build_name(title: str) -> str:
    # 대괄호 안의 내용 추출
    m = re.search(r"\[([^\]]+)\]", title)
    if m:
        return m.group(1)
    # "build" 앞의 단어들
    m = re.search(r"([\w\s]+)\s+build", title, re.IGNORECASE)
    if m:
        return m.group(1).strip().title()
    return ""


def _infer_playstyle(text: str) -> str:
    text = text.lower()
    if any(w in text for w in ["aggressive", "dive", "공격", "돌진"]):
        return "공격형"
    if any(w in text for w in ["tank", "bruiser", "버티기", "생존"]):
        return "생존형"
    if any(w in text for w in ["poke", "range", "원거리", "딜"]):
        return "딜형"
    return "균형형"


def _trim(text: str, max_len: int) -> str:
    text = text.strip().replace("\n", " ")
    return text[:max_len] + "..." if len(text) > max_len else text


def _load_fallback(hero: str) -> list[StadiumBuild]:
    """하드코딩 fallback 데이터 로드."""
    if not FALLBACK_PATH.exists():
        return []
    try:
        with FALLBACK_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        hero_lower = hero.lower()
        return [
            StadiumBuild(**b)
            for b in data.get("builds", [])
            if b.get("hero", "").lower() == hero_lower
        ]
    except Exception as e:
        logger.warning(f"Fallback 로드 실패: {e}")
        return []
