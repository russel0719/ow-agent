"""
영어 → 한국어 번역 유틸리티.

deep-translator 의 GoogleTranslator 백엔드 사용 (무료, 비공식 API).
- 세션 내 동일 텍스트 중복 번역 방지 (_CACHE)
- 실패 시 원본 텍스트 유지 (크래시 없음)
- 요청 간 0.2s 딜레이로 rate limit 방지
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

_CACHE: dict[str, str] = {}
_DELAY = 0.2  # 요청 간 딜레이 (초)


def translate(text: str) -> str:
    """단일 텍스트 영어 → 한국어 번역. 실패 시 원본 반환."""
    from deep_translator import GoogleTranslator

    text = (text or "").strip()
    if not text:
        return text
    if text in _CACHE:
        return _CACHE[text]

    try:
        result = GoogleTranslator(source="auto", target="ko").translate(text[:4999])
        _CACHE[text] = result or text
    except Exception as e:
        logger.warning(f"번역 실패 (원본 유지): {e!r}")
        _CACHE[text] = text

    time.sleep(_DELAY)
    return _CACHE[text]


def translate_list(texts: list[str]) -> list[str]:
    """리스트 일괄 번역."""
    return [translate(t) for t in texts]
