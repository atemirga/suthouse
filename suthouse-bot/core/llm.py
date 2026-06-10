"""Qwen LLM (OpenAI-compat DashScope endpoint) + агентный цикл.

run_agent(user_text, tools, dispatch, max_steps) — даём LLM до N шагов
с tool-calling. Каждый ход:
  1. LLM либо отвечает текстом → возвращаем.
  2. Либо вызывает tool — выполняем, скармливаем результат как
     tool-message, идём на следующий шаг.

Это позволяет LLM сначала позвать `find_entity`, увидеть результат,
потом позвать `query_1c` с правильным именем — без участия пользователя.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from openai import BadRequestError, OpenAI

from config.config import cfg


def _is_content_filter(e: Exception) -> bool:
    """DashScope (Alibaba Qwen) контент-фильтр — известный false-positive
    на финансовых данных с реальными именами клиентов. Отдельный код,
    чтобы дать пользователю осмысленный ответ, а не сырой JSON ошибки."""
    s = str(e).lower()
    return "data_inspection_failed" in s or "inappropriate content" in s

log = logging.getLogger(__name__)

_KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
_PROMPT_PATH = _KNOWLEDGE_DIR / "system_prompt.txt"
# Дополнительные справочники, которые мы хотим прокинуть LLM как референс.
# Порядок важен — самое нужное сверху.
_REFERENCE_FILES = ("api_catalog.md", "db_schema.md", "pages_catalog.md")
_TZ = ZoneInfo(cfg.timezone)

_client = OpenAI(api_key=cfg.dashscope_key, base_url=cfg.dashscope_url)


def _load_system_prompt() -> str:
    try:
        raw = _PROMPT_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "Ты ассистент по управленческой отчётности."

    parts = [raw]
    for name in _REFERENCE_FILES:
        p = _KNOWLEDGE_DIR / name
        if not p.exists():
            continue
        body = p.read_text(encoding="utf-8").strip()
        parts.append(f"\n══════════════════════════════════════════════════════════════════════\n"
                     f"СПРАВОЧНИК: {name}\n"
                     f"══════════════════════════════════════════════════════════════════════\n{body}")

    today = datetime.now(_TZ).date().isoformat()
    return "\n".join(parts).replace("{CURRENT_DATE}", today)


def run_agent(
    user_text: str,
    tools: list[dict[str, Any]],
    dispatch: dict[str, Callable[[dict[str, Any]], str]],
    *,
    final_tools: set[str] | None = None,
    max_steps: int = 4,
) -> dict[str, Any]:
    """Цикл tool-calling до итогового ответа.

    Возвращает:
      {"reply": str, "calls": [{"function","params","output"}], "usage": {...}}

    final_tools — имена «терминальных» инструментов, после вызова которых
    мы СРАЗУ возвращаем результат пользователю (без ещё одного хода LLM).
    Это экономит токены, когда LLM уже получила всю нужную информацию.
    """
    final_tools = final_tools or set()

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _load_system_prompt()},
        {"role": "user", "content": user_text},
    ]
    calls_log: list[dict[str, Any]] = []
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}

    for step in range(max_steps):
        try:
            resp = _client.chat.completions.create(
                model=cfg.llm_model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                temperature=0,
            )
        except BadRequestError as e:
            if _is_content_filter(e):
                log.warning("DashScope content filter tripped on step %d: %s", step + 1, e)
                # Если уже есть tool-результаты — отдаём пользователю их (хотя бы что-то),
                # просим переформулировать или дробить.
                if calls_log:
                    last_out = calls_log[-1]["output"]
                    return {
                        "reply": (
                            "⚠ Контент-фильтр LLM-провайдера (DashScope) отклонил данные "
                            "(скорее всего, из-за реальных имён клиентов в выборке).\n\n"
                            "Сырые данные из источника:\n\n"
                            f"{last_out[:1500]}"
                        ),
                        "calls": calls_log,
                        "usage": total_usage,
                    }
                return {
                    "reply": (
                        "⚠ Контент-фильтр LLM-провайдера (DashScope) отклонил запрос. "
                        "Переформулируйте короче или уточните период/контрагента."
                    ),
                    "calls": calls_log,
                    "usage": total_usage,
                }
            raise
        u = resp.usage
        total_usage["prompt_tokens"] += getattr(u, "prompt_tokens", 0) or 0
        total_usage["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0

        msg = resp.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None) or []

        if not tool_calls:
            reply = (msg.content or "").strip() or "Не понял запрос — переформулируйте."
            return {"reply": reply, "calls": calls_log, "usage": total_usage}

        # Добавляем assistant-сообщение с tool_calls в историю
        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )

        terminal_output: str | None = None
        for tc in tool_calls:
            fn_name = tc.function.name
            try:
                params = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                params = {}

            log.info("agent step=%d call=%s params=%s", step + 1, fn_name, params)

            fn = dispatch.get(fn_name)
            if not fn:
                output = f"Неизвестная функция: {fn_name}"
            else:
                try:
                    output = fn(params)
                except Exception as e:  # noqa: BLE001
                    log.exception("tool %s failed", fn_name)
                    output = f"Ошибка функции {fn_name}: {e}"

            calls_log.append({"function": fn_name, "params": params, "output": output})

            # tool-result в историю
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": output,
                }
            )

            if fn_name in final_tools:
                terminal_output = output

        if terminal_output is not None:
            return {"reply": terminal_output, "calls": calls_log, "usage": total_usage}

    # Превысили max_steps — делаем ОДИН финальный заход без tools, чтобы LLM
    # сформулировала человеческий ответ из накопленных tool-результатов.
    # Без этого пользователь получает сырой JSON последнего вызова.
    if calls_log:
        try:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Сформулируй итоговый ответ пользователю на русском "
                        "на основе данных, которые ты уже получил выше. "
                        "Не вызывай больше инструментов. Числа с разделителем "
                        "тысяч и валютой «₸». Если данных недостаточно — "
                        "честно скажи об этом."
                    ),
                }
            )
            resp = _client.chat.completions.create(
                model=cfg.llm_model,
                messages=messages,
                temperature=0,
            )
            u = resp.usage
            total_usage["prompt_tokens"] += getattr(u, "prompt_tokens", 0) or 0
            total_usage["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0
            reply = (resp.choices[0].message.content or "").strip()
            if reply:
                return {"reply": reply, "calls": calls_log, "usage": total_usage}
        except Exception as e:  # noqa: BLE001
            log.warning("final-formulation pass failed: %s", e)

    last = calls_log[-1]["output"] if calls_log else "Слишком много шагов, не смог закончить."
    return {"reply": last, "calls": calls_log, "usage": total_usage}


# Совместимость со старым API — больше нигде не используется, но на всякий
def choose_function(user_text: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
    messages = [
        {"role": "system", "content": _load_system_prompt()},
        {"role": "user", "content": user_text},
    ]
    resp = _client.chat.completions.create(
        model=cfg.llm_model,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0,
    )
    msg = resp.choices[0].message
    usage = {
        "prompt_tokens": getattr(resp.usage, "prompt_tokens", 0),
        "completion_tokens": getattr(resp.usage, "completion_tokens", 0),
    }
    tool_calls = getattr(msg, "tool_calls", None) or []
    if tool_calls:
        call = tool_calls[0]
        try:
            params = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError:
            params = {}
        return {"function": call.function.name, "params": params, "usage": usage, "reply": None}
    return {
        "function": None,
        "params": {},
        "usage": usage,
        "reply": (msg.content or "").strip() or "Не понял запрос — переформулируйте.",
    }
