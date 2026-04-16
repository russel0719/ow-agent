"""
메타 통계 스크래퍼.

수집 순서:
1. overwatch.blizzard.com/ko-kr/rates/ 크롤링 (픽률, 승률)
2. 실패 시 data/meta_baseline.json fallback

메타 점수 공식:
  win_score  = clamp((win_rate  - 40) / 20, 0, 1) × 100  # 40% → 0, 60% → 100
  pick_score = (pick_rate / 최대픽률) × 100

  meta_score = win_score × 0.60 + pick_score × 0.40
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BLIZZARD_RATES_URL = "https://overwatch.blizzard.com/ko-kr/rates/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
FALLBACK_PATH = Path(__file__).parent.parent.parent.parent / "data" / "meta_baseline.json"

# 한국어 랭크명 → Blizzard 파라미터 값
RANK_PARAM: dict[str, str] = {
    "전체": "All",
    "브론즈": "Bronze",
    "실버": "Silver",
    "골드": "Gold",
    "플래티넘": "Platinum",
    "다이아몬드": "Diamond",
    "마스터": "Master",
    "그랜드마스터": "Grandmaster",
    "챔피언": "Grandmaster",  # 챔피언은 그랜드마스터로 통합
}

# Blizzard role 값 → 내부 role 키
ROLE_MAP = {
    "TANK": "tank",
    "DAMAGE": "damage",
    "SUPPORT": "support",
    "Tank": "tank",
    "Damage": "damage",
    "Support": "support",
}


@dataclass
class HeroMeta:
    hero_id: str          # heroes.json 키와 동일
    hero_name: str
    role: str
    pick_rate: float      # %
    win_rate: float       # %
    ban_rate: float       # % (Blizzard 데이터에 없으므로 항상 0.0)
    meta_score: float = field(init=False, default=0.0)
    tier: str = field(init=False, default="C")

    def __post_init__(self):
        self.meta_score = 0.0
        self.tier = "C"


async def fetch_meta(
    session: aiohttp.ClientSession,
    rank: str = "전체",
) -> list[HeroMeta] | None:
    """Blizzard 공식 사이트에서 메타 통계를 가져옵니다. 실패 시 None."""
    tier_val = RANK_PARAM.get(rank, "All")
    params = {
        "input": "PC",
        "map": "all-maps",
        "region": "Asia",
        "role": "All",
        "rq": "2",      # 경쟁전 - 역할 고정
        "tier": tier_val,
    }

    try:
        async with session.get(
            BLIZZARD_RATES_URL,
            params=params,
            headers=HEADERS,
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            resp.raise_for_status()
            html = await resp.text()

        heroes = _parse_blizzard_rates(html)
        if heroes:
            return _calculate_scores(heroes)
        logger.warning("Blizzard 데이터 파싱 결과 없음")
    except Exception as e:
        logger.warning(f"Blizzard 메타 스크래핑 실패: {e}")

    return None


def load_fallback(rank: str = "전체") -> list[HeroMeta]:
    """하드코딩 baseline 데이터 로드 및 점수 계산."""
    if not FALLBACK_PATH.exists():
        return []
    try:
        with FALLBACK_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        tier_data = data.get(rank, data.get("전체", []))
        heroes = [
            HeroMeta(
                hero_id=d["hero_id"],
                hero_name=d["hero_name"],
                role=d["role"],
                pick_rate=d["pick_rate"],
                win_rate=d["win_rate"],
                ban_rate=d.get("ban_rate", 0.0),
            )
            for d in tier_data
        ]
        return _calculate_scores(heroes)
    except Exception as e:
        logger.warning(f"Fallback 로드 실패: {e}")
        return []


def _parse_blizzard_rates(html: str) -> list[HeroMeta]:
    """Blizzard 공식 통계 페이지 HTML에서 영웅 통계 파싱.

    blz-data-table 요소의 allrows 속성에 JSON 데이터가 내장되어 있음.
    형식: [{"id": "ana", "cells": {"name": "아나", "pickrate": 39, "winrate": 47.1},
             "hero": {"role": "SUPPORT", ...}}, ...]
    """
    soup = BeautifulSoup(html, "lxml")

    # blz-data-table의 allrows 속성에서 JSON 추출
    table = soup.find(class_="herostats-data-table")
    if not table:
        table = soup.find("blz-data-table")
    if not table:
        logger.warning("herostats-data-table 요소를 찾을 수 없음")
        return []

    allrows_json = table.get("allrows", "")
    if not allrows_json:
        logger.warning("allrows 속성이 비어있음")
        return []

    try:
        rows = json.loads(allrows_json)
    except json.JSONDecodeError as e:
        logger.warning(f"allrows JSON 파싱 실패: {e}")
        return []

    heroes: list[HeroMeta] = []
    for row in rows:
        try:
            cells = row.get("cells", {})
            hero_info = row.get("hero", {})

            pick_rate = cells.get("pickrate", -1)
            win_rate = cells.get("winrate", -1)

            # 데이터 없는 영웅 스킵 (-1은 데이터 없음)
            if pick_rate < 0 or win_rate < 0:
                continue

            hero_name_ko = cells.get("name", "")
            hero_id_raw = row.get("id", "")
            hero_id = _blizzard_id_to_key(hero_id_raw)
            role_raw = hero_info.get("role", "")
            role = ROLE_MAP.get(role_raw, "damage")

            heroes.append(
                HeroMeta(
                    hero_id=hero_id,
                    hero_name=hero_name_ko,
                    role=role,
                    pick_rate=float(pick_rate),
                    win_rate=float(win_rate),
                    ban_rate=0.0,  # Blizzard는 밴률 미제공
                )
            )
        except Exception:
            continue

    return heroes


def _calculate_scores(heroes: list[HeroMeta]) -> list[HeroMeta]:
    """전체 영웅 대비 정규화 후 메타 점수와 티어 할당."""
    if not heroes:
        return heroes

    max_pick = max((h.pick_rate for h in heroes), default=1) or 1

    for h in heroes:
        win_score = max(0.0, min(1.0, (h.win_rate - 40) / 20)) * 100
        pick_score = (h.pick_rate / max_pick) * 100

        # ban_rate 데이터가 없으므로 win/pick 비율로만 계산
        h.meta_score = round(win_score * 0.60 + pick_score * 0.40, 1)
        h.tier = _score_to_tier(h.meta_score)

    return sorted(heroes, key=lambda h: h.meta_score, reverse=True)


def _score_to_tier(score: float) -> str:
    if score >= 75:
        return "S"
    if score >= 55:
        return "A"
    if score >= 35:
        return "B"
    if score >= 15:
        return "C"
    return "D"


def _blizzard_id_to_key(blizzard_id: str) -> str:
    """Blizzard ID (예: 'wrecking-ball') → heroes.json 키 변환."""
    mapping = {
        "wrecking-ball": "wrecking_ball",
        "junker-queen": "junker_queen",
        "soldier-76": "soldier76",
        "jetpack-cat": "jetpack_cat",
    }
    if blizzard_id in mapping:
        return mapping[blizzard_id]
    # 하이픈을 언더스코어로, 소문자로
    return blizzard_id.lower().replace("-", "_")


def meta_dict(heroes: list[HeroMeta]) -> dict[str, dict]:
    """hero_id → 메타 정보 dict 변환 (recommend.py에서 사용)."""
    return {
        h.hero_id: {
            "meta_score": h.meta_score,
            "pick_rate": h.pick_rate,
            "win_rate": h.win_rate,
            "ban_rate": h.ban_rate,
            "tier": h.tier,
        }
        for h in heroes
    }
