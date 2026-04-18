"""
영어 → 한국어 번역 / 요약 유틸리티 (NVIDIA API, Kimi K2 Instruct).

환경변수 NVIDIA_API_KEY 필요.
배치 처리로 API 호출 최소화 (최대 10건/요청).
"""
from __future__ import annotations

import json
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

_CACHE: dict[str, str] = {}
_BATCH_SIZE = 10
_BATCH_DELAY = 1.0     # NVIDIA API rate limit 여유로움
_RETRY_COUNT = 5
_RETRY_BASE = 10   # 429 시 첫 대기 시간(초), 이후 지수 증가 (최대 120초)
_last_api_call: float = 0.0  # 마지막 API 호출 시각 (전역 rate limit 추적)
_MODEL = "moonshotai/kimi-k2-instruct"
_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

_TRANSLATE_PROMPT = (
    "다음 JSON의 각 값을 영어에서 한국어로 번역하세요.\n"
    "아래 제공되는 공식 번역 용어를 반드시 사용하세요.\n"
    "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요."
)

# 스타디움 빌드 이름 전용 번역 프롬프트
_TRANSLATE_STADIUM_NAME_PROMPT = (
    "다음 JSON의 각 값은 오버워치 스타디움 모드 유저 제작 빌드 이름입니다.\n"
    "한국어로 자연스럽게 번역하세요. 아래 규칙을 반드시 따르세요.\n\n"
    "【번역 금지 / 원문 유지】\n"
    "- 영웅 고유명사: B.O.B, D.Va, Lúcio, Torbjörn, Wrecking Ball 등 공식 영어 표기 그대로\n"
    "- 빌드 코드([S1], [S19] 등 시즌 표기), 이모지, 숫자·퍼센트(86% WR 등)\n"
    "- 아직 공식 한국어명이 없는 아이템/특성 이름 (원문 유지)\n\n"
    "아래 제공되는 공식 번역 용어를 반드시 사용하세요.\n"
    "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요."
)

_SUMMARIZE_PROMPT = (
    "다음 JSON의 각 값은 오버워치 스타디움 빌드 설명입니다.\n"
    "핵심 내용을 2~3줄 한국어로 요약하세요.\n\n"
    "【반드시 제거할 것】\n"
    "- 내부 ID 패턴(hero_XXXX, item_XXXX, stat_XXXX, ability_XXXX 형태) 완전 제거\n"
    "  단, 패턴 앞에 실제 이름이 있으면 이름만 남기고 ID 제거\n"
    "  예: '무기 파워(stat_weapon_power)' → '무기 파워'\n"
    "  예: 'item_3da81000-333c-...' → 제거\n"
    "- http/https URL, stadiumbuilds.io 링크, YouTube 링크 모두 제거\n"
    "- BBCode/마크업: color:, align:, [/color], [/align], [color=...], [align=...] 제거\n"
    "- HTML 태그 제거\n"
    "- 시즌 업데이트 공지·편집자 메모('S1 업데이트!', '나중에 업데이트 예정' 등) 제거\n\n"
    "【요약에 포함할 것】\n"
    "- 빌드의 핵심 전략 (예: 능력 파워 극대화로 광역 폭딜 특화)\n"
    "- 주요 스탯 또는 플레이 방식 (예: 이동 속도+재사용 대기시간 단축으로 쉬지 않고 교전)\n"
    "- 승률·랭크 정보가 있으면 간략히 포함 가능\n\n"
    "설명이 없거나 빈 값이면 빈 문자열을 반환하세요.\n"
    "아래 제공되는 공식 번역 용어를 반드시 사용하세요.\n"
    "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요."
)

# 요약 캐시는 키 앞에 접두사를 붙여 번역 캐시와 분리
_SUM_PREFIX = "\x00sum\x00"


def translate(text: str) -> str:
    """단일 텍스트 번역. 실패 시 원본 반환."""
    return translate_list([text])[0]


def summarize(text: str) -> str:
    """단일 텍스트 3줄 이내 한국어 요약. 실패 시 원본 반환."""
    return summarize_list([text])[0]


def translate_list(texts: list[str], label: str = "번역", heroes: list[str] | None = None) -> list[str]:
    """리스트 일괄 번역 (배치 처리)."""
    return _batch_process(texts, _TRANSLATE_PROMPT, prefix="", label=label, heroes=heroes)


def translate_stadium_names(texts: list[str], label: str = "스타디움 이름 번역", heroes: list[str] | None = None) -> list[str]:
    """스타디움 빌드 이름 전용 번역 (오버워치 맥락 강화 프롬프트)."""
    return _batch_process(texts, _TRANSLATE_STADIUM_NAME_PROMPT, prefix="\x00stn\x00", label=label, heroes=heroes)


def summarize_list(texts: list[str], label: str = "요약", heroes: list[str] | None = None) -> list[str]:
    """리스트 일괄 3줄 요약 (배치 처리)."""
    return _batch_process(texts, _SUMMARIZE_PROMPT, prefix=_SUM_PREFIX, label=label, heroes=heroes)


def _batch_process(texts: list[str], prompt: str, prefix: str, label: str, heroes: list[str] | None = None) -> list[str]:
    """공통 배치 처리 로직."""
    if not texts:
        return []

    results: list[str] = [""] * len(texts)
    to_process: list[tuple[int, str]] = []

    for i, text in enumerate(texts):
        text = (text or "").strip()
        if not text:
            results[i] = text
        elif (prefix + text) in _CACHE:
            results[i] = _CACHE[prefix + text]
        else:
            to_process.append((i, text))

    if not to_process:
        return results

    total = len(to_process)
    n_batches = -(-total // _BATCH_SIZE)

    # 용어집 섹션 생성 (heroes 지정 시 해당 영웅 스킬 포함)
    glossary_section = ""
    if heroes:
        from bot.utils.glossary import get_glossary_section
        glossary_section = get_glossary_section(heroes)
    else:
        from bot.utils.glossary import get_glossary_section
        glossary_section = get_glossary_section()

    for batch_idx, batch_start in enumerate(range(0, total, _BATCH_SIZE)):
        logger.info(f"  {label} [{batch_idx + 1}/{n_batches}]")
        batch = to_process[batch_start : batch_start + _BATCH_SIZE]
        processed = _call_api([t for _, t in batch], prompt, glossary_section=glossary_section)
        for (orig_idx, orig_text), result_text in zip(batch, processed):
            _CACHE[prefix + orig_text] = result_text
            results[orig_idx] = result_text

    return results


def _call_api(texts: list[str], prompt_template: str, glossary_section: str = "") -> list[str]:
    """NVIDIA API (Kimi K2 Instruct) 배치 호출. 429 시 지수 대기 재시도. 최종 실패 시 원본 반환."""
    global _last_api_call

    elapsed = time.time() - _last_api_call
    if elapsed < _BATCH_DELAY:
        wait = _BATCH_DELAY - elapsed
        logger.debug(f"  Rate limit 대기: {wait:.1f}초")
        time.sleep(wait)

    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise ValueError("NVIDIA_API_KEY 환경변수가 설정되지 않았습니다.")

    numbered = json.dumps(
        {str(i): t for i, t in enumerate(texts)},
        ensure_ascii=False,
    )

    # system: 지시사항 + 용어집 / user: 번역 대상 JSON
    system_content = prompt_template
    if glossary_section:
        system_content = prompt_template + "\n\n" + glossary_section

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": numbered},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    for attempt in range(_RETRY_COUNT):
        try:
            _last_api_call = time.time()
            resp = requests.post(_API_URL, headers=headers, json=payload, timeout=60)

            if resp.status_code == 429:
                wait = min(_RETRY_BASE * (2 ** attempt), 120)
                logger.warning(f"  429 Rate limit, {wait}초 후 재시도 ({attempt + 1}/{_RETRY_COUNT})...")
                time.sleep(wait)
                continue

            if not resp.ok:
                logger.warning(f"  API HTTP {resp.status_code} (원본 유지): {resp.text[:200]}")
                return texts

            content = resp.json()["choices"][0]["message"]["content"]
            data: dict = json.loads(content)
            return [data.get(str(i), texts[i]) for i in range(len(texts))]

        except Exception as e:
            logger.warning(f"  API 호출 실패 (원본 유지): {e!r}")
            return texts

    logger.warning(f"  {_RETRY_COUNT}회 재시도 후 실패, 원본 유지")
    return texts
