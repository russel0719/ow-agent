"""
메타 통계 스크래퍼.

수집 순서:
1. overbuff.com HTML 스크래핑 (픽률, 승률, 밴률)
2. 실패 시 data/meta_baseline.json fallback

메타 점수 공식:
  win_score  = clamp((win_rate  - 40) / 20, 0, 1) × 100  # 40% → 0, 60% → 100
  pick_score = (pick_rate / 최대픽률) × 100
  ban_score  = (ban_rate  / 최대밴률) × 100  (밴률 데이터 없으면 0)

  meta_score = win_score × 0.45 + pick_score × 0.30 + ban_score × 0.25
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

OVERBUFF_URL = "https://www.overbuff.com/heroes"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
FALLBACK_PATH = Path(__file__).parent.parent.parent.parent / "data" / "meta_baseline.json"

RANK_PARAM: dict[str, str] = {
    "전체": "",
    "브론즈": "bronze",
    "실버": "silver",
    "골드": "gold",
    "플래티넘": "platinum",
    "다이아몬드": "diamond",
    "마스터": "master",
    "그랜드마스터": "grandmaster",
    "챔피언": "champion",
}


@dataclass
class HeroMeta:
    hero_id: str          # heroes.json 키와 동일
    hero_name: str
    role: str
    pick_rate: float      # %
    win_rate: float       # %
    ban_rate: float       # % (없으면 0.0)
    meta_score: float = field(init=False, default=0.0)
    tier: str = field(init=False, default="C")

    def __post_init__(self):
        self.meta_score = 0.0
        self.tier = "C"


async def fetch_meta(
    session: aiohttp.ClientSession,
    rank: str = "전체",
) -> list[HeroMeta] | None:
    """overbuff에서 메타 통계를 가져옵니다. 실패 시 None."""
    rank_val = RANK_PARAM.get(rank, "")
    params: dict[str, str] = {"platform": "pc", "mode": "competitive"}
    if rank_val:
        params["rank"] = rank_val

    try:
        async with session.get(
            OVERBUFF_URL,
            params=params,
            headers=HEADERS,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            html = await resp.text()
        heroes = _parse_overbuff(html)
        if heroes:
            return _calculate_scores(heroes)
    except Exception as e:
        logger.warning(f"overbuff 스크래핑 실패: {e}")

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


def _parse_overbuff(html: str) -> list[HeroMeta]:
    """overbuff HTML에서 영웅 통계 파싱."""
    soup = BeautifulSoup(html, "lxml")
    heroes: list[HeroMeta] = []

    # overbuff 테이블 구조 탐색 (레이아웃 변경 대응을 위해 여러 셀렉터 시도)
    rows = soup.select("tbody tr")
    if not rows:
        rows = soup.select("table tr")

    for row in rows:
        cols = row.select("td")
        if len(cols) < 3:
            continue
        try:
            name_el = row.select_one("td a, td span[class*='name']")
            if not name_el:
                continue

            hero_name = name_el.get_text(strip=True)
            hero_id = _name_to_id(hero_name)
            role = _infer_role(row)

            # 수치 파싱 (열 순서: 이름, 픽률, 승률 or 이름, 승률, 픽률, 밴률)
            pcts = [_parse_pct(c.get_text(strip=True)) for c in cols[1:]]
            pcts = [p for p in pcts if p is not None]

            if len(pcts) < 2:
                continue

            pick_rate = pcts[0]
            win_rate = pcts[1]
            ban_rate = pcts[2] if len(pcts) > 2 else 0.0

            heroes.append(
                HeroMeta(
                    hero_id=hero_id,
                    hero_name=hero_name,
                    role=role,
                    pick_rate=pick_rate,
                    win_rate=win_rate,
                    ban_rate=ban_rate,
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
    max_ban = max((h.ban_rate for h in heroes), default=1) or 1

    for h in heroes:
        win_score = max(0.0, min(1.0, (h.win_rate - 40) / 20)) * 100
        pick_score = (h.pick_rate / max_pick) * 100
        ban_score = (h.ban_rate / max_ban) * 100 if max_ban > 0 else 0.0

        h.meta_score = round(win_score * 0.45 + pick_score * 0.30 + ban_score * 0.25, 1)
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


def _parse_pct(text: str) -> float | None:
    """'12.34%' → 12.34. 파싱 불가 시 None."""
    text = text.strip().replace("%", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _name_to_id(name: str) -> str:
    """영웅 이름 → heroes.json 키 변환."""
    mapping = {
        "D.Va": "dva",
        "Lúcio": "lucio",
        "Torbjörn": "torbjorn",
        "Soldier: 76": "soldier76",
        "Junker Queen": "junker_queen",
        "Wrecking Ball": "wrecking_ball",
    }
    if name in mapping:
        return mapping[name]
    return name.lower().replace(" ", "_").replace(".", "").replace(":", "").replace("-", "")


def _infer_role(row) -> str:
    text = row.get_text().lower()
    if any(w in text for w in ["tank"]):
        return "tank"
    if any(w in text for w in ["support", "heal"]):
        return "support"
    return "damage"


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
