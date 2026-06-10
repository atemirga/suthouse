"""Read-only клиент Postgres проекта Suthouse.

Бот может ходить в БД напрямую через `query_db`, когда нужный отчёт нельзя
получить готовым через API. SQL ограничен SELECT-запросами; пишущие запросы
блокируются на уровне парсинга, плюс соединение открывается в
read_only режиме на стороне Postgres (`SET TRANSACTION READ ONLY`).
"""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from config.config import cfg

log = logging.getLogger(__name__)


def _normalize_dsn(dsn: str) -> str:
    """Убрать Prisma-специфичные query-параметры (schema, connection_limit, …),
    которые libpq не понимает. Остальные опции сохраняем."""
    if not dsn or "?" not in dsn:
        return dsn
    parts = urlsplit(dsn)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k not in {"schema", "schemas", "connection_limit", "pool_timeout",
                          "pgbouncer", "socket_timeout", "statement_cache_size"}]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))

# Запрещаем любые ключевые слова, изменяющие данные/схему. Регэксп обрамлён
# границами слов, чтобы не ловить, например, столбец «delete_at».
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|"
    r"comment|vacuum|reindex|cluster|lock|copy|call|do|merge)\b",
    re.IGNORECASE,
)


def _validate_select(sql: str) -> None:
    cleaned = sql.strip().rstrip(";").strip()
    if not cleaned:
        raise ValueError("Пустой SQL")
    head = cleaned.split(None, 1)[0].lower()
    if head not in {"select", "with"}:
        raise ValueError(f"Разрешены только SELECT/WITH запросы, получено: {head!r}")
    if ";" in cleaned:
        raise ValueError("Точка с запятой запрещена (нельзя выполнять несколько запросов)")
    bad = _FORBIDDEN.search(cleaned)
    if bad:
        raise ValueError(f"Запрещённое ключевое слово: {bad.group(0)!r}")


def run_select(sql: str, params: dict[str, Any] | list[Any] | None = None, *, limit: int = 200) -> list[dict[str, Any]]:
    """Выполнить SELECT-запрос и вернуть список словарей.

    Параметры передаются как named (`%(name)s`) либо positional (`%s`).
    Жёсткий лимит на количество строк — защита от выгрузки всей таблицы.
    """
    _validate_select(sql)
    if not cfg.database_url:
        raise RuntimeError("DATABASE_URL не задан в config/.env — query_db недоступен")

    # statement_timeout — защита от долгих запросов
    conn_str = _normalize_dsn(cfg.database_url)
    with psycopg.connect(conn_str, row_factory=dict_row, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute("SET LOCAL statement_timeout = '30s'")
            cur.execute(sql, params or {})
            rows = cur.fetchmany(limit)
            return [dict(r) for r in rows]


def list_tables() -> list[str]:
    """Список таблиц в схеме public — для отладки/самопроверки."""
    rows = run_select(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        limit=500,
    )
    return [r["tablename"] for r in rows]


def describe_table(table: str) -> list[dict[str, Any]]:
    """Описание колонок таблицы."""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
        raise ValueError(f"Недопустимое имя таблицы: {table!r}")
    return run_select(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %(t)s
        ORDER BY ordinal_position
        """,
        {"t": table},
        limit=200,
    )
