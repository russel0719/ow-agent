import logging
import re
from dataclasses import dataclass, field

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

PATCH_URL = "https://overwatch.blizzard.com/en-us/news/patch-notes/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


@dataclass
class HeroChange:
    hero: str
    changes: list[str] = field(default_factory=list)


@dataclass
class PatchNote:
    title: str
    date: str
    url: str
    hero_changes: list[HeroChange] = field(default_factory=list)
    general_changes: list[str] = field(default_factory=list)


async def fetch_latest_patch(session: aiohttp.ClientSession) -> PatchNote | None:
    try:
        async with session.get(PATCH_URL, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            resp.raise_for_status()
            html = await resp.text()
    except Exception as e:
        logger.error(f"패치노트 페이지 로드 실패: {e}")
        return None

    return _parse_patch(html)


def _parse_patch(html: str) -> PatchNote | None:
    soup = BeautifulSoup(html, "lxml")

    # 패치 섹션 탐색 (첫 번째 패치)
    patch_section = soup.select_one(".PatchNotes-patch, .patch-notes-patch, [class*='patch']")

    # 제목과 날짜 추출
    title_el = soup.select_one("h1.PatchNotes-patchTitle, .patch-notes-patch-title, h1")
    date_el = soup.select_one(".PatchNotes-patchTitle + *, time, .patch-date, [class*='date']")

    title = title_el.get_text(strip=True) if title_el else "최신 패치"
    date = date_el.get_text(strip=True) if date_el else ""

    # 영웅별 변경 사항 파싱
    hero_changes: list[HeroChange] = []
    general_changes: list[str] = []

    # 영웅 섹션 탐색 (여러 구조 대응)
    hero_sections = soup.select(".HeroChange, .hero-change, [class*='HeroChange']")

    if hero_sections:
        for section in hero_sections:
            name_el = section.select_one("h4, h3, .hero-name, [class*='name']")
            if not name_el:
                continue
            hero_name = name_el.get_text(strip=True)
            changes = [li.get_text(strip=True) for li in section.select("li") if li.get_text(strip=True)]
            if changes:
                hero_changes.append(HeroChange(hero=hero_name, changes=changes))
    else:
        # 구조가 다를 경우 fallback: 모든 li 태그 수집
        items = soup.select("ul li")
        for item in items[:20]:
            text = item.get_text(strip=True)
            if text:
                general_changes.append(text)

    return PatchNote(
        title=title,
        date=date,
        url=PATCH_URL,
        hero_changes=hero_changes,
        general_changes=general_changes,
    )


def filter_by_hero(patch: PatchNote, hero_name: str) -> list[HeroChange]:
    """특정 영웅 이름이 포함된 변경 사항만 필터링."""
    keyword = hero_name.lower()
    return [hc for hc in patch.hero_changes if keyword in hc.hero.lower()]
