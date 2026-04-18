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
from datetime import datetime, timedelta

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


def _parse_korean_date(date_str: str) -> datetime | None:
    """'2026년 4월 17일' 형식 → datetime. 파싱 실패 시 None."""
    m = re.match(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', date_str)
    if m:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


async def fetch_recent_patches(
    session: aiohttp.ClientSession, days: int = 14
) -> list[PatchNote]:
    """최근 N일 이내 패치 목록 반환."""
    try:
        async with session.get(
            PATCH_URL, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)
        ) as resp:
            resp.raise_for_status()
            html = await resp.text()
    except Exception as e:
        logger.error(f"패치노트 페이지 로드 실패: {e}")
        return []

    return _parse_patches(html, days)


async def fetch_latest_patch(session: aiohttp.ClientSession) -> PatchNote | None:
    """최신 패치 1개 반환 (하위 호환용)."""
    patches = await fetch_recent_patches(session, days=365)
    return patches[0] if patches else None


def _parse_patches(html: str, days: int = 30) -> list[PatchNote]:
    """HTML에서 최근 N일 이내 패치 목록 파싱."""
    soup = BeautifulSoup(html, "lxml")
    cutoff = datetime.now() - timedelta(days=days)

    patch_els = soup.find_all(class_="PatchNotes-patch")
    if not patch_els:
        logger.warning("PatchNotes-patch 요소를 찾을 수 없음")
        note = _fallback_parse(soup)
        return [note] if note else []

    result: list[PatchNote] = []
    for patch_el in patch_els:
        note = _parse_single_patch(patch_el)
        if not note:
            continue
        parsed_date = _parse_korean_date(note.date)
        # 날짜 파싱 실패 시 안전하게 포함, 파싱 성공 시 cutoff 이후만 포함
        if parsed_date is None or parsed_date >= cutoff:
            result.append(note)

    return result


def _parse_single_patch(patch_el) -> PatchNote | None:
    """단일 PatchNotes-patch 요소 → PatchNote."""
    title_el = patch_el.find(class_="PatchNotes-patchTitle")
    date_el = patch_el.find(class_="PatchNotes-labels")

    title = title_el.get_text(strip=True) if title_el else "패치"
    date = date_el.get_text(strip=True) if date_el else ""

    hero_changes: list[HeroChange] = []
    general_changes: list[str] = []
    in_stadium = False

    for section in patch_el.find_all(class_="PatchNotes-section"):
        section_classes = section.get("class", [])

        if "PatchNotes-section-generic_update" in section_classes:
            section_title_el = section.find("h4")
            if section_title_el:
                section_title = section_title_el.get_text(strip=True).lower()
                in_stadium = "stadium" in section_title or "스타디움" in section_title
            items = section.find_all("li")
            for item in items[:5]:
                text = item.get_text(strip=True)
                if text and len(text) > 5:
                    general_changes.append(text)
            continue

        if "PatchNotes-section-hero_update" in section_classes:
            hero_updates = section.find_all(class_="PatchNotesHeroUpdate")
            for hu in hero_updates:
                name_el = hu.find(class_="PatchNotesHeroUpdate-name")
                if not name_el:
                    continue
                hero_name = name_el.get_text(strip=True)
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

    ability_updates = hero_update_el.find_all(class_="PatchNotesAbilityUpdate")
    for au in ability_updates:
        name_el = au.find(class_="PatchNotesAbilityUpdate-name")
        text_el = au.find(class_="PatchNotesAbilityUpdate-text")
        detail_list = au.find_all("li")

        ability_name = name_el.get_text(strip=True) if name_el else ""

        if ability_name:
            from bot.utils.glossary import get_ability_key
            key = get_ability_key(ability_name)
            ability_label = f"{ability_name} ({key})" if key else ability_name
        else:
            ability_label = ""

        if detail_list:
            for li in detail_list:
                text = li.get_text(strip=True)
                if text:
                    prefix = f"{ability_label}: " if ability_label else ""
                    changes.append(f"{prefix}{text}"[:150])
        elif text_el:
            text = text_el.get_text(strip=True)
            if text:
                prefix = f"{ability_label}: " if ability_label else ""
                changes.append(f"{prefix}{text}"[:150])

    if not changes:
        body_el = hero_update_el.find(class_="PatchNotesHeroUpdate-body")
        if body_el:
            items = body_el.find_all("li")
            for item in items[:5]:
                text = item.get_text(strip=True)
                if text:
                    changes.append(text[:150])

        if not changes:
            dev_el = hero_update_el.find(class_="PatchNotesHeroUpdate-dev")
            if dev_el:
                text = dev_el.get_text(strip=True)
                if text:
                    changes.append(text[:200])

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
