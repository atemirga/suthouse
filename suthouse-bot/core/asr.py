"""Распознавание речи через DashScope (qwen3-asr-flash).

Принимает публичный URL аудио (Telegram getFile даёт временную ссылку).
"""
from __future__ import annotations

import logging
from typing import Any

import dashscope

from config.config import cfg

log = logging.getLogger(__name__)

dashscope.api_key = cfg.dashscope_key
dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"


def _extract_text(resp: Any) -> str:
    """Достать распознанный текст из ответа DashScope (форматы у моделей меняются)."""
    # Стандартная форма: resp.output.choices[0].message.content
    output = getattr(resp, "output", None) or (resp.get("output") if isinstance(resp, dict) else None)
    if not output:
        return ""

    # choices -> [{message: {content: ... }}]
    choices = output.get("choices") if isinstance(output, dict) else getattr(output, "choices", None)
    if choices:
        msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else getattr(choices[0], "message", {})
        content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            # content может быть [{'text': '...'}] или [{'type':'text','text':'...'}]
            parts = []
            for item in content:
                if isinstance(item, dict):
                    txt = item.get("text") or item.get("transcript")
                    if txt:
                        parts.append(txt)
                elif isinstance(item, str):
                    parts.append(item)
            return " ".join(parts).strip()

    # Альтернативная форма: output.text
    text = output.get("text") if isinstance(output, dict) else getattr(output, "text", None)
    if isinstance(text, str):
        return text.strip()
    return ""


def _extract_seconds(resp: Any) -> float:
    """Длительность аудио в секундах (для учёта расхода)."""
    usage = getattr(resp, "usage", None) or (resp.get("usage") if isinstance(resp, dict) else None)
    if isinstance(usage, dict):
        for key in ("duration", "audio_seconds", "seconds"):
            val = usage.get(key)
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    pass
    return 0.0


def transcribe(audio_url: str) -> dict[str, Any]:
    """Транскрибация аудио. Возвращает {"text": str, "seconds": float}."""
    log.info("ASR call model=%s url=%s", cfg.asr_model, audio_url)
    try:
        resp = dashscope.MultiModalConversation.call(
            model=cfg.asr_model,
            messages=[
                {
                    "role": "system",
                    "content": [{"text": "Расшифруй русскую речь дословно."}],
                },
                {
                    "role": "user",
                    "content": [{"audio": audio_url}],
                },
            ],
            # Без фиксированного language + LID=true → модель сама определяет
            # язык каждого высказывания (нужно для смеси ru/kk на одном пользователе).
            asr_options={"enable_lid": True},
        )
    except Exception as e:  # noqa: BLE001
        log.exception("ASR exception")
        return {"text": "", "seconds": 0.0, "error": str(e)}

    status = getattr(resp, "status_code", None)
    api_msg = getattr(resp, "message", "")
    request_id = getattr(resp, "request_id", "")

    if status and status != 200:
        log.warning("ASR non-200: status=%s msg=%r request_id=%s raw=%r", status, api_msg, request_id, resp)
        return {"text": "", "seconds": 0.0, "error": f"DashScope {status}: {api_msg}"}

    text = _extract_text(resp)
    seconds = _extract_seconds(resp)
    log.info("ASR ok status=%s text_len=%d seconds=%.2f request_id=%s", status, len(text), seconds, request_id)
    if not text:
        log.warning("ASR empty text, raw=%r", resp)
    return {"text": text, "seconds": seconds}
