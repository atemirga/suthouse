// Парсинг периода (from/to) из query params в правильные UTC-моменты,
// трактуя строки 'yyyy-MM-dd' как локальное Asia/Almaty (UTC+5).
//
// Зачем: PeriodPicker отдаёт `from=2026-05-24&to=2026-05-24` (yyyy-MM-dd
// без времени). Если на сервере (TZ=UTC) парсить через parseISO — получим
// окно [00:00 UTC, 00:00 UTC] = 0 секунд, и пресет «Сегодня»/«Вчера»
// возвращает пустые отчёты. Здесь приклеиваем явный +05:00 — окно
// получается [00:00 Almaty, 23:59:59 Almaty], как ожидает пользователь.
//
// Если строка приходит со временем или TZ-суффиксом — используем как есть.

const ALMATY_OFFSET = '+05:00';

function hasTime(s: string): boolean {
  return s.includes('T') || s.includes(' ');
}

function hasTz(s: string): boolean {
  return s.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(s);
}

export function parsePeriodFrom(s: string): Date {
  if (hasTime(s)) {
    return new Date(hasTz(s) ? s : s + ALMATY_OFFSET);
  }
  return new Date(s + 'T00:00:00' + ALMATY_OFFSET);
}

export function parsePeriodTo(s: string): Date {
  if (hasTime(s)) {
    return new Date(hasTz(s) ? s : s + ALMATY_OFFSET);
  }
  return new Date(s + 'T23:59:59.999' + ALMATY_OFFSET);
}
