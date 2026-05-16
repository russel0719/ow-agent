"""
메타 통계 스크래퍼.

수집 순서:
1. overwatch.blizzard.com/ko-kr/rates/data/ JSON API 호출
   - rq=1: 역할 고정 경쟁전 (픽률·승률·밴률 모두 포함)
   - rq=2/3: 빠른대전 (밴률 없음 — 사용 안 함)
2. 실패 시 data/meta_baseline.json fallback

메타 점수 공식 (밴 데이터 있을 때):
  win_score  = clamp((win_rate  - 40) / 20, 0, 1) × 100
  pick_score = (pick_rate / 최대픽률) × 100
  ban_score  = (ban_rate / 최대밴률) × 100

  meta_score = win_score × 0.55 + pick_score × 0.25 + ban_score × 0.20

메타 점수 공식 (밴 데이터 없을 때 fallback):
  meta_score = win_score × 0.60 + pick_score × 0.40
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp

logger = logging.getLogger(__name__)

BLIZZARD_RATES_URL = "https://overwatch.blizzard.com/ko-kr/rates/data/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Accept": "application/json, text/html;q=0.9",
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
    ban_rate: float       # % (Blizzard 제공 시 실제값, 미제공 시 0.0)
    portrait_url: str = ""  # Blizzard CDN 초상화 URL
    meta_score: float    = field(init=False, default=0.0)
    tier: str            = field(init=False, default="C")
    presence_rate: float = field(init=False, default=0.0)   # pick_rate + ban_rate
    ban_efficiency: float = field(init=False, default=0.0)  # ban 가치 지수

    def __post_init__(self):
        self.meta_score = 0.0
        self.tier = "C"


async def fetch_meta(
    session: aiohttp.ClientSession,
    rank: str = "전체",
    map_id: str = "all-maps",
) -> list[HeroMeta] | None:
    """Blizzard 공식 사이트에서 메타 통계를 가져옵니다. 실패 시 None.

    rq=1: 역할 고정 경쟁전 — 픽률·승률·밴률 모두 포함.
    """
    tier_val = RANK_PARAM.get(rank, "All")
    params = {
        "input": "PC",
        "map": map_id,
        "region": "Asia",
        "role": "All",
        "rq": "1",      # 경쟁전 - 역할 고정 (밴률 포함)
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
            data = await resp.json(content_type=None)

        rates = data.get("rates", [])
        if isinstance(rates, dict):
            rates = rates.get("rates", [])
        heroes = _parse_rows(rates)
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


def _parse_rows(rows: list) -> list[HeroMeta]:
    """Blizzard JSON API rates 배열에서 HeroMeta 목록 생성.

    형식: [{"id": "ana", "cells": {"name": "아나", "pickrate": 39, "winrate": 47.1},
             "hero": {"role": "SUPPORT", "portrait": "https://..."}}, ...]
    """
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
            portrait_url = hero_info.get("portrait", "")

            ban_rate_raw = cells.get("banrate", -1)
            ban_rate = float(ban_rate_raw) if isinstance(ban_rate_raw, (int, float)) and ban_rate_raw >= 0 else 0.0

            heroes.append(
                HeroMeta(
                    hero_id=hero_id,
                    hero_name=hero_name_ko,
                    role=role,
                    pick_rate=float(pick_rate),
                    win_rate=float(win_rate),
                    ban_rate=ban_rate,
                    portrait_url=portrait_url,
                )
            )
        except Exception:
            continue

    return heroes


def _calculate_scores(heroes: list[HeroMeta]) -> list[HeroMeta]:
    """전체 영웅 대비 정규화 후 메타 점수와 파생 지수 할당."""
    if not heroes:
        return heroes

    max_pick = max((h.pick_rate for h in heroes), default=1) or 1
    has_ban = any(h.ban_rate > 0 for h in heroes)

    if has_ban:
        max_ban = max(h.ban_rate for h in heroes) or 1
        max_ban_eff_raw = max(h.ban_rate * (h.win_rate / 50) for h in heroes) or 1

    for h in heroes:
        win_score  = max(0.0, min(1.0, (h.win_rate - 40) / 20)) * 100
        pick_score = (h.pick_rate / max_pick) * 100

        if has_ban:
            ban_score       = (h.ban_rate / max_ban) * 100
            # 통합 메타 지수: 승률 55% + 픽률 25% + 밴률 20%
            h.meta_score    = round(win_score * 0.55 + pick_score * 0.25 + ban_score * 0.20, 1)
            # 존재감 지수: 픽률 + 밴률 (최대 100%)
            h.presence_rate = round(min(h.pick_rate + h.ban_rate, 100.0), 1)
            # 밴 효율 지수: ban × (win/50) 정규화
            ban_eff_raw      = h.ban_rate * (h.win_rate / 50)
            h.ban_efficiency = round((ban_eff_raw / max_ban_eff_raw) * 100, 1)
        else:
            # fallback: 밴 데이터 없을 때 기존 공식
            h.meta_score    = round(win_score * 0.60 + pick_score * 0.40, 1)
            h.presence_rate = round(h.pick_rate, 1)
            h.ban_efficiency = 0.0

        h.tier = _score_to_tier(h.meta_score)

    return sorted(heroes, key=lambda h: h.meta_score, reverse=True)


def _score_to_tier(score: float) -> str:
    if score >= 75:
        return "S"
    if score >= 45:
        return "A"
    if score >= 35:
        return "B"
    if score >= 22:
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
