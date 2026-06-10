"""Кэш и поиск по 1С OData $metadata.

При старте лениво качаем `$metadata` XML (~MB), парсим в карту
{entity_set_name → {field_name → type}} и предоставляем функции поиска.

Используется в двух случаях:
1. Self-healing dispatcher — если LLM передала несуществующее имя
   сущности/поля, ищем ближайшее и подставляем (или возвращаем список).
2. Tool `find_entity` — LLM сама может запросить поиск имён по
   ключевому слову, прежде чем делать `query_1c`.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from threading import Lock
from typing import Iterable

from core import odata

_lock = Lock()
_entities: dict[str, dict[str, str]] | None = None  # entity_set → {field → type}


def _parse(xml_text: str) -> dict[str, dict[str, str]]:
    """Достать из CSDL EntityType + поля. Не идеально, но устойчиво."""
    # ns стандартный для CSDL — берём по local-name, чтобы не возиться с ns map
    root = ET.fromstring(xml_text)
    # 1) Собрать карту EntityType_NS.<Name> → {field: type}
    types: dict[str, dict[str, str]] = {}
    for et in root.iter():
        if not et.tag.endswith("}EntityType"):
            continue
        name = et.get("Name") or ""
        fields: dict[str, str] = {}
        for prop in et:
            if not prop.tag.endswith("}Property") and not prop.tag.endswith("}NavigationProperty"):
                continue
            fname = prop.get("Name")
            ftype = prop.get("Type") or "Edm.Unknown"
            if fname:
                fields[fname] = ftype
        if name:
            types[name] = fields
    # 2) EntitySet'ы используют EntityType (full name) — но в 1С имена EntitySet и EntityType
    # обычно совпадают, поэтому сделаем карту по обоим источникам.
    sets: dict[str, dict[str, str]] = {}
    for es in root.iter():
        if not es.tag.endswith("}EntitySet"):
            continue
        sname = es.get("Name")
        etype_full = (es.get("EntityType") or "").split(".")[-1]
        fields = types.get(etype_full) or {}
        if sname:
            sets[sname] = fields
    # На случай, если в CSDL нет EntitySet (бывает) — добавим все EntityType под тем же именем.
    for tname, fields in types.items():
        sets.setdefault(tname, fields)
    return sets


def _ensure_loaded() -> dict[str, dict[str, str]]:
    global _entities
    if _entities is None:
        with _lock:
            if _entities is None:
                xml_text = odata.fetch_metadata()
                _entities = _parse(xml_text)
    return _entities


# ---------------------------------------------------------------------------
# Публичные функции
# ---------------------------------------------------------------------------

def entity_exists(name: str) -> bool:
    return name in _ensure_loaded()


def fields_of(entity: str) -> dict[str, str]:
    return _ensure_loaded().get(entity, {})


def field_exists(entity: str, field: str) -> bool:
    return field in fields_of(entity)


def _score(needle: str, hay: str) -> int:
    """Простой substring-скоринг: 100 если префикс, 50 если содержит, иначе 0."""
    n = needle.lower()
    h = hay.lower()
    if not n:
        return 0
    if h == n:
        return 200
    if h.startswith(n):
        return 100
    if n in h:
        return 50
    return 0


def find_entities(keyword: str, *, kind: str | None = None, limit: int = 15) -> list[str]:
    """Поиск EntitySet по подстроке (case-insensitive).

    kind='Document'|'Catalog'|'AccumulationRegister'|'InformationRegister' — фильтр префикса.
    """
    keyword = (keyword or "").strip()
    all_sets: Iterable[str] = _ensure_loaded().keys()
    if kind:
        all_sets = [s for s in all_sets if s.startswith(f"{kind}_")]
    # ранжируем
    ranked = sorted(
        ((_score(keyword, s), s) for s in all_sets if _score(keyword, s) > 0),
        key=lambda x: (-x[0], x[1]),
    )
    return [s for _, s in ranked[:limit]]


def find_fields(entity: str, keyword: str, *, limit: int = 15) -> list[str]:
    fields = fields_of(entity)
    keyword = (keyword or "").strip()
    ranked = sorted(
        ((_score(keyword, f), f) for f in fields if _score(keyword, f) > 0),
        key=lambda x: (-x[0], x[1]),
    )
    return [f for _, f in ranked[:limit]]


def best_entity(name: str) -> str | None:
    """Ровно один высоко-уверенный кандидат? Вернуть его, иначе None."""
    if entity_exists(name):
        return name
    # Достаём kind из префикса
    kind = name.split("_", 1)[0] if "_" in name else None
    tail = name.split("_", 1)[1] if "_" in name else name
    # Пробуем по последнему слову (часто LLM путает «Списание» vs «Расход»)
    keywords = re.findall(r"[А-ЯЁA-Z][а-яёa-z]+", tail) or [tail]
    candidates: list[str] = []
    for kw in keywords[-3:]:  # последние 3 слова имени
        candidates += find_entities(kw, kind=kind, limit=5)
    # уникальные с сохранением порядка
    seen, uniq = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    if len(uniq) == 1:
        return uniq[0]
    return None
