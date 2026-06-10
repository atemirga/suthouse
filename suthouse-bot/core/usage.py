"""SQLite-учёт расхода: секунды ASR + токены LLM, по пользователю и дню."""
from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "usage.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS usage (
            user_id     INTEGER NOT NULL,
            day         TEXT    NOT NULL,
            asr_seconds REAL    NOT NULL DEFAULT 0,
            in_tokens   INTEGER NOT NULL DEFAULT 0,
            out_tokens  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day)
        )
        """
    )
    return c


def _today() -> str:
    return date.today().isoformat()


def add_asr(user_id: int, seconds: float) -> None:
    if seconds <= 0:
        return
    with _conn() as c:
        c.execute(
            """
            INSERT INTO usage (user_id, day, asr_seconds, in_tokens, out_tokens)
            VALUES (?, ?, ?, 0, 0)
            ON CONFLICT(user_id, day) DO UPDATE SET
                asr_seconds = asr_seconds + excluded.asr_seconds
            """,
            (user_id, _today(), float(seconds)),
        )


def add_tokens(user_id: int, in_tok: int, out_tok: int) -> None:
    in_tok = max(int(in_tok or 0), 0)
    out_tok = max(int(out_tok or 0), 0)
    if in_tok == 0 and out_tok == 0:
        return
    with _conn() as c:
        c.execute(
            """
            INSERT INTO usage (user_id, day, asr_seconds, in_tokens, out_tokens)
            VALUES (?, ?, 0, ?, ?)
            ON CONFLICT(user_id, day) DO UPDATE SET
                in_tokens  = in_tokens  + excluded.in_tokens,
                out_tokens = out_tokens + excluded.out_tokens
            """,
            (user_id, _today(), in_tok, out_tok),
        )


def month_summary(user_id: int) -> str:
    today = date.today()
    month_prefix = today.strftime("%Y-%m")
    with _conn() as c:
        row = c.execute(
            """
            SELECT
                COALESCE(SUM(asr_seconds), 0),
                COALESCE(SUM(in_tokens),   0),
                COALESCE(SUM(out_tokens),  0)
            FROM usage
            WHERE user_id = ? AND day LIKE ?
            """,
            (user_id, f"{month_prefix}-%"),
        ).fetchone()
    seconds, in_tok, out_tok = row or (0, 0, 0)
    minutes = seconds / 60.0
    return (
        f"Расход за {month_prefix}:\n"
        f"• распознавание речи: {minutes:.1f} мин\n"
        f"• токены LLM: вход {in_tok}, выход {out_tok}"
    )
