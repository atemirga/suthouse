import { prisma } from '@/lib/db';
import { addMonths, format, isBefore, isAfter, parse } from 'date-fns';
import { resolvePeriod, emptyMatrix, type PeriodInput, type Granularity } from './period';

export type OpiuCategory =
  | 'revenue'
  | 'cogs'
  | 'var_expenses'
  | 'payroll'
  | 'rent'
  | 'marketing'
  | 'admin'
  | 'logistics'
  | 'taxes'
  | 'interest'
  | 'other_income'
  | 'other_expense'
  | 'capex'
  | 'financing_in'
  | 'financing_out';

export interface OpiuTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  varExpenses: number;
  marginalProfit: number;
  payroll: number;
  rent: number;
  marketing: number;
  admin: number;
  logistics: number;
  amortization: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpense: number;
  interest: number;
  ebt: number;          // Earnings Before Taxes — прибыль до налогообложения
  taxes: number;
  adjustments: number;
  netProfit: number;
  netMargin: number;
}

export type RowKind = 'header' | 'value' | 'sum' | 'pct';

export interface OpiuRow {
  id: string;
  label: string;
  level: number;
  kind: RowKind;
  category?: OpiuCategory;
  values: Record<string, number>;
  total: number;
  isPct?: boolean;
  drilldownCategory?: OpiuCategory; // для drill-down
}

export interface ColumnMeta {
  // Статус закрытия месяца в 1С. Заполняется только для granularity='month'.
  closed: boolean;
  closedAt: Date | null;
  // Проведён ли расчёт фактической себестоимости — критично для COGS.
  // Если месяц не закрыт, COGS остаётся «скользящей» и может отличаться от
  // фактической после закрытия.
  hasActualCost: boolean;
}

export interface OpiuReport {
  from: Date;
  to: Date;
  granularity: Granularity;
  columns: string[];
  rows: OpiuRow[];
  totals: Record<string, OpiuTotals>; // по столбцам
  grandTotal: OpiuTotals;
  columnsMeta: Record<string, ColumnMeta>;
}

interface CategoryBucket {
  byCol: Record<string, number>;
  total: number;
}

function emptyTotals(): OpiuTotals {
  return {
    revenue: 0, cogs: 0, grossProfit: 0, grossMargin: 0,
    varExpenses: 0, marginalProfit: 0,
    payroll: 0, rent: 0, marketing: 0, admin: 0, logistics: 0,
    amortization: 0, ebitda: 0, ebitdaMargin: 0,
    operatingProfit: 0,
    otherIncome: 0, otherExpense: 0, interest: 0, ebt: 0, taxes: 0,
    adjustments: 0, netProfit: 0, netMargin: 0,
  };
}

function addToBucket(buckets: Record<string, CategoryBucket>, cat: string, col: string, amount: number) {
  if (!buckets[cat]) buckets[cat] = { byCol: {}, total: 0 };
  buckets[cat].byCol[col] = (buckets[cat].byCol[col] || 0) + amount;
  buckets[cat].total += amount;
}

export async function buildOpiu(input: PeriodInput): Promise<OpiuReport> {
  const period = resolvePeriod(input);
  const buckets: Record<string, CategoryBucket> = {};

  // 1. Выручка и себестоимость — из реализаций.
  // itemsAmount = только товарная часть (без услуг типа доставки), сходится
  // с «В/С Выручка» 1С. totalAmount = СуммаДокумента (товары + услуги) —
  // для дебиторки, не для выручки.
  // Себестоимость: предпочитаем factCost (берётся из AccumulationRegister_Запасы_
  // RecordType в 1С — единственный источник, который сходится с финансистом
  // в закрытых месяцах). Если factCost не загружен — fallback на totalCost (FIFO).
  // ВАЖНО: вычитаем возвраты от покупателей (Document_ПриходнаяНакладная
  // с ВидОперации=ВозвратОтПокупателя, у нас Zakupka.isReturn=true).
  // В 1С такие документы идут как «приходные», но по сути это снижение выручки.
  const [realizacii, returns] = await Promise.all([
    prisma.realizacia.findMany({
      where: { date: { gte: period.from, lte: period.to }, posted: true },
      select: { date: true, itemsAmount: true, totalCost: true, factCost: true },
    }),
    prisma.zakupka.findMany({
      where: { date: { gte: period.from, lte: period.to }, posted: true, isReturn: true },
      select: { date: true, totalAmount: true },
    }),
  ]);
  for (const r of realizacii) {
    const col = period.bucketOf(r.date);
    addToBucket(buckets, 'revenue', col, r.itemsAmount);
    addToBucket(buckets, 'cogs', col, r.factCost ?? r.totalCost);
  }
  // Возвраты вычитаем из выручки. Себестоимость возвращённого товара
  // (totalCost) у нас в Zakupka не хранится — её можно учесть позже,
  // если потребуется большая точность по cogs.
  for (const r of returns) {
    const col = period.bucketOf(r.date);
    addToBucket(buckets, 'revenue', col, -r.totalAmount);
  }

  // 1b. Списания запасов — разносим по корреспонденции (план счетов 1С).
  // У каждой корреспонденции отдельная строка в ОПиУ: Артык салу, Недостачи,
  // Усушка, Прочие расходы и т.п. — то, что реально проставил финансист.
  // Показываем ВСЕ корреспонденции, которые когда-либо встречались в
  // списаниях (за всю историю). Если в текущем периоде по корреспонденции
  // нет документов — строка остаётся с нулями. Менеджеры иногда классифицируют
  // усушку как недостачу или прочие расходы, поэтому набор активных
  // корреспонденций фиксированный и стабильный от отчёта к отчёту.
  //
  // Источник суммы:
  //   - Корреспонденция «Недостачи» = инвентаризационный документ (десятки позиций).
  //     1С при «Расчете фактической себестоимости» корректно пересчитывает их
  //     по партиям → берём factCost из регистра 1С.
  //   - Прочие корреспонденции («Прочие расходы», «Внутри компании» и т.п.) =
  //     бытовые мини-списания (1-2 позиции, вводятся вручную). Регистр 1С
  //     по таким иногда содержит разнесённые накладные / ошибки проведения
  //     (например, для НФНФ-000028 «Мусор» 1С даёт 29 К ₸/кг для перца,
  //     закупаемого по 1 005 ₸/кг). FIFO totalAmount = цена самого документа,
  //     это и есть то, что использует финансист → берём totalAmount.
  const [writeOffs, knownCorrs] = await Promise.all([
    prisma.writeOff.findMany({
      where: { date: { gte: period.from, lte: period.to }, posted: true },
      select: { date: true, totalAmount: true, factCost: true, correspondenceId: true, correspondenceName: true },
    }),
    prisma.writeOff.findMany({
      where: { posted: true },
      distinct: ['correspondenceId'],
      select: { correspondenceId: true, correspondenceName: true },
    }),
  ]);
  for (const w of writeOffs) {
    const col = period.bucketOf(w.date);
    const corrId = w.correspondenceId || 'no-correspondence';
    const key = `writeoff:${corrId}`;
    const isInventoryAdjustment = w.correspondenceName === 'Недостачи';
    const amount = isInventoryAdjustment ? (w.factCost ?? w.totalAmount) : w.totalAmount;
    addToBucket(buckets, key, col, amount);
    // Также суммируем в общий var_expenses (родитель), чтобы маржинальная
    // прибыль/EBITDA корректно учитывали потери.
    addToBucket(buckets, 'var_expenses', col, amount);
  }
  const writeOffLines: Array<{ key: string; label: string }> = knownCorrs.map((c) => ({
    key: `writeoff:${c.correspondenceId || 'no-correspondence'}`,
    label: c.correspondenceName || 'Без корреспонденции',
  }));
  writeOffLines.sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  // 2. Расходы — из ДДС, сгруппированы по DdsArticle.opiuCategory
  // С учётом AccrualRule: размазываем по месяцам (только для granularity=month/week)
  // Для ЗП-статей выплата может произойти позже месяца начисления (выдача
  // 5 марта = за февраль, см. ПериодРегистрации в 1С). Чтобы попасть
  // в правильный месяц ОПиУ, используем accrualPeriod если он задан.
  // Расширяем окно выборки: cash-платежи начисления-за-период могут лежать
  // и до period.from, и после period.to.
  const ddsWindowFrom = addMonths(period.from, -2);
  const ddsWindowTo = addMonths(period.to, 2);
  const dds = await prisma.ddsDocument.findMany({
    where: {
      OR: [
        { date: { gte: period.from, lte: period.to } },
        { accrualPeriod: { gte: period.from, lte: period.to } },
        // для ЗП-выплат — также берём те, что попадают по любому из двух полей в широкое окно
        {
          AND: [
            { date: { gte: ddsWindowFrom, lte: ddsWindowTo } },
            { accrualPeriod: { not: null } },
          ],
        },
      ],
      direction: 'outflow',
      docType: { not: 'PeremeschenieDC' },
      articleId: { not: null },
    },
    select: { date: true, accrualPeriod: true, amount: true, articleId: true },
  });
  // Так же приходные операции, помеченные как other_income
  const ddsIn = await prisma.ddsDocument.findMany({
    where: {
      date: { gte: period.from, lte: period.to },
      direction: 'inflow',
      docType: { not: 'PeremeschenieDC' },
      articleId: { not: null },
    },
    select: { date: true, amount: true, articleId: true },
  });

  const articles = await prisma.ddsArticle.findMany({
    where: { opiuCategory: { not: null } },
    select: { id: true, opiuCategory: true },
  });
  const artCat = new Map(articles.map((a) => [a.id, a.opiuCategory!]));

  const accruals = await prisma.accrualRule.findMany();
  const accrualMap = new Map(accruals.map((a) => [a.articleId, a]));

  function addExpense(date: Date, articleId: string, amount: number, sign: 1 | -1) {
    const cat = artCat.get(articleId);
    if (!cat) return;
    // Выручка и себестоимость в ОПиУ берутся ИЗ РЕАЛИЗАЦИЙ (метод начисления),
    // а не из ДДС (кассовый метод). Соответствующие статьи ДДС используются только
    // в ДДС-отчёте, чтобы не было двойного учёта.
    if (cat === 'revenue' || cat === 'cogs') return;
    // Перемещения денег и финансирование вход/выход — не расход в ОПиУ
    if (cat === 'transfer') return;

    const accrual = accrualMap.get(articleId);
    if (accrual && accrual.months > 1) {
      const perMonth = (amount * sign) / accrual.months;
      for (let i = 0; i < accrual.months; i++) {
        const targetDate = addMonths(date, i);
        if (isBefore(targetDate, period.from) || isAfter(targetDate, period.to)) continue;
        const col = period.bucketOf(targetDate);
        addToBucket(buckets, cat, col, perMonth);
      }
    } else {
      const col = period.bucketOf(date);
      addToBucket(buckets, cat, col, amount * sign);
    }
  }

  for (const d of dds) {
    if (!d.articleId) continue;
    // Для ЗП-выплат используем ПериодРегистрации (accrualPeriod) — месяц
    // начисления, а не дату выплаты. Это accrual-метод для ФОТ, как у
    // финансиста в Excel-ведомости.
    const cat = artCat.get(d.articleId);
    const effectiveDate = cat === 'payroll' && d.accrualPeriod ? d.accrualPeriod : d.date;
    // Документы, у которых effectiveDate вне периода, пропускаем.
    if (isBefore(effectiveDate, period.from) || isAfter(effectiveDate, period.to)) continue;
    addExpense(effectiveDate, d.articleId, d.amount, 1);
  }
  for (const d of ddsIn) {
    if (!d.articleId) continue;
    const cat = artCat.get(d.articleId);
    // Только прочие доходы — обычная выручка не дублируется. financing_in
    // (получение кредитов) идёт только в ДДС.
    if (cat === 'other_income') {
      // Приход денег по статье other_income → положительная сумма в категории other_income
      const accrual = accrualMap.get(d.articleId);
      if (accrual && accrual.months > 1) {
        const perMonth = d.amount / accrual.months;
        for (let i = 0; i < accrual.months; i++) {
          const targetDate = addMonths(d.date, i);
          if (isBefore(targetDate, period.from) || isAfter(targetDate, period.to)) continue;
          const col = period.bucketOf(targetDate);
          addToBucket(buckets, 'other_income', col, perMonth);
        }
      } else {
        const col = period.bucketOf(d.date);
        addToBucket(buckets, 'other_income', col, d.amount);
      }
    }
  }

  // 3. Амортизация ОС — линейный метод, по месяцам
  const fixedAssets = await prisma.fixedAsset.findMany();
  for (const fa of fixedAssets) {
    if (fa.method !== 'linear') continue;
    const monthly = fa.cost / Math.max(1, fa.usefulMonths);
    let d = new Date(fa.startDate);
    for (let i = 0; i < fa.usefulMonths; i++) {
      if (isAfter(d, period.to)) break;
      if (!isBefore(d, period.from)) {
        const col = period.bucketOf(d);
        addToBucket(buckets, 'amortization' as any, col, monthly);
      }
      d = addMonths(d, 1);
    }
  }

  // 4. Ручные корректировки. Кроме «общих» категорий ОПиУ, поддерживаются
  // детальные категории (loss_*, payroll_*, bonus_*) — они идут И в свою
  // детальную корзину (для отдельной строки в отчёте), И в агрегатную
  // категорию (для итогов EBITDA и т.п.).
  const ADJ_PARENT: Record<string, string> = {
    loss_usushka: 'var_expenses',
    loss_untaq_synyq: 'var_expenses',
    loss_artyk_salu: 'var_expenses',
    loss_inventory_adj: 'var_expenses',
    payroll_production: 'payroll',
    payroll_commercial: 'payroll',
    payroll_admin: 'payroll',
    bonus_production: 'payroll',
    bonus_commercial: 'payroll',
    bonus_admin: 'payroll',
  };
  const ADJ_LABEL: Record<string, string> = {
    loss_usushka: 'Усушка',
    loss_untaq_synyq: 'Ұнтақ/сынық',
    loss_artyk_salu: 'Артык салу (доп.)',
    loss_inventory_adj: 'Излишек/Недостача',
    payroll_production: 'ЗП производственный',
    payroll_commercial: 'ЗП коммерческий',
    payroll_admin: 'ЗП административный',
    bonus_production: 'Бонусы производство',
    bonus_commercial: 'Бонусы коммерч.',
    bonus_admin: 'Бонусы админ.',
  };
  const adjustmentLines: Array<{ key: string; label: string; parent: string }> = [];
  const adjustmentLineSeen = new Set<string>();
  const adjustments = await prisma.manualAdjustment.findMany();
  for (const adj of adjustments) {
    let d: Date;
    try {
      d = parse(adj.month, 'yyyy-MM', new Date());
    } catch {
      continue;
    }
    if (isBefore(d, period.from) || isAfter(d, period.to)) continue;
    const col = period.bucketOf(d);
    const parent = ADJ_PARENT[adj.category];
    if (parent) {
      // Детальная корзина для отдельной строки + агрегатная для итогов.
      // Convention: финансист вводит положительное число для расхода (например,
      // «доп. усушка 1 000 000» = +1 000 000). Расходные категории в bucket
      // хранятся положительными — вычитаются в EBITDA. В UI отображается с минусом.
      addToBucket(buckets, `adj:${adj.category}`, col, adj.amount);
      addToBucket(buckets, parent, col, adj.amount);
      if (!adjustmentLineSeen.has(adj.category)) {
        adjustmentLineSeen.add(adj.category);
        adjustmentLines.push({
          key: `adj:${adj.category}`,
          label: ADJ_LABEL[adj.category] || adj.category,
          parent,
        });
      }
    } else {
      // Общие категории — просто добавляем как раньше.
      addToBucket(buckets, adj.category, col, adj.amount);
    }
  }
  adjustmentLines.sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  // ═══ Сборка итогов ═══
  const totals: Record<string, OpiuTotals> = {};
  for (const col of period.columns) totals[col] = emptyTotals();

  function v(cat: string, col: string): number {
    return buckets[cat]?.byCol[col] || 0;
  }

  for (const col of period.columns) {
    const t = totals[col];
    t.revenue = v('revenue', col);
    t.cogs = v('cogs', col);
    t.grossProfit = t.revenue - t.cogs;
    t.grossMargin = t.revenue ? t.grossProfit / t.revenue : 0;
    t.varExpenses = v('var_expenses', col);
    t.marginalProfit = t.grossProfit - t.varExpenses;
    t.payroll = v('payroll', col);
    t.rent = v('rent', col);
    t.marketing = v('marketing', col);
    t.admin = v('admin', col);
    t.logistics = v('logistics', col);
    t.amortization = v('amortization', col);
    const opex = t.payroll + t.rent + t.marketing + t.admin + t.logistics;
    t.ebitda = t.marginalProfit - opex;
    t.ebitdaMargin = t.revenue ? t.ebitda / t.revenue : 0;
    t.operatingProfit = t.ebitda - t.amortization;
    t.otherIncome = v('other_income', col);
    t.otherExpense = v('other_expense', col);
    t.interest = v('interest', col);
    // EBT (Earnings Before Taxes) — прибыль до налогов: Опер. прибыль + прочие доходы/расходы − проценты
    t.ebt = t.operatingProfit + t.otherIncome - t.otherExpense - t.interest;
    t.taxes = v('taxes', col);
    t.adjustments = v('adjustments_misc' as any, col); // зарезервировано
    t.netProfit = t.ebt - t.taxes + t.adjustments;
    t.netMargin = t.revenue ? t.netProfit / t.revenue : 0;
  }

  // Grand total — сумма по всем столбцам
  const grand = emptyTotals();
  for (const col of period.columns) {
    grand.revenue += totals[col].revenue;
    grand.cogs += totals[col].cogs;
    grand.varExpenses += totals[col].varExpenses;
    grand.payroll += totals[col].payroll;
    grand.rent += totals[col].rent;
    grand.marketing += totals[col].marketing;
    grand.admin += totals[col].admin;
    grand.logistics += totals[col].logistics;
    grand.amortization += totals[col].amortization;
    grand.otherIncome += totals[col].otherIncome;
    grand.otherExpense += totals[col].otherExpense;
    grand.taxes += totals[col].taxes;
    grand.interest += totals[col].interest;
    grand.adjustments += totals[col].adjustments;
  }
  grand.grossProfit = grand.revenue - grand.cogs;
  grand.grossMargin = grand.revenue ? grand.grossProfit / grand.revenue : 0;
  grand.marginalProfit = grand.grossProfit - grand.varExpenses;
  grand.ebitda = grand.marginalProfit - grand.payroll - grand.rent - grand.marketing - grand.admin - grand.logistics;
  grand.ebitdaMargin = grand.revenue ? grand.ebitda / grand.revenue : 0;
  grand.operatingProfit = grand.ebitda - grand.amortization;
  grand.ebt = grand.operatingProfit + grand.otherIncome - grand.otherExpense - grand.interest;
  grand.netProfit = grand.ebt - grand.taxes + grand.adjustments;
  grand.netMargin = grand.revenue ? grand.netProfit / grand.revenue : 0;

  // ═══ Строки отчёта ═══
  const rows: OpiuRow[] = [];
  function addRow(id: string, label: string, level: number, kind: RowKind, getter: (t: OpiuTotals) => number, isPct?: boolean, drill?: OpiuCategory) {
    const values: Record<string, number> = {};
    for (const col of period.columns) values[col] = getter(totals[col]);
    rows.push({
      id, label, level, kind, values,
      total: getter(grand),
      isPct,
      drilldownCategory: drill,
    });
  }

  addRow('revenue', 'Выручка', 0, 'value', (t) => t.revenue, false, 'revenue');
  addRow('cogs', 'Себестоимость продаж', 0, 'value', (t) => -t.cogs, false, 'cogs');
  addRow('gross_profit', 'Валовая прибыль', 0, 'sum', (t) => t.grossProfit);
  addRow('gross_margin', 'Валовая маржа, %', 1, 'pct', (t) => t.grossMargin, true);
  addRow('var_expenses', 'Переменные расходы', 0, 'value', (t) => -t.varExpenses, false, 'var_expenses');
  // Детализация: списания из 1С по корреспонденции + ручные корректировки (loss_*).
  for (const line of writeOffLines) {
    const values: Record<string, number> = {};
    let total = 0;
    for (const col of period.columns) {
      const val = buckets[line.key]?.byCol[col] || 0;
      values[col] = -val;
      total += -val;
    }
    rows.push({ id: line.key, label: `  ${line.label}`, level: 1, kind: 'value', values, total });
  }
  for (const line of adjustmentLines.filter((l) => l.parent === 'var_expenses')) {
    const values: Record<string, number> = {};
    let total = 0;
    for (const col of period.columns) {
      const val = buckets[line.key]?.byCol[col] || 0;
      values[col] = -val;
      total += -val;
    }
    rows.push({ id: line.key, label: `  ${line.label} (корр.)`, level: 1, kind: 'value', values, total });
  }
  addRow('marginal_profit', 'Маржинальная прибыль', 0, 'sum', (t) => t.marginalProfit);
  addRow('opex_header', 'Постоянные операционные расходы', 0, 'header', () => 0);
  addRow('payroll', 'ФОТ (зарплата)', 1, 'value', (t) => -t.payroll, false, 'payroll');
  // Детализация ФОТ по типу персонала (manual adjustments).
  for (const line of adjustmentLines.filter((l) => l.parent === 'payroll')) {
    const values: Record<string, number> = {};
    let total = 0;
    for (const col of period.columns) {
      const val = buckets[line.key]?.byCol[col] || 0;
      values[col] = -val;
      total += -val;
    }
    rows.push({ id: line.key, label: `    ${line.label} (корр.)`, level: 2, kind: 'value', values, total });
  }
  addRow('rent', 'Аренда', 1, 'value', (t) => -t.rent, false, 'rent');
  addRow('marketing', 'Маркетинг', 1, 'value', (t) => -t.marketing, false, 'marketing');
  addRow('logistics', 'Логистика', 1, 'value', (t) => -t.logistics, false, 'logistics');
  addRow('admin', 'Административные', 1, 'value', (t) => -t.admin, false, 'admin');
  addRow('ebitda', 'EBITDA — опер. прибыль до аморт./%/налогов', 0, 'sum', (t) => t.ebitda);
  addRow('ebitda_margin', 'EBITDA маржа, %', 1, 'pct', (t) => t.ebitdaMargin, true);
  addRow('amortization', 'Амортизация (D&A)', 0, 'value', (t) => -t.amortization);
  addRow('operating_profit', 'Операционная прибыль (EBIT)', 0, 'sum', (t) => t.operatingProfit);
  addRow('non_op_header', 'Внеоперационная деятельность', 0, 'header', () => 0);
  addRow('other_income', 'Прочие доходы', 1, 'value', (t) => t.otherIncome, false, 'other_income');
  addRow('other_expense', 'Прочие расходы', 1, 'value', (t) => -t.otherExpense, false, 'other_expense');
  addRow('interest', 'Проценты по кредитам', 1, 'value', (t) => -t.interest, false, 'interest');
  addRow('ebt', 'Прибыль до налогов (EBT)', 0, 'sum', (t) => t.ebt);
  addRow('taxes', 'Налог на прибыль', 0, 'value', (t) => -t.taxes, false, 'taxes');
  addRow('adjustments', 'Ручные корректировки', 0, 'value', (t) => t.adjustments);
  addRow('net_profit', 'ЧИСТАЯ ПРИБЫЛЬ', 0, 'sum', (t) => t.netProfit);
  addRow('net_margin', 'Рентабельность по чистой прибыли, %', 1, 'pct', (t) => t.netMargin, true);

  // Статус закрытия месяцев в 1С. Открытые месяцы могут иметь «скользящую»
  // себестоимость и расходиться с финансистом — UI должен пометить их.
  const columnsMeta: Record<string, ColumnMeta> = {};
  if (period.granularity === 'month') {
    const closes = await prisma.monthClose.findMany({
      where: { yearMonth: { in: period.columns } },
      select: { yearMonth: true, closedAt: true, hasActualCost: true },
    });
    const closeMap = new Map(closes.map((c) => [c.yearMonth, c]));
    for (const col of period.columns) {
      const c = closeMap.get(col);
      columnsMeta[col] = {
        closed: !!c,
        closedAt: c?.closedAt || null,
        hasActualCost: c?.hasActualCost || false,
      };
    }
  } else {
    for (const col of period.columns) {
      columnsMeta[col] = { closed: false, closedAt: null, hasActualCost: false };
    }
  }

  return {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    columns: period.columns,
    rows,
    totals,
    grandTotal: grand,
    columnsMeta,
  };
}

// Drill-down: документы за период по категории
export async function drillOpiu(category: OpiuCategory, from: Date, to: Date) {
  if (category === 'revenue' || category === 'cogs') {
    const realizacii = await prisma.realizacia.findMany({
      where: { date: { gte: from, lte: to }, posted: true },
      orderBy: { date: 'desc' },
      take: 500,
      select: {
        id: true, date: true, number: true, kontragentName: true,
        itemsAmount: true, totalCost: true, factCost: true, comment: true,
      },
    });
    return realizacii.map((r) => ({
      id: r.id,
      date: r.date,
      number: r.number,
      counterparty: r.kontragentName,
      amount: category === 'revenue' ? r.itemsAmount : (r.factCost ?? r.totalCost),
      comment: r.comment,
    }));
  }
  // Расходы / прочие — из ДДС
  const articles = await prisma.ddsArticle.findMany({
    where: { opiuCategory: category },
    select: { id: true },
  });
  const articleIds = articles.map((a) => a.id);
  if (articleIds.length === 0) return [];

  const docs = await prisma.ddsDocument.findMany({
    where: {
      date: { gte: from, lte: to },
      articleId: { in: articleIds },
      docType: { not: 'PeremeschenieDC' },
    },
    orderBy: { date: 'desc' },
    take: 500,
    select: {
      id: true, date: true, number: true, kontragentName: true,
      articleName: true, amount: true, comment: true, direction: true,
    },
  });
  return docs.map((d) => ({
    id: d.id,
    date: d.date,
    number: d.number,
    counterparty: d.kontragentName,
    article: d.articleName,
    amount: d.amount,
    comment: d.comment,
  }));
}
