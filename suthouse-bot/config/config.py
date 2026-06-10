"""Конфигурация бота. Читает config/.env через python-dotenv."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(_ENV_PATH)


def _parse_whitelist(raw: str) -> set[int]:
    ids: set[int] = set()
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            ids.add(int(chunk))
        except ValueError:
            continue
    return ids


def _bool(raw: str, default: bool = False) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass
class Config:
    bot_token: str = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", "").strip())
    whitelist: set[int] = field(
        default_factory=lambda: _parse_whitelist(os.getenv("WHITELIST_IDS", ""))
    )

    odata_url: str = field(
        default_factory=lambda: os.getenv(
            "ODATA_BASE_URL",
            "https://185-35-223-42.sslip.io/house/odata/standard.odata",
        ).rstrip("/")
    )
    odata_user: str = field(default_factory=lambda: os.getenv("ODATA_USER", "odata.user"))
    odata_password: str = field(default_factory=lambda: os.getenv("ODATA_PASSWORD", ""))
    odata_verify_ssl: bool = field(
        default_factory=lambda: _bool(os.getenv("ODATA_VERIFY_SSL", "false"), default=False)
    )

    dashscope_key: str = field(default_factory=lambda: os.getenv("DASHSCOPE_API_KEY", "").strip())
    dashscope_url: str = field(
        default_factory=lambda: os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        ).rstrip("/")
    )
    llm_model: str = field(default_factory=lambda: os.getenv("QWEN_LLM_MODEL", "qwen-plus"))
    asr_model: str = field(default_factory=lambda: os.getenv("QWEN_ASR_MODEL", "qwen3-asr-flash"))

    timezone: str = field(default_factory=lambda: os.getenv("TIMEZONE", "Asia/Almaty"))
    company_name: str = field(default_factory=lambda: os.getenv("COMPANY_NAME", "SUT HOUSE"))

    # Postgres проекта Suthouse — для прямых SQL-запросов
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "").strip())

    # Базовый URL Next.js приложения + общий AUTH_SECRET для подписи cookie
    app_base_url: str = field(
        default_factory=lambda: os.getenv("APP_BASE_URL", "http://127.0.0.1:3007").rstrip("/")
    )
    auth_secret: str = field(default_factory=lambda: os.getenv("AUTH_SECRET", "").strip())
    auth_user: str = field(default_factory=lambda: os.getenv("AUTH_USER", "bot").strip())

    def validate(self) -> list[str]:
        problems: list[str] = []
        if not self.bot_token:
            problems.append("TELEGRAM_BOT_TOKEN не задан")
        if not self.whitelist:
            problems.append("WHITELIST_IDS пуст — бот никого не пустит")
        if not self.odata_url:
            problems.append("ODATA_BASE_URL не задан")
        if not self.odata_password:
            problems.append("ODATA_PASSWORD не задан")
        if not self.dashscope_key:
            problems.append("DASHSCOPE_API_KEY не задан")
        if not self.database_url:
            problems.append("DATABASE_URL не задан — query_db работать не будет")
        if not self.auth_secret:
            problems.append("AUTH_SECRET не задан — use_api работать не будет")
        return problems


cfg = Config()
