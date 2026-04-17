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


def translate_list(texts: list[str], label: str = "번역") -> list[str]:
    """리스트 일괄 번역 (배치 처리)."""
    return _batch_process(texts, _TRANSLATE_PROMPT, prefix="", label=label)


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
