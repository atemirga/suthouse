"""LLM-tools для использования готовых отчётов проекта и прямого SQL.

`use_api` — вызвать GET-эндпойнт Next.js. Это самый быстрый путь: готовая
бизнес-логика уже есть, не надо считать руками.

`query_db` — прямой SELECT в Postgres. Используется когда нужного API нет
или нужна нестандартная агрегация. Read-only, statement_timeout=30s.

`describe_db` — список таблиц/колонок для самообучения LLM.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from core import api, db


def _default(o: Any) -> Any:
    if isinstance(o, Decimal):
        f = float(o)
        return int(f) if f.is_integer() else f
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, bytes):
        return o.decode("utf-8", errors="replace")
    return str(o)


def _dumps(obj: Any, *, limit_chars: int = 40000) -> str:
    # Компактный JSON (без отступов) — на 30-40% короче, чем indent=2.
    # Меньше токенов → быстрее ответ от LLM.
    text = json.dumps(obj, ensure_ascii=False, default=_default, separators=(",", ":"))
    if len(text) > limit_chars:
        return text[:limit_chars] + f"…(truncated, total {len(text)} chars)"
    return text


def _compact_opiu(data: dict[str, Any]) -> dict[str, Any]:
    """Сжать ответ /api/opiu для скорости LLM: убираем нулевые строки и
    оставляем только code/label/total. Полная таблица не нужна — пользователю
    нужен один-два показателя."""
    rows = []
    for r in data.get("rows", []):
        total = r.get("total")
        if total in (None, 0, "?"):
            continue
        rows.append({
            "code": r.get("code"),
            "label": r.get("label") or r.get("name"),
            "total": total,
        })
    return {
        "from": data.get("from"),
        "to": data.get("to"),
        "totals": data.get("totals"),       # ← compact-словарь по периодам
        "grandTotal": data.get("grandTotal"),
        "rows": rows,
        "columnsMeta": data.get("columnsMeta"),
    }


def _compact_dds(data: dict[str, Any]) -> dict[str, Any]:
    """Аналогично для /api/dds: фильтруем нулевые строки."""
    rows = []
    for r in data.get("rows", []):
        total = r.get("total")
        if total in (None, 0, "?"):
            continue
        rows.append({
            "section": r.get("section"),
            "direction": r.get("direction"),
            "articleName": r.get("articleName"),
            "total": total,
        })
    return {
        "from": data.get("from"),
        "to": data.get("to"),
        "totals": data.get("totals"),
        "rows": rows,
    }


def _compact_debt_rows(rows: list[dict[str, Any]], *, top_n: int = 20) -> dict[str, Any]:
    """Сжать длинные списки дебиторов/кредиторов: топ-N имён + остаток агрегатом.
    Это снимает риск PII-фильтра DashScope (список 100+ реальных людей)
    и режет токены."""
    sorted_rows = sorted(rows, key=lambda r: float(r.get("totalDebt") or 0), reverse=True)
    top = sorted_rows[:top_n]
    rest = sorted_rows[top_n:]
    rest_sum = sum(float(r.get("totalDebt") or 0) for r in rest)
    out_rows = [
        {
            "name": r.get("kontragentName") or r.get("name"),
            "debt": r.get("totalDebt"),
            "prepay": r.get("prepayment"),
            "oldestDays": r.get("oldestDays"),
        }
        for r in top
    ]
    if rest:
        out_rows.append({"name": f"…ещё {len(rest)} контрагентов", "debt": rest_sum})
    return out_rows


def _compact_receivables(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "asOf": data.get("asOf"),
        "totals": data.get("totals"),
        "topDebtors": _compact_debt_rows(data.get("rows", [])),
    }


def _compact_payables(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "asOf": data.get("asOf"),
        "totals": data.get("totals"),
        "topCreditors": _compact_debt_rows(data.get("rows", [])),
    }


_COMPACTORS = {
    "opiu": _compact_opiu,
    "dds": _compact_dds,
    "receivables": _compact_receivables,
    "payables": _compact_payables,
}


def use_api(params: dict[str, Any]) -> str:
    """Вызов GET /api/<endpoint> с query-параметрами.

    params:
      endpoint: str   — относительный путь, напр. "opiu", "dds", "receivables",
                        "sales/by-sku", "sales/funnel/details" и т.п.
                        Полный путь "/api/..." тоже допустим.
      query: dict     — query-параметры (from, to, granularity, drill, ...).
                        Все значения сериализуем в строку, None пропускаем.
    """
    endpoint = (params.get("endpoint") or "").strip()
    if not endpoint:
        return "Не передан endpoint."
    query = params.get("query") or {}
    if not isinstance(query, dict):
        return f"query должно быть объектом, получено: {type(query).__name__}"

    try:
        data = api.get(endpoint, query)
    except Exception as e:  # noqa: BLE001
        return f"Ошибка API {endpoint}: {e}"

    # Если есть компактор для этого endpoint — применяем (только для dict,
    # без `drill` — там данные другой формы).
    base = endpoint.split("/", 1)[0].strip("/")
    if isinstance(data, dict) and base in _COMPACTORS and not query.get("drill"):
        data = _COMPACTORS[base](data)

    return _dumps(data)


def query_db(params: dict[str, Any]) -> str:
    """Выполнить SELECT в Postgres проекта.

    params:
      sql: str    — SELECT/WITH-запрос. Без точки с запятой, без write-DDL/DML.
      args: dict  — параметры запроса (`%(name)s` в SQL). Опционально.
      limit: int  — максимум строк (по умолчанию 100, потолок 1000).
    """
    sql = (params.get("sql") or "").strip()
    if not sql:
        return "Не передан sql."
    args = params.get("args") or {}
    limit = min(int(params.get("limit") or 100), 1000)

    try:
        rows = db.run_select(sql, args, limit=limit)
    except Exception as e:  # noqa: BLE001
        return f"Ошибка SQL: {e}"

    if not rows:
        return "Результат пуст."
    head = f"Строк: {len(rows)}"
    return f"{head}\n{_dumps(rows)}"


def describe_db(params: dict[str, Any]) -> str:
    """Если table не задана — список всех таблиц. Иначе — описание колонок таблицы."""
    table = (params.get("table") or "").strip()
    try:
        if not table:
            return "Таблицы:\n• " + "\n• ".join(db.list_tables())
        cols = db.describe_table(table)
        if not cols:
            return f"Таблица {table!r} не найдена."
        lines = [f"{c['column_name']} : {c['data_type']}"
                 + (" NULL" if c["is_nullable"] == "YES" else " NOT NULL")
                 for c in cols]
        return f"Колонки {table}:\n• " + "\n• ".join(lines)
    except Exception as e:  # noqa: BLE001
        return f"Ошибка: {e}"


def find_article(params: dict[str, Any]) -> str:
    """Поиск статьи ДДС/ОПиУ по слову (например 'аренда', 'маркетинг', '1.06').

    Возвращает короткий список id+name+opiuCategory — этого хватает LLM, чтобы
    подставить article=<id> в use_api(endpoint='dds' | 'expenses'). Без этой
    функции LLM пришлось бы выкачивать весь /api/articles (>200 записей).
    """
    keyword = (params.get("keyword") or "").strip()
    if not keyword:
        return "Не передан keyword."
    pattern = f"%{keyword}%"
    try:
        rows = db.run_select(
            """
            SELECT id, name, "opiuCategory", "ddsSection"
            FROM "DdsArticle"
            WHERE "isFolder" = false AND name ILIKE %(p)s
            ORDER BY name
            LIMIT 20
            """,
            {"p": pattern},
            limit=20,
        )
    except Exception as e:  # noqa: BLE001
        return f"Ошибка поиска: {e}"
    if not rows:
        return f"Статьи по '{keyword}' не найдены."
    lines = [
        f"• id={r['id']}  «{r['name']}»  opiuCategory={r['opiuCategory'] or '—'}  ddsSection={r['ddsSection'] or '—'}"
        for r in rows
    ]
    return f"Найдено {len(rows)} статей по '{keyword}':\n" + "\n".join(lines)


def find_kontragent(params: dict[str, Any]) -> str:
    """Поиск контрагента по слову — для подстановки kontragent=<id> в API."""
    keyword = (params.get("keyword") or "").strip()
    if not keyword:
        return "Не передан keyword."
    try:
        rows = db.run_select(
            """
            SELECT id, name FROM "Kontragent"
            WHERE "isFolder" = false AND name ILIKE %(p)s
            ORDER BY name LIMIT 20
            """,
            {"p": f"%{keyword}%"},
            limit=20,
        )
    except Exception as e:  # noqa: BLE001
        return f"Ошибка поиска: {e}"
    if not rows:
        return f"Контрагенты по '{keyword}' не найдены."
    return f"Найдено {len(rows)} контрагентов по '{keyword}':\n" + "\n".join(
        f"• id={r['id']}  «{r['name']}»" for r in rows
    )
