"""Контроль доступа и подтверждения для write-операций.

Принципы:
- whitelist — единственный шлюз для всех команд.
- write-функции в памяти ожидают подтверждения «да» от пользователя.
- На этапе 7 (текущем) WRITE_FUNCTIONS пуст — реальная запись добавится позже.
"""
from __future__ import annotations

from typing import Any

from config.config import cfg

# user_id -> сведения о черновике write-операции
_pending: dict[int, dict[str, Any]] = {}

# Имена функций, которые модифицируют 1С. Заполняется на этапе 12.
WRITE_FUNCTIONS: set[str] = set()


def is_allowed(user_id: int) -> bool:
    return user_id in cfg.whitelist


def is_write_function(name: str) -> bool:
    return name in WRITE_FUNCTIONS


def stage_write(user_id: int, action: dict[str, Any]) -> None:
    _pending[user_id] = action


def pop_pending(user_id: int) -> dict[str, Any] | None:
    return _pending.pop(user_id, None)


def has_pending(user_id: int) -> bool:
    return user_id in _pending


def clear_pending(user_id: int) -> None:
    _pending.pop(user_id, None)
