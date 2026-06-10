"""Динамический dispatcher отчётов: одна функция `query_1c`, всё остальное —
агрегации в Python поверх строго-описанного whitelisting'а сущностей 1С.

LLM выбирает entity + период + поле суммы + группировку; бот валидирует,
строит OData, агрегирует, форматирует.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from core import catalogs, metadata, odata
from core.odata import TZ, odata_datetime
from functions.api_db import describe_db, find_article, find_kontragent, query_db, use_api


# ---------------------------------------------------------------------------
# Whitelist сущностей и их метаданные.
# kind="document"   → mode=documents (Date-фильтр, СуммаДокумента)
# kind="balance"    → mode=balance (срез AccumulationRegister на as_of_date)
# ---------------------------------------------------------------------------

ENTITIES: dict[str, dict[str, Any]] = {
    # --- ДЕНЕЖНЫЕ ДОКУМЕНТЫ ---
    "Document_ПоступлениеВКассу": {
        "kind": "document",
        "label": "Поступления в кассу",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key", "БанковскийСчетКасса"],
    },
    "Document_ПоступлениеНаСчет": {
        "kind": "document",
        "label": "Поступления на счёт",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key", "БанковскийСчетКасса"],
    },
    "Document_РасходИзКассы": {
        "kind": "document",
        "label": "Расход из кассы",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key", "БанковскийСчетКасса"],
    },
    "Document_РасходСоСчета": {
        "kind": "document",
        "label": "Расход со счёта (выплаты с банка)",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key", "БанковскийСчетКасса"],
    },
    "Document_ПеремещениеДС": {
        "kind": "document",
        "label": "Перемещение денежных средств",
        "amount_field": "СуммаДокумента",
        "group_fields": [],
    },
    # --- ТОВАРНЫЕ ДОКУМЕНТЫ ---
    "Document_РасходнаяНакладная": {
        "kind": "document",
        "label": "Реализация (продажи)",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key"],
    },
    "Document_ПриходнаяНакладная": {
        "kind": "document",
        "label": "Приходная накладная (закупки)",
        "amount_field": "СуммаДокумента",
        "group_fields": ["Контрагент_Key"],
    },
    # --- ОСТАТКИ ---
    "AccumulationRegister_ДенежныеСредства": {
        "kind": "balance",
        "label": "Остатки денежных средств",
        "amount_field": "СуммаBalance",
        "group_fields": ["БанковскийСчетКасса"],
        "sign_rule": "always_positive",
    },
    "AccumulationRegister_РасчетыСПокупателями": {
        "kind": "balance",
        "label": "Расчёты с покупателями (дебиторка)",
        "amount_field": "СуммаBalance",
        "group_fields": ["Контрагент_Key"],
        "sign_rule": "advance_negative",  # ТипРасчетов=Аванс → знак минус
    },
    "AccumulationRegister_РасчетыСПоставщиками": {
        "kind": "balance",
        "label": "Расчёты с поставщиками (кредиторка)",
        "amount_field": "СуммаBalance",
        "group_fields": ["Контрагент_Key"],
        "sign_rule": "advance_negative",
    },
}


def _fmt(n: float | int) -> str:
    try:
        val = float(n)
    except (TypeError, ValueError):
        return f"{n} ₸"
    sign = "-" if val < 0 else ""
    return f"{sign}{int(round(abs(val))):,} ₸".replace(",", " ")


def _now() -> datetime:
    return datetime.now(TZ)


def _parse_ymd(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s).replace(tzinfo=TZ)


def _date_label(start: datetime, end: datetime) -> str:
    last = end - timedelta(days=1)
    if start.date() == last.date():
        return f"за {start.date().isoformat()}"
    return f"за период {start.date().isoformat()} … {last.date().isoformat()}"


def _resolve_group_name(field: str, key: str) -> str:
    """Резолв GUID → человеческое имя для известных group-by полей."""
    if not key or key.startswith("00000000-"):
        return "—"
    if field in ("Контрагент_Key", "Контрагент"):
        return catalogs.kontragent_name(key) or f"[{key[:8]}]"
    if field in ("БанковскийСчетКасса", "БанковскийСчетКасса_Key"):
        # Без _Type определить однозначно нельзя — пробуем оба каталога.
        return (
            catalogs.bank_name(key)
            or catalogs.kassa_name(key)
            or f"[{key[:8]}]"
        )
    return key  # для незнакомых полей возвращаем сырой ключ


def _apply_sign(row: dict[str, Any], rule: str | None) -> float:
    amount = float(row.get("СуммаBalance") or 0)
    if rule == "advance_negative" and row.get("ТипРасчетов") == "Аванс":
        return -amount
    return amount


# ---------------------------------------------------------------------------
# Главная функция, которую вызывает LLM через tool-calling.
# ---------------------------------------------------------------------------

def query_1c(params: dict[str, Any]) -> str:
    entity = (params.get("entity") or "").strip()
    meta = ENTITIES.get(entity)

    # Self-healing: если сущности нет в нашем whitelist, либо её нет в 1С —
    # пытаемся подобрать по метаданным.
    if not meta:
        # 1) Whitelist промах — проверим, существует ли вообще такая в 1С
        if not metadata.entity_exists(entity):
            best = metadata.best_entity(entity)
            if best and best in ENTITIES:
                # подменяем тихо
                entity = best
                meta = ENTITIES[entity]
            else:
                cands = metadata.find_entities(entity, kind="Document", limit=8) \
                    or metadata.find_entities(entity, limit=8)
                if best:
                    cands = [best] + [c for c in cands if c != best]
                hint = "\n".join(f"• {c}" for c in cands[:8]) or "(ничего похожего не найдено)"
                return (
                    f"Сущность {entity!r} не найдена в 1С. Возможно ты имел в виду:\n{hint}\n\n"
                    f"Внутри бота поддерживаются:\n" + "\n".join(f"• {e}" for e in ENTITIES)
                )
        else:
            # сущность в 1С есть, но в нашем whitelist нет конфига — не поддерживаем
            return (
                f"Сущность {entity!r} существует в 1С, но не сконфигурирована в боте. "
                f"Сейчас поддерживаются:\n" + "\n".join(f"• {e}" for e in ENTITIES)
            )

    kind = meta["kind"]
    amount_field = params.get("amount_field") or meta["amount_field"]
    top_n = int(params.get("top_n") or 10)
    group_by = params.get("group_by") or None

    # Валидация group_by против реальных полей сущности
    if group_by and not metadata.field_exists(entity, group_by):
        alts = metadata.find_fields(entity, group_by, limit=5)
        if len(alts) == 1:
            group_by = alts[0]
        else:
            hint = "\n".join(f"• {a}" for a in alts) or "(похожих полей нет)"
            return (
                f"Поле {group_by!r} не существует у {entity}. Возможно подойдёт:\n{hint}"
            )

    if kind == "document":
        return _run_document(entity, meta, params, amount_field, group_by, top_n)
    if kind == "balance":
        return _run_balance(entity, meta, params, amount_field, group_by, top_n)
    return f"Неподдерживаемый kind={kind!r}"


# ---------------------------------------------------------------------------
# Tool: поиск сущности по ключевому слову — для LLM-агента
# ---------------------------------------------------------------------------

def find_entity(params: dict[str, Any]) -> str:
    keyword = (params.get("keyword") or "").strip()
    kind = (params.get("kind") or "").strip() or None
    if not keyword:
        return "Передай keyword — слово или часть имени сущности."
    matches = metadata.find_entities(keyword, kind=kind, limit=15)
    if not matches:
        return f"Ничего не найдено по '{keyword}'" + (f" в {kind}_*" if kind else "")
    return (
        f"Найдено по '{keyword}'" + (f" среди {kind}_*" if kind else "") + ":\n"
        + "\n".join(f"• {m}" for m in matches)
    )


# ---------------------------------------------------------------------------
# Документы: список за период → сумма по amount_field, опц. группировка.
# ---------------------------------------------------------------------------

def _run_document(
    entity: str,
    meta: dict[str, Any],
    params: dict[str, Any],
    amount_field: str,
    group_by: str | None,
    top_n: int,
) -> str:
    # Период
    date_from = _parse_ymd(params.get("date_from"))
    date_to_inclusive = _parse_ymd(params.get("date_to"))

    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if date_from is None and date_to_inclusive is None:
        # дефолт — сегодня
        start, end = today, today + timedelta(days=1)
    else:
        start = date_from or (date_to_inclusive or today)
        last = date_to_inclusive or date_from or today
        end = last + timedelta(days=1)  # включительно
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = end.replace(hour=0, minute=0, second=0, microsecond=0)

    flt = f"Date ge {odata_datetime(start)} and Date lt {odata_datetime(end)}"

    # Поля: всегда тянем amount_field + Date + (group field, если задан)
    select_fields = ["Ref_Key", "Date", "Number", amount_field]
    if group_by and group_by not in select_fields:
        select_fields.append(group_by)

    rows = odata.fetch_all(entity, filter_=flt, select=",".join(select_fields))

    total = sum(float(r.get(amount_field) or 0) for r in rows)
    label = meta["label"]
    head = f"{label} ({_date_label(start, end)}):"
    lines = [head, f"• итого: {_fmt(total)}", f"• документов: {len(rows)}"]

    if group_by:
        if group_by not in meta.get("group_fields", []):
            lines.append(f"⚠ group_by={group_by!r} не из списка {meta['group_fields']}, всё равно пробую.")
        bucket: dict[str, float] = {}
        for r in rows:
            key = r.get(group_by) or ""
            name = _resolve_group_name(group_by, key)
            bucket[name] = bucket.get(name, 0.0) + float(r.get(amount_field) or 0)
        top = sorted(bucket.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        if top:
            lines.append(f"\nТоп-{len(top)} по {group_by}:")
            for name, val in top:
                lines.append(f"• {name}: {_fmt(val)}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Регистры: срез остатков на as_of_date.
# ---------------------------------------------------------------------------

def _run_balance(
    entity: str,
    meta: dict[str, Any],
    params: dict[str, Any],
    amount_field: str,
    group_by: str | None,
    top_n: int,
) -> str:
    as_of = _parse_ymd(params.get("as_of_date"))
    if as_of is not None:
        # дата конца дня
        as_of = as_of.replace(hour=23, minute=59, second=59)
    rows = odata.fetch_balance(entity, period=as_of)

    sign_rule = meta.get("sign_rule")
    # Группировка
    if not group_by:
        group_by = meta["group_fields"][0] if meta.get("group_fields") else None

    bucket: dict[str, float] = {}
    for r in rows:
        amount = _apply_sign(r, sign_rule) if sign_rule else float(r.get(amount_field) or 0)
        if group_by:
            key = r.get(group_by) or ""
            name = _resolve_group_name(group_by, key)
        else:
            name = "—"
        if name == "—" and not group_by:
            pass
        bucket[name] = bucket.get(name, 0.0) + amount

    # Фильтрация по имени (account/contragent)
    name_filter = ((params.get("filter_account") or params.get("filter_contragent")) or "").strip().lower()
    if name_filter:
        bucket = {k: v for k, v in bucket.items() if name_filter in k.lower()}

    total = sum(bucket.values())
    label = meta["label"]
    label_when = "сейчас" if as_of is None else f"на {as_of.date().isoformat()}"
    head = f"{label} ({label_when}):"

    lines = [head, f"• итого: {_fmt(total)}"]
    if group_by and bucket:
        # для дебиторки/кредиторки — обычно показываем кто должен (positive)
        if entity == "AccumulationRegister_РасчетыСПокупателями":
            positive = {k: v for k, v in bucket.items() if v > 0.01}
            lines.append(f"• должников: {len(positive)}")
            top = sorted(positive.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        elif entity == "AccumulationRegister_РасчетыСПоставщиками":
            positive = {k: v for k, v in bucket.items() if v > 0.01}
            lines.append(f"• кредиторов: {len(positive)}")
            top = sorted(positive.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        else:
            top = sorted(bucket.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
        if top:
            lines.append(f"\nТоп-{len(top)}:")
            for name, val in top:
                lines.append(f"• {name}: {_fmt(val)}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Composite report: ДДС (полный)
# ---------------------------------------------------------------------------

_CASH_IN_DOCS = ("Document_ПоступлениеВКассу", "Document_ПоступлениеНаСчет")
_CASH_OUT_DOCS = ("Document_РасходИзКассы", "Document_РасходСоСчета")


def report_dds(params: dict[str, Any]) -> str:
    """Полный ДДС-отчёт: приходы/выплаты по статьям + чистый поток."""
    date_from = _parse_ymd(params.get("date_from"))
    date_to_inclusive = _parse_ymd(params.get("date_to"))
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if date_from is None and date_to_inclusive is None:
        start = today.replace(day=1)
        end = (start.replace(year=start.year + 1, month=1) if start.month == 12
               else start.replace(month=start.month + 1))
    else:
        start = (date_from or date_to_inclusive or today).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        last = date_to_inclusive or date_from or today
        end = (last + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    flt = f"Date ge {odata_datetime(start)} and Date lt {odata_datetime(end)}"
    sel = "Ref_Key,Date,Number,СуммаДокумента,Статья_Key"

    def aggregate(entities: tuple[str, ...]) -> tuple[float, int, dict[str, tuple[float, int]]]:
        total = 0.0
        count = 0
        by_article: dict[str, tuple[float, int]] = {}
        for ent in entities:
            for r in odata.fetch_all(ent, filter_=flt, select=sel):
                amt = float(r.get("СуммаДокумента") or 0)
                total += amt
                count += 1
                art_id = r.get("Статья_Key") or ""
                art_name = catalogs.dds_article_name(art_id) or "(без статьи)"
                cur_s, cur_n = by_article.get(art_name, (0.0, 0))
                by_article[art_name] = (cur_s + amt, cur_n + 1)
        return total, count, by_article

    in_total, in_count, in_by = aggregate(_CASH_IN_DOCS)
    out_total, out_count, out_by = aggregate(_CASH_OUT_DOCS)
    net = in_total - out_total

    label = _date_label(start, end)
    lines = [f"ДДС {label}:"]
    lines.append("")
    lines.append(f"▼ ПРИХОДЫ ({in_count} док.): {_fmt(in_total)}")
    for name, (s, n) in sorted(in_by.items(), key=lambda kv: kv[1][0], reverse=True):
        lines.append(f"  • {name}: {_fmt(s)} ({n})")
    lines.append("")
    lines.append(f"▲ ВЫПЛАТЫ ({out_count} док.): {_fmt(out_total)}")
    for name, (s, n) in sorted(out_by.items(), key=lambda kv: kv[1][0], reverse=True):
        lines.append(f"  • {name}: {_fmt(s)} ({n})")
    lines.append("")
    sign = "+" if net >= 0 else ""
    lines.append(f"━ ЧИСТЫЙ ПОТОК: {sign}{_fmt(net)}")

    return "\n".join(lines)


DISPATCH = {
    "query_1c": query_1c,
    "find_entity": find_entity,
    "report_dds": report_dds,
    "use_api": use_api,
    "query_db": query_db,
    "describe_db": describe_db,
    "find_article": find_article,
    "find_kontragent": find_kontragent,
}
