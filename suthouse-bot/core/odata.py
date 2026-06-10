"""OData-клиент для 1С УНФ KZ.

Жёсткие правила, зашитые здесь:
- $orderby=Ref_Key всегда (иначе пагинация теряет записи).
- Документы: DeletionMark eq false and Posted eq true.
- Регистры (движения): Active eq true; Posted/Deletion не подмешивать.
- Таймзона Asia/Almaty (через ZoneInfo).
- Пагинация по $skip, страница 1000.
"""
from __future__ import annotations

import urllib.parse
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from config.config import cfg

TZ = ZoneInfo(cfg.timezone)
PAGE_SIZE = 1000
_DOC_BASE_FILTER = "DeletionMark eq false and Posted eq true"


def _client() -> httpx.Client:
    return httpx.Client(
        auth=(cfg.odata_user, cfg.odata_password),
        verify=cfg.odata_verify_ssl,
        timeout=60.0,
        headers={"Accept": "application/json"},
    )


def odata_datetime(dt: datetime) -> str:
    """Формат datetime для $filter: datetime'YYYY-MM-DDTHH:MM:SS'."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(TZ).replace(tzinfo=None)
    return f"datetime'{dt.strftime('%Y-%m-%dT%H:%M:%S')}'"


def day_bounds(day: datetime) -> tuple[datetime, datetime]:
    """Границы суток в TZ: (00:00 включительно, 00:00 следующего дня исключительно)."""
    if day.tzinfo is None:
        day = day.replace(tzinfo=TZ)
    else:
        day = day.astimezone(TZ)
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start, end


def _combine_filter(base: str, extra: str) -> str:
    base = (base or "").strip()
    extra = (extra or "").strip()
    if base and extra:
        return f"{base} and ({extra})"
    return base or extra


def _build_query_string(params: dict[str, str]) -> str:
    """Кодируем пробелы как %20 (не +). Эта 1С УНФ игнорирует $filter с '+' внутри
    выражений 'Date ge datetime...' — тихий баг без 4xx."""
    return urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def fetch_all(
    entity: str,
    *,
    filter_: str = "",
    select: str = "",
    expand: str = "",
    extra: str = "",
    is_register: bool = False,
) -> list[dict[str, Any]]:
    """Постранично выкачать все записи сущности.

    is_register=True — для регистров (движений): базовый фильтр Posted/Deletion
    НЕ применяется. Передавайте filter_='Active eq true' явно.
    """
    # Posted/DeletionMark — поля только у Document_*; для Catalog_*, регистров,
    # перечислений их применять нельзя (отдают 400).
    apply_doc_filter = entity.startswith("Document_") and not is_register
    base = _DOC_BASE_FILTER if apply_doc_filter else ""
    combined = _combine_filter(base, filter_)

    # Для регистров Ref_Key нет — сортируем по Recorder (есть на всех _RecordType).
    orderby = "Recorder" if is_register else "Ref_Key"

    rows: list[dict[str, Any]] = []
    skip = 0
    with _client() as client:
        while True:
            params: dict[str, str] = {
                "$format": "json",
                "$top": str(PAGE_SIZE),
                "$skip": str(skip),
                "$orderby": orderby,
            }
            if combined:
                params["$filter"] = combined
            if select:
                params["$select"] = select
            if expand:
                params["$expand"] = expand

            if extra:
                # extra — сырые query-параметры через &, например '$top=1'.
                # Парсим и мерджим — httpx сам корректно закодирует значения.
                extra_pairs = urllib.parse.parse_qsl(extra.lstrip("?&"), keep_blank_values=True)
                for k, v in extra_pairs:
                    params[k] = v

            url = f"{cfg.odata_url}/{entity}?{_build_query_string(params)}"
            r = client.get(url)
            r.raise_for_status()
            payload = r.json()
            page = payload.get("value", [])
            rows.extend(page)
            if len(page) < PAGE_SIZE:
                break
            skip += PAGE_SIZE
    return rows


def fetch_balance(
    register: str,
    period: datetime | None = None,
    *,
    filter_: str = "",
) -> list[dict[str, Any]]:
    """Срез остатков по AccumulationRegister на момент `period` (по умолчанию — сейчас).

    1С отдаёт это через OData-функцию `Register/Balance(Period=datetime'...')`
    плоским списком — Recorder/Active/LineNumber тут не используются.
    """
    if period is None:
        period = datetime.now(TZ)
    iso = period.astimezone(TZ).replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%S")
    params: dict[str, str] = {"$format": "json"}
    if filter_:
        params["$filter"] = filter_
    base = f"{cfg.odata_url}/{register}/Balance(Period=datetime'{iso}')"
    url = f"{base}?{_build_query_string(params)}" if params else base
    with _client() as client:
        r = client.get(url)
        r.raise_for_status()
        return r.json().get("value", [])


def fetch_metadata() -> str:
    """Полный $metadata XML (для исследований и инструментария)."""
    with _client() as client:
        r = client.get(f"{cfg.odata_url}/$metadata")
        r.raise_for_status()
        return r.text
