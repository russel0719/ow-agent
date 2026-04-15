"""영웅 데이터 로더 및 조회 유틸."""
import json
from pathlib import Path
from typing import Any

_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "heroes.json"
_data: dict = {}


def _load() -> dict:
    global _data
    if not _data:
        with _DATA_PATH.open(encoding="utf-8") as f:
            _data = json.load(f)
    return _data


def get_hero(name: str) -> dict | None:
    """별칭 포함해 영웅 데이터 반환."""
    heroes = _load()["heroes"]
    name_lower = name.lower().strip()

    # 정확한 키 매칭
    if name_lower in heroes:
        return {"id": name_lower, **heroes[name_lower]}

    # 별칭 매칭
    for hero_id, hero in heroes.items():
        if name_lower in [a.lower() for a in hero.get("aliases", [])]:
            return {"id": hero_id, **hero}

    return None


def all_heroes() -> list[dict]:
    heroes = _load()["heroes"]
    return [{"id": k, **v} for k, v in heroes.items()]


def heroes_by_role(role: str) -> list[dict]:
    return [h for h in all_heroes() if h.get("role") == role]


def get_role_info(role: str) -> dict | None:
    return _load()["roles"].get(role)
