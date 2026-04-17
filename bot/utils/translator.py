"""
영어 → 한국어 번역 / 요약 유틸리티 (Gemini REST API).

환경변수 GEMINI_API_KEY 필요.
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
# gemini-2.0-flash-lite 무료 티어 기준 (30 RPM, 1500 RPD)
# _BATCH_DELAY 6초 → 실효 10 RPM (함수 호출 경계 포함 전역 rate limit)
_BATCH_SIZE = 10
_BATCH_DELAY = 6.0
_RETRY_COUNT = 5
_RETRY_BASE = 60   # 429 시 첫 대기 시간(초), 이후 지수 증가 (최대 300초)
_last_api_call: float = 0.0  # 마지막 API 호출 시각 (전역 rate limit 추적)
_MODEL = "gemini-2.0-flash-lite"
_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"

_TRANSLATE_PROMPT = (
    "다음 JSON의 각 값을 영어에서 한국어로 번역하세요.\n"
    "오버워치 게임 공식 한국어 명칭을 사용하세요 "
    "(예: Reinhardt→라인하르트, Ultimate→궁극기, Tank→탱커, Perk→특성, Cooldown→재사용 대기시간).\n"
    "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요."
)

# 스타디움 빌드 이름 전용 번역 프롬프트
_TRANSLATE_STADIUM_NAME_PROMPT = (
    "다음 JSON의 각 값은 오버워치 스타디움 모드 유저 제작 빌드 이름입니다.\n"
    "한국어로 자연스럽게 번역하세요. 아래 규칙을 반드시 따르세요.\n\n"
    "【번역 금지 / 원문 유지】\n"
    "- 영웅 고유명사: B.O.B, D.Va, Lúcio, Torbjörn, Wrecking Ball 등 공식 영어 표기 그대로\n"
    "- 빌드 코드([S1], [S19] 등 시즌 표기), 이모지, 숫자·퍼센트(86% WR 등)\n"
    "- 아직 공식 한국어명이 없는 아이템/특성 이름 (원문 유지 후 괄호 안에 간단 설명 금지)\n\n"
    "【영웅·스킬 공식 한국어 명칭】\n"
    "Genji→겐지, Ana→아나, Reinhardt→라인하르트, Brigitte→브리기테, Cassidy→캐시디,\n"
    "Doomfist→둠피스트, Pharah→파라, Kiriko→키리코, Juno→주노, Freja→프레야,\n"
    "NanoNade→나노네이드, NanoBlade→나노블레이드, Dragonblade→용의 칼날\n\n"
    "【스탯·게임 용어 번역】\n"
    "Ability Power/AP→능력 파워, Weapon Power→무기 파워, Max Health/HP→최대 체력,\n"
    "Movement Speed→이동 속도, Cooldown→재사용 대기시간, Ultimate/Ult→궁극기,\n"
    "Lifesteal→생명력 흡수, AoE→광역, Burst→버스트, One-shot/1-shot→원샷,\n"
    "Perk→특성, Passive→패시브, Uptime→가동 시간\n\n"
    "【랭크 표기】\n"
    "Legend→전설, Grandmaster/GM→그랜드마스터, Top 500/T500→탑 500\n\n"
    "【게임 슬랭】\n"
    "dive→다이브, poke→포킹, nano→나노 부스트, nade→생체 수류탄,\n"
    "DPS(딜러 역할 맥락)→딜러, carry→캐리, farm→파밍, nuke→한방킬\n\n"
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
    "【오버워치 용어 (올바른 한국어 사용)】\n"
    "Ability Power/AP→능력 파워, Weapon Power→무기 파워, Max Health→최대 체력,\n"
    "Ultimate/Ult→궁극기, Cooldown→재사용 대기시간, Perk→특성,\n"
    "Lifesteal→생명력 흡수, AoE→광역 피해, Burst→버스트, Uptime→가동 시간,\n"
    "dive→다이브, poke→포킹, nano→나노 부스트, nade→생체 수류탄\n\n"
    "설명이 없거나 빈 값이면 빈 문자열을 반환하세요.\n"
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


def translate_list(texts: list[str], label: str = "번역") -> list[str]:
    """리스트 일괄 번역 (배치 처리)."""
    return _batch_process(texts, _TRANSLATE_PROMPT, prefix="", label=label)


def translate_stadium_names(texts: list[str], label: str = "스타디움 이름 번역") -> list[str]:
    """스타디움 빌드 이름 전용 번역 (오버워치 맥락 강화 프롬프트)."""
    return _batch_process(texts, _TRANSLATE_STADIUM_NAME_PROMPT, prefix="\x00stn\x00", label=label)


def summarize_list(texts: list[str], label: str = "요약") -> list[str]:
    """리스트 일괄 3줄 요약 (배치 처리)."""
    return _batch_process(texts, _SUMMARIZE_PROMPT, prefix=_SUM_PREFIX, label=label)


def _batch_process(texts: list[str], prompt: str, prefix: str, label: str) -> list[str]:
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

    for batch_idx, batch_start in enumerate(range(0, total, _BATCH_SIZE)):
        logger.info(f"  {label} [{batch_idx + 1}/{n_batches}]")
        batch = to_process[batch_start : batch_start + _BATCH_SIZE]
        processed = _call_gemini([t for _, t in batch], prompt)
        for (orig_idx, orig_text), result_text in zip(batch, processed):
            _CACHE[prefix + orig_text] = result_text
            results[orig_idx] = result_text

    return results


def _call_gemini(texts: list[str], prompt_template: str) -> list[str]:
    """Gemini REST API 배치 호출. 429 시 고정 대기 재시도. 최종 실패 시 원본 반환."""
    global _last_api_call

    # 전역 rate limit: 마지막 호출로부터 _BATCH_DELAY 미만이면 대기
    elapsed = time.time() - _last_api_call
    if elapsed < _BATCH_DELAY:
        wait = _BATCH_DELAY - elapsed
        logger.debug(f"  Rate limit 대기: {wait:.1f}초")
        time.sleep(wait)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.")

    numbered = json.dumps(
        {str(i): t for i, t in enumerate(texts)},
        ensure_ascii=False,
    )
    prompt = prompt_template + "\n\n" + numbered
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }

    for attempt in range(_RETRY_COUNT):
        try:
            _last_api_call = time.time()
            resp = requests.post(_API_URL, headers=headers, json=payload, timeout=30)

            if resp.status_code == 429:
                wait = min(_RETRY_BASE * (2 ** attempt), 300)
                logger.warning(f"  429 Rate limit, {wait}초 후 재시도 ({attempt + 1}/{_RETRY_COUNT})...")
                time.sleep(wait)
                continue

            if not resp.ok:
                logger.warning(f"  Gemini HTTP {resp.status_code} (원본 유지): {resp.text[:200]}")
                return texts

            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            data: dict = json.loads(text)
            return [data.get(str(i), texts[i]) for i in range(len(texts))]

        except Exception as e:
            logger.warning(f"  Gemini 호출 실패 (원본 유지): {e!r}")
            return texts

    logger.warning(f"  {_RETRY_COUNT}회 재시도 후 실패, 원본 유지")
    return texts
