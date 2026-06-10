"""HTTP-клиент к Next.js API проекта Suthouse.

Берёт AUTH_SECRET (тот же, что у самого приложения), локально подписывает
HMAC-cookie `suthouse_auth` и шлёт GET-запросы. Бот read-only, поэтому
POST/PATCH/DELETE сюда сознательно не реализованы.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any

import httpx

from config.config import cfg

log = logging.getLogger(__name__)

_COOKIE_NAME = "suthouse_auth"
_SESSION_TTL = 7 * 86400  # 7 дней — больше TTL пусть выдаёт сам пользователь


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _sign_session() -> str:
    """Сформировать токен формата `<payload_b64>.<sig_b64>` идентично src/lib/auth.ts."""
    if not cfg.auth_secret:
        raise RuntimeError("AUTH_SECRET не задан — не могу подписать сессию")
    payload = {
        "user": cfg.auth_user or "bot",
        "exp": int(time.time()) + _SESSION_TTL,
        "nonce": secrets.token_hex(8),
    }
    data = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64url(
        hmac.new(cfg.auth_secret.encode("utf-8"), data.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{data}.{sig}"


def _client() -> httpx.Client:
    token = _sign_session()
    return httpx.Client(
        base_url=cfg.app_base_url,
        cookies={_COOKIE_NAME: token},
        timeout=60.0,
        headers={"Accept": "application/json", "User-Agent": "suthouse-bot/1.0"},
    )


def get(path: str, params: dict[str, Any] | None = None) -> Any:
    """GET-запрос к API. Возвращает распарсенный JSON.

    `path` принимается как `/api/...` либо короткое имя — мы добавим `/api/`
    автоматически. Это упрощает работу LLM (можно отдавать «dds» вместо «/api/dds»).
    """
    if not path:
        raise ValueError("Пустой path")
    if not path.startswith("/"):
        path = "/api/" + path.lstrip("/")
    if not path.startswith("/api/"):
        raise ValueError(f"Разрешены только пути под /api/, получено: {path!r}")

    # Чистим None-значения чтобы не присылать `&foo=None`
    clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
    with _client() as c:
        r = c.get(path, params=clean)
        if r.status_code == 401:
            raise RuntimeError("401 от API — AUTH_SECRET бота не совпадает с приложением")
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        if "application/json" in ct:
            return r.json()
        # CSV/text — отдаём как строку (например /api/export/*)
        return r.text
