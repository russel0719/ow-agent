"""
패치 노트 스크래퍼.

수집 대상: https://overwatch.blizzard.com/ko-kr/news/patch-notes/
구조:
  - div.PatchNotes-patch → 각 패치
  - div.PatchNotes-labels → 날짜
  - h3.PatchNotes-patchTitle → 패치 제목
  - div.PatchNotes-section-hero_update → 역할별 영웅 변경 섹션
    - div.PatchNotesHeroUpdate → 영웅별 변경 사항
      - div.PatchNotesHeroUpdate-name → 영웅 이름
      - div.PatchNotesAbilityUpdate → 능력 변경 세부사항
"""
import logging
import re
from dataclasses import dataclass, field

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

PATCH_URL = "https://overwatch.blizzard.com/ko-kr/news/patch-notes/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}


@dataclass
class HeroChange:
    hero: str
    changes: list[str] = field(default_factory=list)
    is_stadium: bool = False  # 스타디움 모드 변경인지 여부


@dataclass
class PatchNote:
    title: str
    date: str
    url: str
    hero_changes: list[HeroChange] = field(default_factory=list)
    general_changes: list[str] = field(default_factory=list)


async def fetch_latest_patch(session: aiohttp.ClientSession) -> PatchNote | None:
    try:
        async with session.get(
            PATCH_URL, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)
        ) as resp:
            resp.raise_for_status()
            html = await resp.text()
    except Exception as e:
        logger.error(f"패치노트 페이지 로드 실패: {e}")
        return None

    return _parse_patch(html)


def _parse_patch(html: str) -> PatchNote | None:
    soup = BeautifulSoup(html, "lxml")

    # 첫 번째(최신) 패치 섹션
    first_patch = soup.find(class_="PatchNotes-patch")
    if not first_patch:
        logger.warning("PatchNotes-patch 요소를 찾을 수 없음")
        return _fallback_parse(soup)

    # 제목과 날짜
    title_el = first_patch.find(class_="PatchNotes-patchTitle")
    date_el = first_patch.find(class_="PatchNotes-labels")

    title = title_el.get_text(strip=True) if title_el else "최신 패치"
    date = date_el.get_text(strip=True) if date_el else ""

    # 영웅별 변경 사항
    hero_changes: list[HeroChange] = []
    general_changes: list[str] = []

    # 스타디움 섹션 판별: "Stadium" or "스타디움"이 포함된 섹션 제목
    in_stadium = False

    for section in first_patch.find_all(class_="PatchNotes-section"):
        section_classes = section.get("class", [])

        # 일반 업데이트 섹션 (섹션 제목 확인)
        if "PatchNotes-section-generic_update" in section_classes:
            section_title_el = section.find("h4")
            if section_title_el:
                section_title = section_title_el.get_text(strip=True).lower()
                in_stadium = "stadium" in section_title or "스타디움" in section_title
            # 일반 변경 사항 (li 태그)
            items = section.find_all("li")
            for item in items[:5]:
                text = item.get_text(strip=True)
                if text and len(text) > 5:
                    general_changes.append(text)
            continue

        # 영웅 업데이트 섹션
        if "PatchNotes-section-hero_update" in section_classes:
            hero_updates = section.find_all(class_="PatchNotesHeroUpdate")
            for hu in hero_updates:
                name_el = hu.find(class_="PatchNotesHeroUpdate-name")
                if not name_el:
                    continue
                hero_name = name_el.get_text(strip=True)

                # 영웅 변경 내용 추출
                changes = _extract_hero_changes(hu)
                if changes:
                    hero_changes.append(
                        HeroChange(hero=hero_name, changes=changes, is_stadium=in_stadium)
                    )

    return PatchNote(
        title=title,
        date=date,
        url=PATCH_URL,
        hero_changes=hero_changes,
        general_changes=general_changes[:10],
    )


def _extract_hero_changes(hero_update_el) -> list[str]:
    """PatchNotesHeroUpdate 요소에서 변경 사항 텍스트 추출."""
    changes: list[str] = []

    # 능력 변경 사항
    ability_updates = hero_update_el.find_all(class_="PatchNotesAbilityUpdate")
    for au in ability_updates:
        name_el = au.find(class_="PatchNotesAbilityUpdate-name")
        text_el = au.find(class_="PatchNotesAbilityUpdate-text")
        detail_list = au.find_all("li")

        ability_name = name_el.get_text(strip=True) if name_el else ""

        if detail_list:
            for li in detail_list:
                text = li.get_text(strip=True)
                if text:
                    prefix = f"{ability_name}: " if ability_name else ""
                    changes.append(f"{prefix}{text}"[:150])
        elif text_el:
            text = text_el.get_text(strip=True)
            if text:
                prefix = f"{ability_name}: " if ability_name else ""
                changes.append(f"{prefix}{text}"[:150])

    # 일반 변경 사항 (능력 변경 없는 경우)
    if not changes:
        body_el = hero_update_el.find(class_="PatchNotesHeroUpdate-body")
        if body_el:
            items = body_el.find_all("li")
            for item in items[:5]:
                text = item.get_text(strip=True)
                if text:
                    changes.append(text[:150])

        # li도 없으면 dev 코멘트 텍스트
        if not changes:
            dev_el = hero_update_el.find(class_="PatchNotesHeroUpdate-dev")
            if dev_el:
                text = dev_el.get_text(strip=True)
                if text:
                    changes.append(text[:200])

    # 직접 텍스트 노드 (능력/li 없는 단순 텍스트)
    if not changes:
        general_el = hero_update_el.find(class_="PatchNotesHeroUpdate-generalUpdates")
        if general_el:
            text = general_el.get_text(strip=True)
            if text and len(text) > 5:
                changes.append(text[:200])

    return changes[:8]


def _fallback_parse(soup: BeautifulSoup) -> PatchNote | None:
    """구조가 다를 경우 fallback 파싱."""
    title_el = soup.find("h1") or soup.find("h2") or soup.find("h3")
    title = title_el.get_text(strip=True) if title_el else "최신 패치"

    items = soup.select("ul li")
    general_changes = [li.get_text(strip=True) for li in items[:15] if li.get_text(strip=True)]

    return PatchNote(
        title=title,
        date="",
        url=PATCH_URL,
        hero_changes=[],
        general_changes=general_changes,
    )


def filter_by_hero(patch: PatchNote, hero_name: str) -> list[HeroChange]:
    """특정 영웅 이름이 포함된 변경 사항만 필터링."""
    keyword = hero_name.lower()
    return [hc for hc in patch.hero_changes if keyword in hc.hero.lower()]
