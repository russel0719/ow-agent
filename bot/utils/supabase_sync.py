"""Supabase(ow_agent 스키마) 동기화 유틸리티.

매일 갱신되는 데이터를 Supabase Postgres(ow_agent 스키마)에 저장/조회한다.
PostgREST REST API를 직접 호출한다 (supabase 클라이언트 대신 requests 사용 —
필요한 연산이 upsert/select/delete 3종뿐이라 의존성을 늘리지 않음).

- 쓰기: service_role 키 (RLS 우회) — GitHub Actions / 백필 전용.
- 읽기(이전 상태): generate_data 재실행 시 portrait·번역 캐시 보존을 위해 사용.

SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없으면 비활성(enabled=False):
호출부가 로컬 파일 폴백을 쓰도록 하여 로컬 개발이 Supabase 없이도 동작한다.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import requests

logger = logging.getLogger(__name__)

SCHEMA = "ow_agent"
_TIMEOUT = 30


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _detail(e: Exception) -> str:
    """예외 메시지에 PostgREST 응답 본문을 덧붙여 원인 파악을 돕는다."""
    resp = getattr(e, "response", None)
    if resp is not None:
        try:
            body = resp.text[:400]
            if body:
                return f"{e} — {body}"
        except Exception:
            pass
    return str(e)


class SupabaseStore:
    """ow_agent 스키마 read/write 래퍼. 자격증명 없으면 모든 연산이 no-op."""

    def __init__(self, url: str | None = None, key: str | None = None):
        self.url = (url or os.getenv("SUPABASE_URL") or "").rstrip("/")
        self.key = key or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        self.enabled = bool(self.url and self.key)
        if not self.enabled:
            logger.warning("Supabase 자격증명 없음 — 로컬 파일 폴백 모드 (Supabase 동기화 비활성)")

    # ── 내부 헬퍼 ──────────────────────────────────────────────────────────
    def _headers(self, *, write: bool = False, extra: dict | None = None) -> dict:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        # 커스텀 스키마 선택: 읽기는 Accept-Profile, 쓰기는 Content-Profile
        h["Content-Profile" if write else "Accept-Profile"] = SCHEMA
        if write:
            h["Content-Type"] = "application/json"
        if extra:
            h.update(extra)
        return h

    def _rest(self, table: str) -> str:
        return f"{self.url}/rest/v1/{table}"

    def _upsert(self, table: str, rows: list[dict]) -> bool:
        if not self.enabled or not rows:
            return False
        try:
            r = requests.post(
                self._rest(table),
                headers=self._headers(
                    write=True, extra={"Prefer": "resolution=merge-duplicates"}
                ),
                json=rows,
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            return True
        except Exception as e:
            logger.warning(f"Supabase upsert {table}({len(rows)}행) 실패: {_detail(e)}")
            return False

    # ── datasets (blob 스냅샷) ────────────────────────────────────────────
    def get_dataset(self, name: str):
        """datasets.data 반환. 비활성/없음/실패 시 None."""
        if not self.enabled:
            return None
        try:
            r = requests.get(
                self._rest("datasets"),
                params={"name": f"eq.{name}", "select": "data"},
                headers=self._headers(),
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["data"] if rows else None
        except Exception as e:
            logger.warning(f"Supabase get_dataset({name}) 실패: {_detail(e)}")
            return None

    def put_dataset(self, name: str, data) -> bool:
        ok = self._upsert(
            "datasets", [{"name": name, "data": data, "updated_at": _now_iso()}]
        )
        if ok:
            logger.info(f"  → Supabase datasets['{name}'] upsert")
        return ok

    # ── meta_history / map_meta_history (정규화) ──────────────────────────
    def get_meta_history(self, rank: str | None = None) -> dict:
        """{rank: {date: heroes}} 반환 (rank 지정 시 해당 랭크만). 실패 시 {}."""
        if not self.enabled:
            return {}
        params = {"select": "rank,snapshot_date,heroes", "order": "snapshot_date"}
        if rank is not None:
            params["rank"] = f"eq.{rank}"
        try:
            r = requests.get(
                self._rest("meta_history"),
                params=params,
                headers=self._headers(),
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            out: dict[str, dict] = {}
            for row in r.json():
                out.setdefault(row["rank"], {})[row["snapshot_date"]] = row["heroes"]
            return out
        except Exception as e:
            logger.warning(f"Supabase get_meta_history 실패: {_detail(e)}")
            return {}

    def upsert_meta_history(self, rows: list[dict]) -> bool:
        """rows: [{rank, snapshot_date, heroes}, ...]"""
        return self._upsert("meta_history", rows)

    def upsert_map_history(self, rows: list[dict]) -> bool:
        """rows: [{map_id, snapshot_date, entries}, ...]"""
        return self._upsert("map_meta_history", rows)

    def delete_history_before(self, table: str, cutoff: str) -> bool:
        """table의 snapshot_date < cutoff(YYYY-MM-DD) 행 삭제 (보존기간 적용)."""
        if not self.enabled:
            return False
        try:
            r = requests.delete(
                self._rest(table),
                params={"snapshot_date": f"lt.{cutoff}"},
                headers=self._headers(write=True),
                timeout=_TIMEOUT,
            )
            r.raise_for_status()
            return True
        except Exception as e:
            logger.warning(f"Supabase delete {table}(< {cutoff}) 실패: {_detail(e)}")
            return False
