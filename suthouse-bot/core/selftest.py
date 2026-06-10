"""Самопроверка бота: бьём по всем источникам данных и репортим в чат.

Запускается ручной командой /selftest. Идея — после деплоя/правки получить
от живого бота список «зелёных/красных» источников за пару секунд, а не
выяснять через несколько часов, что какой-то путь сломан.

Каждая проверка возвращает (label, ok, detail, took_ms). Финальный отчёт
читается как чек-лист — по красным меткам сразу видно, что чинить.
"""
from __future__ import annotations

import time
from typing import Any

from core import api, db, llm, odata
from functions.api_db import _compact_opiu, find_article
from functions.reports import DISPATCH


def _measure(fn, *args, **kwargs) -> tuple[bool, str, int]:
    t0 = time.monotonic()
    try:
        out = fn(*args, **kwargs)
        ms = int((time.monotonic() - t0) * 1000)
        return True, _short(out), ms
    except Exception as e:  # noqa: BLE001
        ms = int((time.monotonic() - t0) * 1000)
        return False, f"{type(e).__name__}: {e}", ms


def _short(out: Any) -> str:
    if isinstance(out, dict):
        return f"dict keys={list(out.keys())[:6]}"
    if isinstance(out, list):
        return f"list len={len(out)}"
    if isinstance(out, str):
        first = out.splitlines()[0][:80] if out else "(empty)"
        return f"str len={len(out)} «{first}»"
    return str(out)[:80]


def run_selftest(*, include_llm: bool = True) -> str:
    """Возвращает готовый текст для отправки в Telegram."""
    lines: list[str] = ["🩺 Selftest:"]

    # --- 1) Postgres ---
    ok, detail, ms = _measure(db.list_tables)
    lines.append(_fmt("DB list_tables", ok, ms, detail))

    ok, detail, ms = _measure(
        db.run_select, 'SELECT COUNT(*) AS n FROM "Realizacia"'
    )
    lines.append(_fmt("DB Realizacia count", ok, ms, detail))

    ok, detail, ms = _measure(find_article, {"keyword": "аренда"})
    lines.append(_fmt("DB find_article('аренда')", ok, ms, detail))

    # --- 2) Next.js API ---
    ok, detail, ms = _measure(api.get, "sync/status")
    lines.append(_fmt("API /sync/status", ok, ms, detail))

    ok, detail, ms = _measure(api.get, "balance")
    lines.append(_fmt("API /balance", ok, ms, detail))

    ok, detail, ms = _measure(
        api.get,
        "opiu",
        {"from": "2026-05-01", "to": "2026-05-31", "granularity": "month"},
    )
    lines.append(_fmt("API /opiu (май)", ok, ms, detail))

    # --- 3) OData 1С ---
    ok, detail, ms = _measure(
        odata.fetch_all,
        "Document_ПоступлениеВКассу",
        filter_="Date ge datetime'2026-05-25T00:00:00' and Date lt datetime'2026-05-26T00:00:00'",
        select="Ref_Key,Date,СуммаДокумента",
    )
    lines.append(_fmt("OData 1С (сегодня)", ok, ms, detail))

    # --- 4) Агент целиком (опционально, дорого) ---
    if include_llm:
        ok, detail, ms = _measure(
            llm.run_agent,
            "сколько денег на кассах сейчас",
            tools=_minimal_tools(),
            dispatch=DISPATCH,
            final_tools={"query_1c", "report_dds"},
            max_steps=3,
        )
        lines.append(_fmt("Agent end-to-end", ok, ms, detail))

    # Сводка
    bad = sum(1 for l in lines if l.startswith("❌"))
    if bad:
        lines.append(f"\n⚠ Сломано: {bad}/{len(lines)-1}. Проверь логи.")
    else:
        lines.append(f"\n✅ Все источники зелёные ({len(lines)-1} проверок).")
    return "\n".join(lines)


def _fmt(label: str, ok: bool, ms: int, detail: str) -> str:
    icon = "✅" if ok else "❌"
    return f"{icon} {label:30s} {ms:>5}мс  {detail[:80]}"


def _minimal_tools() -> list[dict]:
    """Минимальный набор тулзов для selftest агента (без обвеса прав/конфирмов)."""
    import json
    from pathlib import Path

    registry = json.loads(
        (Path(__file__).resolve().parent.parent / "functions" / "registry.json").read_text(encoding="utf-8")
    )
    return [
        {"type": "function", "function": {"name": f["name"],
                                          "description": f["description"],
                                          "parameters": f["parameters"]}}
        for f in registry
    ]
