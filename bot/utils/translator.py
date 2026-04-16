"""
영어 → 한국어 번역 / 요약 유틸리티 (Gemini REST API).

환경변수 GEMINI_API_KEY 필요.
배치 처리로 API 호출 최소화 (최대 50건/요청).
"""
from __future__ import annotations

import json
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

_CACHE: dict[str, str] = {}
# gemini-2.5-flash-lite 무료 티어 기준 (15 RPM)
# _BATCH_DELAY 6초 → 실효 10 RPM
_BATCH_SIZE = 50
_BATCH_DELAY = 6.0
_RETRY_COUNT = 5
_RETRY_BASE = 60
_MODEL = "gemini-2.5-flash-lite"
_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"

_TRANSLATE_PROMPT = (
    "다음 JSON의 각 값을 영어에서 한국어로 번역하세요.\n"
    "오버워치 게임 용어는 공식 한국어 명칭을 사용하세요 "
    "(예: Reinhardt→라인하르트, Ultimate→궁극기, Tank→탱커, Perk→특성).\n"
    "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요."
)

_SUMMARIZE_PROMPT = (
    "다음 JSON의 각 값은 오버워치 스타디움 빌드 설명입니다.\n"
    "각 설명의 핵심 내용(빌드 특징, 주요 특성, 운영 방식)을 3줄 이내 한국어로 요약하세요.\n"
    "HTML 태그, color:, align:, [/color], [/align] 등 마크업은 반드시 제거하세요.\n"
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


def translate_list(texts: list[str]) -> list[str]:
    """리스트 일괄 번역 (배치 처리)."""
    return _batch_process(texts, _TRANSLATE_PROMPT, prefix="")


def summarize_list(texts: list[str]) -> list[str]:
    """리스트 일괄 3줄 요약 (배치 처리)."""
    return _batch_process(texts, _SUMMARIZE_PROMPT, prefix=_SUM_PREFIX)


def _batch_process(texts: list[str], prompt: str, prefix: str) -> list[str]:
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
    action = "요약" if prefix else "번역"
    logger.info(f"  Gemini {action}: {total}건 ({n_batches}배치)")

    for idx, batch_start in enumerate(range(0, total, _BATCH_SIZE)):
        if idx > 0:
            time.sleep(_BATCH_DELAY)
        batch = to_process[batch_start : batch_start + _BATCH_SIZE]
        processed = _call_gemini([t for _, t in batch], prompt)
        for (orig_idx, orig_text), result_text in zip(batch, processed):
            _CACHE[prefix + orig_text] = result_text
            results[orig_idx] = result_text
        logger.info(f"  {action} 진행: {min(batch_start + _BATCH_SIZE, total)}/{total}건")

    return results


def _call_gemini(texts: list[str], prompt_template: str) -> list[str]:
    """Gemini REST API 배치 호출. 429 시 고정 대기 재시도. 최종 실패 시 원본 반환."""
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
            resp = requests.post(_API_URL, headers=headers, json=payload, timeout=30)

            if resp.status_code == 429:
                logger.warning(f"  429 Rate limit, {_RETRY_BASE}초 후 재시도 ({attempt + 1}/{_RETRY_COUNT})...")
                time.sleep(_RETRY_BASE)
                continue

            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            data: dict = json.loads(text)
            return [data.get(str(i), texts[i]) for i in range(len(texts))]

        except requests.HTTPError:
            raise
        except Exception as e:
            logger.warning(f"  Gemini 호출 실패 (원본 유지): {e!r}")
            return texts

    logger.warning(f"  {_RETRY_COUNT}회 재시도 후 실패, 원본 유지")
    return texts
