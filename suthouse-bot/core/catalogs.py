"""Lazy in-memory cache for 1С catalogs (kassa / bank / kontragent).

Catalogs are tiny (hundreds-thousands of rows) and rarely change — first call
pages them once via `odata.fetch_all` and reuses the {Ref_Key → Description}
dict for the process lifetime. Bot restart re-warms the cache.
"""
from __future__ import annotations

from threading import Lock

from core import odata

_lock = Lock()
_cache: dict[str, dict[str, str]] = {}


def _load(entity: str) -> dict[str, str]:
    rows = odata.fetch_all(entity, select="Ref_Key,Description")
    return {r["Ref_Key"]: (r.get("Description") or "").strip() or "—" for r in rows if r.get("Ref_Key")}


def _get(entity: str) -> dict[str, str]:
    with _lock:
        if entity not in _cache:
            _cache[entity] = _load(entity)
        return _cache[entity]


def kassa_name(ref_key: str | None) -> str | None:
    if not ref_key:
        return None
    return _get("Catalog_Кассы").get(ref_key)


def bank_name(ref_key: str | None) -> str | None:
    if not ref_key:
        return None
    return _get("Catalog_БанковскиеСчета").get(ref_key)


def kontragent_name(ref_key: str | None) -> str | None:
    if not ref_key:
        return None
    return _get("Catalog_Контрагенты").get(ref_key)


def dds_article_name(ref_key: str | None) -> str | None:
    if not ref_key:
        return None
    return _get("Catalog_СтатьиДвиженияДенежныхСредств").get(ref_key)


def cash_account_name(ref_key: str | None, is_bank: bool) -> str:
    """Резолв названия счёта/кассы. Если в нужном каталоге нет — пытаемся другой."""
    if not ref_key:
        return "—"
    primary = bank_name(ref_key) if is_bank else kassa_name(ref_key)
    if primary:
        return primary
    fallback = kassa_name(ref_key) if is_bank else bank_name(ref_key)
    return fallback or f"[{ref_key[:8]}]"
