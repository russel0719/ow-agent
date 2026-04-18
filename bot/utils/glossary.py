"""OW 번역 용어집 로더. data/ow_glossary.json 기반."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

_GLOSSARY_PATH = Path(__file__).parent.parent.parent / "data" / "ow_glossary.json"


@lru_cache(maxsize=1)
def _load() -> dict:
    with _GLOSSARY_PATH.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _name_to_id() -> dict[str, str]:
    """EN display name → hero_id 역방향 테이블 (프로세스당 1회 빌드)."""
    g = _load()
    m: dict[str, str] = {}
    for hid, hdata in g.get("heroes", {}).items():
        m[hid.lower()] = hid
        m[hid.lower().replace("_", " ")] = hid
        for en_name in hdata.get("name", {}):
            m[en_name.lower()] = hid
    return m


def _resolve(en_name: str) -> str | None:
    """영문 display name → glossary hero_id. 없으면 None."""
    tbl = _name_to_id()
    key = en_name.lower().strip()
    if key in tbl:
        return tbl[key]
    # 특수문자 제거 후 재시도 (예: "Torbjörn" → "torbjorn")
    simplified = re.sub(r"[^a-z0-9 ]", "", key)
    return tbl.get(simplified)


def get_glossary_section(hero_en_names: list[str] | None = None) -> str:
    """공통 용어 + 지정 영웅 스킬 용어를 프롬프트 주입용 문자열로 반환."""
    g = _load()
    lines: list[str] = ["【공식 번역 용어】"]
    for en, ko in g.get("common", {}).get("terms", {}).items():
        lines.append(f"{en}→{ko}")

    if hero_en_names:
        hero_lines: list[str] = []
        for en_name in hero_en_names:
            hid = _resolve(en_name)
            if not hid:
                continue
            hdata = g["heroes"].get(hid, {})
            for en, ko in hdata.get("name", {}).items():
                hero_lines.append(f"{en}→{ko}")
            for en, ko in hdata.get("skills", {}).items():
                hero_lines.append(f"{en}→{ko}")
        if hero_lines:
            lines.append("【영웅·스킬 명칭】")
            lines.extend(hero_lines)

    return "\n".join(lines)


def get_ability_key(ability_name: str) -> str | None:
    """능력 이름(EN 또는 KR)으로 키보드 키 반환. 없으면 None."""
    g = _load()
    ability_lower = ability_name.lower().strip()

    for hdata in g.get("heroes", {}).values():
        keys = hdata.get("keys", {})
        skills = hdata.get("skills", {})

        # EN 이름으로 직접 검색
        for en_ability, key in keys.items():
            if en_ability.lower() == ability_lower:
                return key

        # KR 이름으로 역방향 검색 (skills EN→KR 반전)
        kr_to_en = {ko.lower(): en for en, ko in skills.items()}
        en_from_kr = kr_to_en.get(ability_lower)
        if en_from_kr:
            key = keys.get(en_from_kr)
            if key:
                return key

    return None
