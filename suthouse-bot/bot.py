"""Telegram-бот SUT HOUSE: aiogram 3, text + voice → Qwen → отчёты из 1С."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from contextlib import asynccontextmanager

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import Message

from config.config import cfg
from core import asr, guards, llm, selftest, usage
from functions.reports import DISPATCH

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("suthouse-bot")

_REGISTRY_PATH = Path(__file__).resolve().parent / "functions" / "registry.json"

_CONFIRM_WORDS = {"да", "ок", "yes", "y", "подтверждаю", "ага", "+"}


def _tools() -> list[dict]:
    """Преобразовать registry.json в формат tools для Qwen/OpenAI."""
    registry = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
    tools = []
    for fn in registry:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": fn["name"],
                    "description": fn["description"],
                    "parameters": fn["parameters"],
                },
            }
        )
    return tools


def _guard(msg: Message) -> bool:
    return bool(msg.from_user) and guards.is_allowed(msg.from_user.id)


# bot/dispatcher создаются в main() после проверки токена
bot: Bot | None = None
dp = Dispatcher()


_LOADER_FRAMES = ("🔄 Думаю.", "🔄 Думаю..", "🔄 Думаю...")


@asynccontextmanager
async def loader(msg: Message):
    """Показывает «🔄 Думаю...» с typing-индикатором, пока работает агент.
    При выходе из контекста tick-задача гарантированно ОСТАНОВЛЕНА —
    после этого можно безопасно редактировать placeholder с финальным ответом.

    Внутри контекста НЕ редактируй placeholder — будет race с tick'ом.
    """
    placeholder = await msg.answer(_LOADER_FRAMES[0])
    stop_flag = asyncio.Event()

    async def tick() -> None:
        i = 0
        while not stop_flag.is_set():
            try:
                await msg.bot.send_chat_action(msg.chat.id, action="typing")
            except TelegramBadRequest as e:
                log.warning("tick: send_chat_action TBR: %s", e)
            except Exception as e:  # noqa: BLE001
                log.warning("tick: send_chat_action failed: %s", e)
            # ждём 1.5с или раннюю остановку
            try:
                await asyncio.wait_for(stop_flag.wait(), timeout=1.5)
                return  # стоп получили — выходим, НЕ редактируем
            except asyncio.TimeoutError:
                pass
            if stop_flag.is_set():
                return
            i = (i + 1) % len(_LOADER_FRAMES)
            try:
                await placeholder.edit_text(_LOADER_FRAMES[i])
            except TelegramBadRequest as e:
                # «message is not modified» — нормально (тот же фрейм);
                # «message to edit not found» / «message can't be edited» — нет
                if "not modified" not in str(e).lower():
                    log.warning("tick: edit_text TBR: %s", e)
            except Exception as e:  # noqa: BLE001
                log.warning("tick: edit_text failed: %s", e)

    task = asyncio.create_task(tick())
    try:
        yield placeholder
    finally:
        stop_flag.set()
        try:
            await asyncio.wait_for(task, timeout=3)
        except asyncio.TimeoutError:
            log.warning("loader: tick task didn't stop in 3s — cancelling")
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as e:  # noqa: BLE001
                log.warning("loader: tick cancel raised: %s", e)
        except asyncio.CancelledError:
            pass


@dp.message(Command("start"))
async def cmd_start(msg: Message) -> None:
    if not _guard(msg):
        return
    await msg.answer(
        f"Привет! Я ассистент {cfg.company_name} по управленческой отчётности.\n\n"
        "Что умею (read-only):\n"
        "• поступления денег за период\n"
        "• остаток денег на кассах и счетах\n"
        "• продажи за период\n"
        "• дебиторская задолженность\n\n"
        "Можно текстом или голосом. Примеры:\n"
        "— «поступления за сегодня»\n"
        "— «сколько денег есть»\n"
        "— «продажи за май»\n"
        "— «кто должен»\n\n"
        "/usage — расход на ASR и LLM за текущий месяц."
    )


@dp.message(Command("usage"))
async def cmd_usage(msg: Message) -> None:
    if not _guard(msg):
        return
    await msg.answer(usage.month_summary(msg.from_user.id))


@dp.message(Command("selftest"))
async def cmd_selftest(msg: Message) -> None:
    """Прогон всех источников — DB, API, OData, агент. Занимает 5-15 сек."""
    if not _guard(msg):
        return
    # тяжёлая операция → в отдельный поток, чтобы не блокировать loop
    args = msg.text.split(maxsplit=1) if msg.text else []
    include_llm = "fast" not in (args[1].lower() if len(args) > 1 else "")
    placeholder = await msg.answer("🩺 Запускаю selftest…")
    try:
        report = await asyncio.to_thread(selftest.run_selftest, include_llm=include_llm)
    except Exception as e:  # noqa: BLE001
        log.exception("selftest crashed")
        report = f"selftest упал: {e}"
    try:
        await placeholder.edit_text(report)
    except TelegramBadRequest as e:
        log.warning("selftest edit failed: %s", e)
        await msg.answer(report)


async def _handle_text(msg: Message, text: str) -> None:
    uid = msg.from_user.id
    text_norm = text.strip().lower()
    log.info("user=%s query=%r", uid, text)

    # 1) Подтверждение pending write-операции
    if guards.has_pending(uid) and text_norm in _CONFIRM_WORDS:
        action = guards.pop_pending(uid)
        await msg.answer(
            "Подтверждение получено, но запись в 1С пока не подключена. "
            f"Черновик был: {action}"
        )
        return

    # 2) Агентный цикл с loader-плейсхолдером.
    # ВАЖНО: внутри `async with` НЕ редактируем placeholder — это даст
    # race с tick-задачей. Финальный edit делаем ПОСЛЕ выхода из контекста.
    placeholder: Message | None = None
    error_msg: str | None = None
    reply: str | None = None
    try:
        async with loader(msg) as placeholder:
            try:
                result = await asyncio.to_thread(
                    llm.run_agent,
                    text,
                    tools=_tools(),
                    dispatch=DISPATCH,
                    final_tools={"query_1c", "report_dds"},
                    max_steps=6,
                )
            except Exception as e:  # noqa: BLE001
                log.exception("LLM error")
                error_msg = f"Ошибка LLM: {e}"
            else:
                u = result.get("usage", {})
                usage.add_tokens(uid, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                calls = result.get("calls", [])
                log.info(
                    "user=%s steps=%d calls=%s",
                    uid,
                    len(calls),
                    [(c["function"], c["params"]) for c in calls],
                )
                reply = result.get("reply") or "Пустой ответ."
                log.info(
                    "user=%s reply_first_line=%r",
                    uid,
                    reply.splitlines()[0] if reply else "",
                )
    except Exception as e:  # noqa: BLE001
        log.exception("loader error")
        error_msg = f"Ошибка: {e}"

    # === Здесь tick гарантированно остановлен, race невозможен. ===
    final_text = error_msg or reply or "Пустой ответ."
    assert placeholder is not None  # loader всегда создаёт placeholder

    log.info(
        "user=%s final_edit message_id=%s len=%d preview=%r",
        uid, placeholder.message_id, len(final_text),
        final_text[:80].replace("\n", " "),
    )
    try:
        if len(final_text) <= 4000:
            await placeholder.edit_text(final_text)
        else:
            await placeholder.edit_text(final_text[:4000] + "\n…")
            await msg.answer(final_text[4000:])
    except TelegramBadRequest as e:
        log.warning("final edit_text TBR (%s), sending as new message", e)
        try:
            await msg.answer(final_text)
        except Exception as e2:  # noqa: BLE001
            log.exception("final fallback msg.answer failed: %s", e2)
    except Exception as e:  # noqa: BLE001
        log.exception("final edit_text crashed: %s", e)
        try:
            await msg.answer(final_text)
        except Exception:  # noqa: BLE001
            log.exception("final fallback also crashed")


@dp.message(F.text)
async def on_text(msg: Message) -> None:
    if not _guard(msg):
        return
    await _handle_text(msg, msg.text or "")


@dp.message(F.voice)
async def on_voice(msg: Message) -> None:
    if not _guard(msg):
        return
    assert bot is not None
    file = await bot.get_file(msg.voice.file_id)
    audio_url = f"https://api.telegram.org/file/bot{cfg.bot_token}/{file.file_path}"

    res = asr.transcribe(audio_url)
    usage.add_asr(msg.from_user.id, res.get("seconds", 0.0))

    text = (res.get("text") or "").strip()
    if not text:
        err = res.get("error")
        await msg.answer(
            "Не удалось распознать речь. Повторите голосовое сообщение."
            + (f"\n({err})" if err else "")
        )
        return

    await msg.answer(f"🎙️ Распознал: «{text}»")
    await _handle_text(msg, text)


async def main() -> None:
    global bot
    problems = cfg.validate()
    if problems:
        log.warning("Конфиг неполный: %s", "; ".join(problems))

    if not cfg.bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN не задан — заполните config/.env")

    bot = Bot(token=cfg.bot_token)
    log.info("Запуск бота. Whitelist: %s", sorted(cfg.whitelist))
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
