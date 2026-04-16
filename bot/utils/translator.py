"""
영어 → 한국어 번역 유틸리티 (Gemini REST API).

환경변수 GEMINI_API_KEY 필요.
배치 번역으로 API 호출 최소화 (최대 30건/요청).
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
# 배치 크기를 키워 총 요청 수를 최소화 (stadium 158건 → 4회, patch 173건 → 4회)
# _BATCH_DELAY 6초 → 실효 10 RPM, 어떤 무료 모델도 초과하지 않음
_BATCH_SIZE = 50          # 배치 크기 (요청 횟수 최소화)
_BATCH_DELAY = 6.0        # 배치 간 딜레이 (초) → 10 RPM (15 RPM 한도의 2/3)
_RETRY_COUNT = 5          # 429 재시도 횟수
_RETRY_BASE = 60          # 429 발생 시 첫 대기 시간 (초) — 1분 후 재시도
_MODEL = "gemini-2.5-flash-lite"
_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent"


def translate(text: str) -> str:
    """단일 텍스트 번역. 실패 시 원본 반환."""
    return translate_list([text])[0]


def translate_list(texts: list[str]) -> list[str]:
    """리스트 일괄 번역 (배치 처리).

    캐시 적중 항목은 API 호출 없이 즉시 반환.
    나머지는 _BATCH_SIZE 단위로 묶어 Gemini에 전송.
    """
    if not texts:
        return []

    results: list[str] = [""] * len(texts)
    to_translate: list[tuple[int, str]] = []

    for i, text in enumerate(texts):
        text = (text or "").strip()
        if not text:
            results[i] = text
        elif text in _CACHE:
            results[i] = _CACHE[text]
        else:
            to_translate.append((i, text))

    if not to_translate:
        return results

    total = len(to_translate)
    n_batches = -(-total // _BATCH_SIZE)
    logger.info(f"  Gemini 번역: {total}건 ({n_batches}배치)")

    for idx, batch_start in enumerate(range(0, total, _BATCH_SIZE)):
        if idx > 0:
            time.sleep(_BATCH_DELAY)  # RPM 제한 방지
        batch = to_translate[batch_start : batch_start + _BATCH_SIZE]
        translated = _call_gemini([t for _, t in batch])
        for (orig_idx, orig_text), ko_text in zip(batch, translated):
            _CACHE[orig_text] = ko_text
            results[orig_idx] = ko_text
        logger.info(f"  번역 진행: {min(batch_start + _BATCH_SIZE, total)}/{total}건")

    return results


def _call_gemini(texts: list[str]) -> list[str]:
    """Gemini REST API 배치 번역. 429 시 지수 백오프 재시도. 최종 실패 시 원본 반환."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.")

    numbered = json.dumps(
        {str(i): t for i, t in enumerate(texts)},
        ensure_ascii=False,
    )
    prompt = (
        "다음 JSON의 각 값을 영어에서 한국어로 번역하세요.\n"
        "오버워치 게임 용어는 공식 한국어 명칭을 사용하세요 "
        "(예: Reinhardt→라인하르트, Ultimate→궁극기, Tank→탱커, Perk→특성).\n"
        "동일한 키를 가진 JSON 객체만 반환하세요. 다른 텍스트는 포함하지 마세요.\n\n"
        f"{numbered}"
    )
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
            logger.warning(f"  Gemini 번역 실패 (원본 유지): {e!r}")
            return texts

    logger.warning(f"  {_RETRY_COUNT}회 재시도 후 번역 실패, 원본 유지")
    return texts
