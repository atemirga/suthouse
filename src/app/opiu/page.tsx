import PeriodPicker from '@/components/PeriodPicker';
import OpiuTable from '@/components/OpiuTable';
import ExportButton from '@/components/ExportButton';
import { buildOpiu } from '@/lib/reports/opiu';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; granularity?: string };
}

export default async function OpiuPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const granularity = (searchParams.granularity as any) || 'month';

  const report = await buildOpiu({ from, to, granularity });

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ОПиУ — Отчёт о прибылях и убытках</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Метод начисления (P&amp;L) · {report.columns.length} {granularity === 'month' ? 'месяцев' : granularity === 'week' ? 'недель' : 'дней'} · клик по строке открывает документы
          </p>
        </div>
        <ExportButton endpoint="/api/export/opiu" />
      </div>
      <PeriodPicker />
      <div className="panel">
        <OpiuTable report={report} />
      </div>

      <details className="panel p-4 text-sm text-gray-700" open>
        <summary className="cursor-pointer font-medium text-gray-900">Структура отчёта (multi-step P&amp;L)</summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto whitespace-pre">
{`  Выручка (Revenue)
− Себестоимость продаж (COGS)
══════════════════════════════
= Валовая прибыль (Gross Profit)         · Валовая маржа = / Выручка

− Переменные расходы (Variable Expenses)
══════════════════════════════
= Маржинальная прибыль (Contribution Margin)

− Постоянные операционные расходы:
   ФОТ (Personnel), Аренда (Rent), Маркетинг (Marketing),
   Логистика (Logistics), Административные (G&A)
══════════════════════════════
= EBITDA                                 · EBITDA маржа = / Выручка

− Амортизация (Depreciation & Amortization)
══════════════════════════════
= Операционная прибыль (EBIT)

± Прочие доходы / расходы
− Проценты по кредитам (Interest)
══════════════════════════════
= Прибыль до налогов (EBT)

− Налог на прибыль (Income Tax)
± Ручные корректировки
══════════════════════════════
= ЧИСТАЯ ПРИБЫЛЬ (Net Income)            · Рентабельность = / Выручка`}
          </pre>
        </div>
      </details>

      <details className="panel p-4 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Что значат термины</summary>
        <div className="mt-3 space-y-2.5 leading-relaxed">
          <p>
            <b>Знак минус</b> у строк затрат — формат P&amp;L: расходы вычитаются из
            выручки, поэтому показываются с минусом. Жирные строки — итоги.
          </p>
          <p>
            <b>Валовая прибыль</b> = Выручка − Себестоимость. Сколько остаётся
            до вычета операционных расходов.
          </p>
          <p>
            <b>Маржинальная прибыль</b> = Валовая − Переменные расходы (растущие пропорционально продажам).
            Если переменные не настроены, равна валовой.
          </p>
          <p>
            <b>EBITDA</b> = Earnings Before Interest, Taxes, Depreciation, Amortization.
            Показывает &laquo;денежную&raquo; эффективность операционной деятельности до
            амортизации, процентов и налогов. Стандартный международный термин — на русском
            не переводится.
          </p>
          <p>
            <b>EBIT</b> (Операционная прибыль) = EBITDA − Амортизация.
            Прибыль от основной деятельности, очищенная от амортизации, до процентов и налогов.
          </p>
          <p>
            <b>EBT</b> (Earnings Before Taxes) = EBIT + прочие доходы − прочие расходы − проценты.
            Прибыль до налогообложения. Используется как база для расчёта налога.
          </p>
          <p>
            <b>Чистая прибыль</b> = EBT − Налог на прибыль.
          </p>
        </div>
      </details>

      <details className="panel p-4 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Источники данных и оговорки точности</summary>
        <div className="mt-3 space-y-2.5 leading-relaxed">
          <p>
            <b>Метод начисления (accrual)</b> — выручка и себестоимость берутся из
            реализаций (1С Расходная накладная) по дате документа, независимо от даты оплаты.
            Это правильный подход для P&amp;L согласно МСФО.
          </p>
          <p>
            <b>Себестоимость — настоящий FIFO по партиям.</b> Все закупки (без возвратов)
            кладутся в очередь по дате; каждая продажа списывается с головы очереди до
            закрытия проданного количества. Так каждая единица товара получает цену той
            партии, из которой она физически ушла. Расчёт пересчитывается при каждой
            синхронизации после загрузки закупок и реализаций. Если для номенклатуры история
            закупок старше окна синка ({process.env.SYNC_DAYS_BACK || 60} дн.), используется
            взвешенная средняя цена по всем известным закупкам как fallback.
          </p>
          <p>
            <b>Прочие расходы</b> (ФОТ, аренда, налоги, проценты, и т.д.) берутся из ДДС-документов
            по дате платежа. Это формально кассовый метод. Чтобы правильно
            распределять во времени крупные предоплаты (страховка, аренда вперёд),
            используйте <a href="/settings/accruals" className="text-brand-600 hover:underline">правила Accrual</a>.
          </p>
          <p>
            <b>Возвраты от покупателей</b> (документы &laquo;Приходная накладная&raquo; с видом
            операции <code>ВозвратОтПокупателя</code>) — отделены и не попадают в карту
            закупочных цен.
          </p>
          <p>
            <b>Внутренние перемещения</b> денег (между кассой и р/с) исключены из ОПиУ и ДДС
            — это не операционная деятельность.
          </p>
          <p>
            <b>НДС</b> в выручке: суммы из 1С приходят &laquo;с НДС&raquo; (как и в КЗ для УНФ).
            Если ваше предприятие плательщик НДС, к строгому управленческому ОПиУ
            рекомендуется добавить ручную корректировку.
          </p>
          <p>
            <b>Корректность зависит от</b> <a href="/settings/mapping" className="text-brand-600 hover:underline">маппинга статей ДДС</a>.
            Каждая статья из 1С должна быть привязана к категории ОПиУ — иначе расход не
            попадёт в свою группу.
          </p>
        </div>
      </details>
    </div>
  );
}
