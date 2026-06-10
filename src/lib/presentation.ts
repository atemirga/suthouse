/**
 * РЕЖИМ ПРЕЗЕНТАЦИИ — маскировка реальных цифр девятками.
 *
 * Зачем: на демо/презентации нужно скрыть настоящие суммы, но НЕ трогать данные
 * в БД и не хранить реальные числа в файлах/коммитах. Маска работает только на
 * этапе ОТОБРАЖЕНИЯ: каждая цифра в любом отформатированном числе заменяется на 9
 * (разделители, знак минус, дробная часть, " млн", " %", "₸" — сохраняются).
 *
 *   193 400  →  999 999
 *   -3 452   →  -9 999
 *   12,3 %   →  99,9 %
 *
 * Реальные числа продолжают считаться в памяти, но НИКОГДА не попадают на экран,
 * в HTML или в логи веб-сервера, пока маска включена.
 *
 * ── КАК ВКЛЮЧИТЬ ──────────────────────────────────────────────────────────────
 *   1. В .env.local (или .env) добавить строку:   NEXT_PUBLIC_PRESENTATION_MODE=1
 *   2. Пересобрать и перезапустить:
 *        npm run build && sudo systemctl restart suthouse-app
 *      (в dev-режиме достаточно перезапустить `npm run dev`)
 *
 * ── КАК ВЕРНУТЬ РЕАЛЬНЫЕ ЦИФРЫ ─────────────────────────────────────────────────
 *   1. Удалить строку NEXT_PUBLIC_PRESENTATION_MODE из .env.local (или поставить =0)
 *   2. Пересобрать и перезапустить.
 *
 * Когда флаг выключен — этот модуль НИЧЕГО не делает (нулевой оверхед), поэтому
 * его можно держать в коде постоянно.
 */

export const PRESENTATION_MODE =
  process.env.NEXT_PUBLIC_PRESENTATION_MODE === "1";

/** Заменяет каждую цифру на 9, сохраняя всё остальное (пробелы, знаки, запятые). */
function maskDigits(input: string): string {
  return input.replace(/[0-9]/g, "9");
}

// Глобально подменяем форматтеры чисел один раз за процесс/бандл.
// Покрывает и центральный lib/format.ts, и локальные форматтеры компонентов:
// все они в итоге используют либо Intl.NumberFormat, либо
// Number.prototype.toLocaleString.
declare global {
  // eslint-disable-next-line no-var
  var __presentationMaskInstalled: boolean | undefined;
}

function installPresentationMask(): void {
  if (!PRESENTATION_MODE) return;
  if (globalThis.__presentationMaskInstalled) return; // идемпотентно (HMR)
  globalThis.__presentationMaskInstalled = true;

  // 1) Intl.NumberFormat — оборачиваем .format() так, чтобы результат маскировался.
  //    ВАЖНО: .format — это getter на прототипе; прямое присваивание не сработает
  //    (а в strict-режиме бросит исключение), поэтому переопределяем через
  //    Object.defineProperty — создаём собственное свойство на экземпляре.
  const OrigNumberFormat = Intl.NumberFormat;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PatchedNumberFormat: any = function (this: unknown, ...args: any[]) {
    const nf = new OrigNumberFormat(...args);
    const origFormat = nf.format.bind(nf);
    Object.defineProperty(nf, "format", {
      value: (value: number | bigint) => maskDigits(origFormat(value)),
      writable: true,
      configurable: true,
    });
    return nf;
  };
  PatchedNumberFormat.prototype = OrigNumberFormat.prototype;
  PatchedNumberFormat.supportedLocalesOf =
    OrigNumberFormat.supportedLocalesOf.bind(OrigNumberFormat);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Intl as any).NumberFormat = PatchedNumberFormat;

  // 2) Number.prototype.toLocaleString — то же для «v.toLocaleString(...)».
  //    Внимание: Date.prototype.toLocaleString и Intl.DateTimeFormat отдельные,
  //    поэтому ДАТЫ остаются нетронутыми — маскируются только числа.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origToLocaleString: any = Number.prototype.toLocaleString;
  // eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
  (Number.prototype as any).toLocaleString = function (
    this: number,
    ...args: any[]
  ): string {
    return maskDigits(origToLocaleString.apply(this, args));
  };

  // 3) Number.prototype.toFixed — компактные форматтеры графиков/дашборда строят
  //    подписи через (n/1e6).toFixed(1) + " млн" и т.п., минуя Intl. Маскируем и их,
  //    чтобы на осях/тултипах recharts не светились реальные числа.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origToFixed: any = Number.prototype.toFixed;
  // eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
  (Number.prototype as any).toFixed = function (
    this: number,
    ...args: any[]
  ): string {
    return maskDigits(origToFixed.apply(this, args));
  };

  if (typeof window === "undefined") {
    console.warn(
      "[presentation] РЕЖИМ ПРЕЗЕНТАЦИИ ВКЛЮЧЁН — все цифры маскируются девятками.",
    );
  }
}

installPresentationMask();
