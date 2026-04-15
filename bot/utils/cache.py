import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).parent.parent.parent / "data" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(key: str) -> Path:
    safe_key = key.replace("/", "_").replace(":", "_")
    return CACHE_DIR / f"{safe_key}.json"


def get(key: str) -> Any | None:
    """유효한 캐시 데이터를 반환. 만료되거나 없으면 None."""
    path = _cache_path(key)
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            entry = json.load(f)
        if time.time() - entry["timestamp"] < entry["ttl"]:
            return entry["data"]
    except Exception as e:
        logger.warning(f"Cache read error ({key}): {e}")
    return None


def get_stale(key: str) -> Any | None:
    """만료된 캐시라도 반환 (graceful degradation용)."""
    path = _cache_path(key)
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)["data"]
    except Exception as e:
        logger.warning(f"Stale cache read error ({key}): {e}")
    return None


def set(key: str, data: Any, ttl: int) -> None:
    """데이터를 캐시에 저장. ttl은 초 단위."""
    path = _cache_path(key)
    try:
        with path.open("w", encoding="utf-8") as f:
            json.dump({"timestamp": time.time(), "ttl": ttl, "data": data}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Cache write error ({key}): {e}")


def invalidate(key: str) -> None:
    """캐시 항목 삭제."""
    path = _cache_path(key)
    if path.exists():
        path.unlink()
