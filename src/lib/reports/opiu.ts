import { prisma } from '@/lib/db';
import { addMonths, format, isBefore, isAfter, parse } from 'date-fns';
import { resolvePeriod, emptyMatrix, type PeriodInput, type Granularity } from './period';
import { loadAmortizationFromSheet } from '@/lib/sync/amortization';

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

export type OpiuView = 'standard' | 'financist';

export async function buildOpiu(input: PeriodInput & { view?: OpiuView }): Promise<OpiuReport> {
  const period = resolvePeriod(input);
  const view: OpiuView = input.view || 'standard';
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
  const [realizacii, returns, itemsAgg] = await Promise.all([
    prisma.realizacia.findMany({
      where: { date: { gte: period.from, lte: period.to }, posted: true },
      select: { date: true, itemsAmount: true, totalCost: true, factCost: true },
    }),
    prisma.zakupka.findMany({
      where: { date: { gte: period.from, lte: period.to }, posted: true, isReturn: true },
      select: { date: true, totalAmount: true },
    }),
    // Для финансистского вида: gross = sum(qty*price) на уровне items
    // (= сумма по прайсу), discount = sum(RealizaciaItem.discount) = sum(qty*price - amount).
    // Финансист в своей таблице показывает скидку меньше (133K vs наших 367K за апр.26)
    // — у него фильтр по типу скидки («наличная»), у нас в БД признака нет.
    prisma.$queryRaw<Array<{ date: Date; gross: number; discount: number }>>`
      SELECT r.date,
             SUM(ri.quantity * ri.price)             AS gross,
             SUM(ri.quantity * ri.price - ri.amount) AS discount
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.date >= ${period.from} AND r.date <= ${period.to} AND r.posted = true
      GROUP BY r.date
    `,
  ]);
  for (const r of realizacii) {
    const col = period.bucketOf(r.date);
    addToBucket(buckets, 'revenue', col, r.itemsAmount);
    addToBucket(buckets, 'cogs', col, r.factCost ?? r.totalCost);
  }
  for (const row of itemsAgg) {
    const col = period.bucketOf(row.date);
    addToBucket(buckets, 'revenue_gross', col, Number(row.gross));
    addToBucket(buckets, 'revenue_discount', col, Number(row.discount));
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

  // Все статьи (для маппинга id→category и id→name).
  // name начинается с кода вида "1.06" / "2.01" / "3.05" — по нему строится
  // финансистская иерархия.
  const articles = await prisma.ddsArticle.findMany({
    select: { id: true, name: true, opiuCategory: true },
  });
  const artCat = new Map(
    articles.filter((a) => a.opiuCategory).map((a) => [a.id, a.opiuCategory!]),
  );
  const artName = new Map(articles.map((a) => [a.id, a.name]));
  // Извлекает код статьи ("1.06" из "1.06 Аренда склада"). Возвращает '' если
  // имя не начинается с кода.
  function articleCode(name: string | undefined): string {
    if (!name) return '';
    const m = name.match(/^(\d+\.\d+)/);
    return m ? m[1] : '';
  }

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

    // Параллельно копим по конкретной статье (article:1.06, article:1.07, ...)
    // — это нужно финансистскому виду, где каждая статья отдельная строка.
    // ИСКЛЮЧЕНИЕ: 1.38 Налог на прибыль — финансист его не берёт из cash-платежей
    // (платится 2 раза в год большой суммой), а считает расчётно как 2% от Kaspi
    // PAY / Halyk POS. Cash-платежи по 1.38 в article:1.38 не пишем — туда
    // запишется только расчётный налог ниже.
    const code = articleCode(artName.get(articleId));
    const articleKey = code && code !== '1.38' ? `article:${code}` : null;

    const accrual = accrualMap.get(articleId);
    if (accrual && accrual.months > 1) {
      const perMonth = (amount * sign) / accrual.months;
      for (let i = 0; i < accrual.months; i++) {
        const targetDate = addMonths(date, i);
        if (isBefore(targetDate, period.from) || isAfter(targetDate, period.to)) continue;
        const col = period.bucketOf(targetDate);
        addToBucket(buckets, cat, col, perMonth);
        if (articleKey) addToBucket(buckets, articleKey, col, perMonth);
      }
    } else {
      const col = period.bucketOf(date);
      addToBucket(buckets, cat, col, amount * sign);
      if (articleKey) addToBucket(buckets, articleKey, col, amount * sign);
    }
  }

  for (const d of dds) {
    if (!d.articleId) continue;
    // Для ЗП-выплат используем ПериодРегистрации (accrualPeriod) — месяц
    // начисления, а не дату выплаты. Это accrual-метод для ФОТ, как у
    // финансиста в Excel-ведомости.
    // ИСКЛЮЧЕНИЕ: 1.37 «Налоги на ФОТ» — финансист считает cash-методом
    // (по дате выплаты), хотя статья отнесена к категории payroll.
    const cat = artCat.get(d.articleId);
    const code = articleCode(artName.get(d.articleId));
    const useAccrual = cat === 'payroll' && d.accrualPeriod && code !== '1.37';
    const effectiveDate = useAccrual ? d.accrualPeriod! : d.date;
    // Документы, у которых effectiveDate вне периода, пропускаем.
    if (isBefore(effectiveDate, period.from) || isAfter(effectiveDate, period.to)) continue;
    addExpense(effectiveDate, d.articleId, d.amount, 1);
  }
  for (const d of ddsIn) {
    if (!d.articleId) continue;
    const cat = artCat.get(d.articleId);
    // Приходы по статьям расходов (например 1.41 «Прочее» бывает с
    // положительным сальдо) — учитываем как уменьшение расхода (отрицательное
    // значение в article:CODE), чтобы совпадало с финансистом.
    // 1.38 — исключаем (см. выше про расчётный налог).
    const code = articleCode(artName.get(d.articleId));
    if (code && code !== '1.38') {
      if (isBefore(d.date, period.from) || isAfter(d.date, period.to)) {
        // вне периода — пропускаем
      } else {
        const col = period.bucketOf(d.date);
        addToBucket(buckets, `article:${code}`, col, -d.amount);
      }
    }

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

  // 2c. Налог на прибыль — расчётно, 2% × inflow по эквайрингу Kaspi PAY и
  // Halyk Bank. Финансист начисляет налог ежемесячно по этой формуле (хотя
  // фактическая оплата происходит 2 раза в год по налоговому периоду).
  // Учитываем только эти счета:
  //   - Kaspi PAY (KZT) — эквайринг Kaspi
  //   - Halyk POS (KZT) — эквайринг Halyk
  //   - «… Есенкул халык банк» — расчётный счёт Halyk
  // НЕ учитываем: Kaspi GOLD (личный счёт), Каспи Голд Депозит и т.п.
  // Только эквайринговые счета (POS-терминалы + онлайн-приём платежей).
  // НЕ включаем расчётные счета Halyk (вроде «0001 халык банк»), Kaspi GOLD
  // (личные карты владельца) и депозиты.
  const taxAccounts = await prisma.bankAccount.findMany({
    where: {
      OR: [
        { name: { contains: 'Kaspi PAY', mode: 'insensitive' } },
        { name: { contains: 'Halyk POS', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
  });
  if (taxAccounts.length) {
    const inflow = await prisma.ddsDocument.findMany({
      where: {
        date: { gte: period.from, lte: period.to },
        direction: 'inflow',
        accountId: { in: taxAccounts.map((a) => a.id) },
      },
      select: { date: true, amount: true },
    });
    for (const d of inflow) {
      const col = period.bucketOf(d.date);
      // 2% от прихода — налог на прибыль; кладём в article:1.38 (положительная
      // сумма = расход в финансистском представлении).
      addToBucket(buckets, 'article:1.38', col, d.amount * 0.02);
    }
  }

  // 2d. Факт благотворительности — cash-выплаты по статьям «3.06 Благотворительность»
  // и «3.07 Медресе». В обычном потоке они уже идут в other_expense / article:3.xx,
  // но для отдельной строки «Благотворительность — факт» собираем их в bucket
  // `charity_fact`. Bucket-и независимы, двойного учёта нет.
  const charityArticles = await prisma.ddsArticle.findMany({
    where: {
      OR: [
        { name: { contains: 'Благотвор', mode: 'insensitive' } },
        { name: { contains: 'Медресе', mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  if (charityArticles.length) {
    const charityDocs = await prisma.ddsDocument.findMany({
      where: {
        date: { gte: period.from, lte: period.to },
        direction: 'outflow',
        articleId: { in: charityArticles.map((a) => a.id) },
      },
      select: { date: true, amount: true },
    });
    for (const d of charityDocs) {
      const col = period.bucketOf(d.date);
      addToBucket(buckets, 'charity_fact', col, d.amount);
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

  // 3b. Амортизация из Google-таблицы финансиста (ведомость ОС). Только в
  // помесячном разрезе — там готовые помесячные итоги.
  if (period.granularity === 'month') {
    try {
      const amortByMonth = await loadAmortizationFromSheet();
      for (const [ym, amount] of amortByMonth) {
        if (!period.columns.includes(ym)) continue;
        addToBucket(buckets, 'amortization' as any, ym, amount);
      }
    } catch (e) {
      console.warn('[opiu] amortization sheet read failed:', (e as Error).message);
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

  if (view === 'financist') {
    rows.push(...buildFinancistRows(buckets, writeOffLines, period.columns));
    // columnsMeta заполняется ниже
    const columnsMeta = await fetchColumnsMeta(period);
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
  const columnsMeta = await fetchColumnsMeta(period);

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

async function fetchColumnsMeta(period: { granularity: Granularity; columns: string[] }): Promise<Record<string, ColumnMeta>> {
  const meta: Record<string, ColumnMeta> = {};
  if (period.granularity === 'month') {
    const closes = await prisma.monthClose.findMany({
      where: { yearMonth: { in: period.columns } },
      select: { yearMonth: true, closedAt: true, hasActualCost: true },
    });
    const closeMap = new Map(closes.map((c) => [c.yearMonth, c]));
    for (const col of period.columns) {
      const c = closeMap.get(col);
      meta[col] = {
        closed: !!c,
        closedAt: c?.closedAt || null,
        hasActualCost: c?.hasActualCost || false,
      };
    }
  } else {
    for (const col of period.columns) {
      meta[col] = { closed: false, closedAt: null, hasActualCost: false };
    }
  }
  return meta;
}

// ═══════════════════════════════════════════════════════════════════════════
// ФИНАНСИСТСКИЙ ВИД ОПиУ (7 категорий, помесячная нарезка статей ДДС).
//
// Структура и порядок строк взяты 1-в-1 из эталонной таблицы финансиста
// SUT HOUSE (см. docs/finance/financist-source-data.md, раздел 6).
// Каждая статья 1.06–1.41 — отдельная строка под своей группой:
//   Переменные / Прямые постоянные / Общепроизводственные / Административные /
//   Коммерческие / Ниже EBITDA. Промежуточные итоги: Маржинальный доход,
//   Валовая прибыль по направлениям, Валовая прибыль, EBITDA, Чистая прибыль.
// ═══════════════════════════════════════════════════════════════════════════

interface FinSection {
  total_id: string;
  total_label: string;
  // Коды статей ДДС (по началу name — "1.06", "1.07", ...), которые суммируются
  // в эту секцию. Каждая статья даёт отдельную строку. Имя строки = полное
  // имя статьи из БД (его поправит финансист в одном месте — в справочнике
  // статей 1С).
  article_codes: string[];
}

// Переменные: эквайринг + доставка клиентам + расходы по доставке от клиента.
// 1.15 и 1.16 финансист объединяет в одну логическую строку «Доставка клиентам»,
// но мы показываем их раздельно (по факту 1С). Проверено: с учётом 1.16
// маржинальный доход апреля совпадает с финансистом до 0.7%.
const FIN_VARIABLE_CODES = ['1.14', '1.15', '1.16'];
const FIN_DIRECT_FIXED_CODES = ['1.18', '1.19', '1.20', '1.21', '1.23'];
const FIN_OVERHEAD_CODES = ['1.06', '1.09', '1.12', '1.17', '1.22', '1.34', '1.35', '1.41'];
const FIN_ADMIN_CODES = ['1.07', '1.08', '1.11', '1.13', '1.24', '1.25', '1.26', '1.27', '1.28', '1.29', '1.31', '1.32', '1.33', '1.36', '1.37'];
const FIN_COMMERCIAL_CODES = ['1.10', '1.30'];
const FIN_BELOW_EBITDA_CODES = ['1.38'];

function buildFinancistRows(
  buckets: Record<string, CategoryBucket>,
  writeOffLines: Array<{ key: string; label: string }>,
  columns: string[],
): OpiuRow[] {
  const rows: OpiuRow[] = [];
  // Названия статей ДДС из БД — храним рядом со значениями. Если в БД статьи
  // нет (например, в данный период не было движений), показываем код + дефолт.
  // Имя берём по первому встретившемуся бакету article:CODE — но если ничего
  // нет, оставляем код-плейсхолдер.

  const v = (key: string, col: string) => buckets[key]?.byCol[col] || 0;
  const sumOver = (keys: string[], col: string) => keys.reduce((s, k) => s + v(k, col), 0);
  const colTotal = (keys: string[]) => {
    let t = 0;
    for (const k of keys) for (const c of columns) t += v(k, c);
    return t;
  };

  // Помощник: добавить строку с заранее посчитанными значениями.
  function pushRow(
    id: string,
    label: string,
    level: number,
    kind: RowKind,
    valuesByCol: (col: string) => number,
    opts: { isPct?: boolean; negate?: boolean } = {},
  ) {
    const values: Record<string, number> = {};
    let total = 0;
    for (const col of columns) {
      const raw = valuesByCol(col);
      const v = opts.negate ? -raw : raw;
      values[col] = v;
      total += v;
    }
    rows.push({ id, label, level, kind, values, total, isPct: opts.isPct });
  }
  function pushPctRow(id: string, label: string, level: number, num: (col: string) => number, den: (col: string) => number) {
    const values: Record<string, number> = {};
    let totNum = 0, totDen = 0;
    for (const col of columns) {
      const n = num(col), d = den(col);
      values[col] = d ? n / d : 0;
      totNum += n; totDen += d;
    }
    rows.push({ id, label, level, kind: 'pct', values, total: totDen ? totNum / totDen : 0, isPct: true });
  }

  // Получить статьи (article:CODE) одной группы — отсортированные по коду.
  function articleRows(codes: string[], level: number) {
    for (const code of codes) {
      const key = `article:${code}`;
      const b = buckets[key];
      // Показываем строку даже если пусто — для визуальной устойчивости отчёта.
      const label = `${code} ${ARTICLE_LABELS[code] || ''}`.trim();
      pushRow(
        key,
        label,
        level,
        'value',
        (col) => -(b?.byCol[col] || 0),
      );
    }
  }

  // ─── Выручка ────────────────────────────────────────────────────────────
  pushRow('fin_revenue_net', 'Выручка нетто', 0, 'sum', (col) => v('revenue', col));
  pushRow('fin_revenue_gross', 'Выручка', 1, 'value', (col) => v('revenue_gross', col));
  pushRow('fin_revenue_discount', 'Скидка наличка', 1, 'value', (col) => v('revenue_discount', col), { negate: true });

  // Сумма потерь (по корреспонденциям + ручные корректировки loss_*)
  const lossSum = (col: string) =>
    writeOffLines.reduce((s, l) => s + v(l.key, col), 0) +
    ['adj:loss_usushka', 'adj:loss_untaq_synyq', 'adj:loss_artyk_salu', 'adj:loss_inventory_adj']
      .reduce((s, k) => s + v(k, col), 0);
  const varCodesSum = (col: string) => sumOver(FIN_VARIABLE_CODES.map((c) => `article:${c}`), col);
  const directFixedSum = (col: string) => sumOver(FIN_DIRECT_FIXED_CODES.map((c) => `article:${c}`), col);

  // ─── Производственные расходы = Переменные + Прямые постоянные ──────────
  pushRow(
    'fin_prod_total',
    'Производственные расходы',
    0,
    'sum',
    (col) => -(v('cogs', col) + varCodesSum(col) + lossSum(col) + directFixedSum(col)),
  );

  // Переменные = себестоимость + 1.14/1.15/1.16 + потери (writeoffs + adj_loss_*)
  pushRow(
    'fin_var_total',
    'Переменные',
    1,
    'sum',
    (col) => -(v('cogs', col) + varCodesSum(col) + lossSum(col)),
  );
  // Детализация переменных
  pushRow('fin_var_cogs', 'Себестоимость', 2, 'value', (col) => v('cogs', col), { negate: true });
  articleRows(FIN_VARIABLE_CODES, 2);
  // Списания (по корреспонденции 1С — как они проставлены)
  for (const line of writeOffLines) {
    pushRow(line.key, `  ${line.label}`, 2, 'value', (col) => v(line.key, col), { negate: true });
  }
  // Ручные корректировки потерь, если введены
  const lossAdjLabels: Record<string, string> = {
    'adj:loss_usushka': 'Усушка (корр.)',
    'adj:loss_untaq_synyq': 'Ұнтақ/сынық (корр.)',
    'adj:loss_artyk_salu': 'Артык салу (корр.)',
    'adj:loss_inventory_adj': 'Излишек/Недостача (корр.)',
  };
  for (const [key, label] of Object.entries(lossAdjLabels)) {
    if (!buckets[key]) continue;
    pushRow(key, `  ${label}`, 2, 'value', (col) => v(key, col), { negate: true });
  }

  // Маржинальный доход = выручка нетто − cogs − дополнительные переменные − потери
  const marginalGetter = (col: string) =>
    v('revenue', col) - v('cogs', col) - varCodesSum(col) - lossSum(col);
  pushRow('fin_marginal', 'Маржинальный доход', 0, 'sum', marginalGetter);
  pushPctRow('fin_marginal_pct', 'Рентабельность по маржинальному доходу, %', 1, marginalGetter, (col) => v('revenue', col));

  // ─── Прямые постоянные ──────────────────────────────────────────────────
  pushRow('fin_direct_fixed_total', 'Прямые постоянные', 1, 'sum', (col) => -directFixedSum(col));
  articleRows(FIN_DIRECT_FIXED_CODES, 2);

  // ─── Валовая прибыль по направлениям ────────────────────────────────────
  const grossDirGetter = (col: string) => marginalGetter(col) - directFixedSum(col);
  pushRow('fin_gross_dir', 'Валовая прибыль по направлениям', 0, 'sum', grossDirGetter);
  pushPctRow('fin_gross_dir_pct', 'Рентабельность по направлениям, %', 1, grossDirGetter, (col) => v('revenue', col));

  // ─── Общепроизводственные ───────────────────────────────────────────────
  const overheadSum = (col: string) => sumOver(FIN_OVERHEAD_CODES.map((c) => `article:${c}`), col);
  pushRow('fin_overhead_total', 'Общепроизводственные', 0, 'sum', (col) => -overheadSum(col));
  articleRows(FIN_OVERHEAD_CODES, 1);

  // ─── Валовая прибыль ────────────────────────────────────────────────────
  const grossGetter = (col: string) => grossDirGetter(col) - overheadSum(col);
  pushRow('fin_gross', 'Валовая прибыль', 0, 'sum', grossGetter);

  // ─── Косвенные расходы (адм + коммерч) ──────────────────────────────────
  const adminSum = (col: string) => sumOver(FIN_ADMIN_CODES.map((c) => `article:${c}`), col);
  const commercialSum = (col: string) => sumOver(FIN_COMMERCIAL_CODES.map((c) => `article:${c}`), col);
  pushRow('fin_indirect_total', 'Косвенные расходы', 0, 'sum', (col) => -(adminSum(col) + commercialSum(col)));
  pushRow('fin_admin_total', 'Административные', 1, 'sum', (col) => -adminSum(col));
  articleRows(FIN_ADMIN_CODES, 2);
  pushRow('fin_commercial_total', 'Коммерческие', 1, 'sum', (col) => -commercialSum(col));
  articleRows(FIN_COMMERCIAL_CODES, 2);

  // ─── EBITDA ─────────────────────────────────────────────────────────────
  const ebitdaGetter = (col: string) => grossGetter(col) - adminSum(col) - commercialSum(col);
  pushRow('fin_ebitda', 'Операционная прибыль (EBITDA)', 0, 'sum', ebitdaGetter);
  pushPctRow('fin_ebitda_pct', 'Рентабельность по операционной прибыли, %', 1, ebitdaGetter, (col) => v('revenue', col));

  // ─── Расходы ниже EBITDA ────────────────────────────────────────────────
  const belowEbitdaSum = (col: string) => sumOver(FIN_BELOW_EBITDA_CODES.map((c) => `article:${c}`), col);
  pushRow('fin_below_ebitda_total', 'Расходы ниже EBITDA', 0, 'sum', (col) => -(belowEbitdaSum(col) + v('amortization', col)));
  articleRows(FIN_BELOW_EBITDA_CODES, 1);
  pushRow('fin_amortization', 'Амортизация', 1, 'value', (col) => v('amortization', col), { negate: true });

  // ─── Налог на прибыль: план / факт (справочно, до ЧП) ───────────────────
  // План = расчётный налог 2% × (Kaspi PAY + Halyk POS), уже сложен в
  // article:1.38 в buildOpiu(). Эта же сумма влияет на ЧП ниже — здесь
  // показываем её отдельно для сверки с фактом.
  // Факт = cash-выплаты по статье 1.38 (cat='taxes' в addExpense).
  pushRow('fin_tax_plan', 'Налог на прибыль — план (2% × Kaspi/Halyk)', 0, 'value', (col) => v('article:1.38', col), { negate: true });
  pushRow('fin_tax_fact', 'Налог на прибыль — факт (по выплатам 1.38)', 0, 'value', (col) => v('taxes', col), { negate: true });

  // ─── Благотворительность: план (20% × ЧП с переносом) / факт ────────────
  // База плана = max(0, ЧП до благотворительности) × 20%. Если до-благ. ЧП ≤ 0 —
  // план 0 (нельзя жертвовать из убытка).
  // Перенос: если в прошлом месяце факт < план — недоплата прибавляется
  // к плану текущего месяца; если факт > план — переплата вычитается.
  // carry[i] = effectivePlan[i-1] - fact[i-1]; effectivePlan[i] = base[i] + carry[i].
  // ⚠️ Перенос считается только в пределах выбранного периода.
  // Факт благотворительности (3.06 Благотворительность + 3.07 Медресе) ВЫЧИТАЕТСЯ
  // из чистой прибыли — это реальные выплаты, уменьшающие финрезультат собственника.
  const preCharityNetGetter = (col: string) => ebitdaGetter(col) - belowEbitdaSum(col) - v('amortization', col);
  const CHARITY_RATE = 0.2;
  const charityPlanByCol: Record<string, number> = {};
  let charityCarry = 0;
  for (const col of columns) {
    const base = Math.max(0, preCharityNetGetter(col)) * CHARITY_RATE;
    const effectivePlan = base + charityCarry;
    charityPlanByCol[col] = effectivePlan;
    const fact = v('charity_fact', col);
    charityCarry = effectivePlan - fact;
  }
  pushRow('fin_charity_plan', 'Благотворительность — план (20% × ЧП + перенос)', 0, 'value', (col) => charityPlanByCol[col] || 0, { negate: true });
  pushRow('fin_charity_fact', 'Благотворительность — факт (3.06 + 3.07)', 0, 'value', (col) => v('charity_fact', col), { negate: true });

  // ─── Чистая прибыль = EBITDA − налог 1.38 − амортизация − благотв. факт ──
  const netGetter = (col: string) => preCharityNetGetter(col) - v('charity_fact', col);
  pushRow('fin_net', 'Чистая прибыль', 0, 'sum', netGetter);
  pushPctRow('fin_net_pct', 'Рентабельность по чистой прибыли, %', 1, netGetter, (col) => v('revenue', col));

  return rows;
}

// Подписи статей — для случаев когда в БД статья ещё не загрузилась.
// Если в БД будет другое имя — оно перекроется через addExpense (там используем
// настоящее имя из artName). Эти лейблы — только дефолт.
const ARTICLE_LABELS: Record<string, string> = {
  '1.06': 'Аренда склада',
  '1.07': 'Аренда офиса',
  '1.08': 'Коммунальные услуги',
  '1.09': 'Заработная плата производственного персонала',
  '1.10': 'Заработная плата менеджеров по продажам',
  '1.11': 'Заработная плата административного персонала',
  '1.12': 'Мотивационный',
  '1.13': 'Комиссия банка',
  '1.14': 'Комиссия Эквайринг',
  '1.15': 'Доставка клиентам',
  '1.16': 'За доставку (от клиента)',
  '1.17': 'Транспортные расходы',
  '1.18': 'Парковка',
  '1.19': 'Расходы на ГСМ',
  '1.20': 'Расходы на содержания транспорта',
  '1.21': 'Покупка инвентаря-производство',
  '1.22': 'Расходы Склад',
  '1.23': 'Типографические услуги-производство',
  '1.24': 'Офисные расходы',
  '1.25': 'Уборка помещений',
  '1.26': 'Услуги связи',
  '1.27': 'IT инфраструктура',
  '1.28': 'Консультационные и проф услуги',
  '1.29': 'Обучение персонала',
  '1.30': 'Расходы на маркетинг',
  '1.31': 'Прочие административные расходы',
  '1.32': 'Командировочные расходы',
  '1.33': 'Корпоративные мероприятия',
  '1.34': 'Ремонт и обслуживание ОС',
  '1.35': 'Ремонт и обслуживание ТС',
  '1.36': 'Представительские расходы-адм',
  '1.37': 'Налоги на ФОТ',
  '1.38': 'Налоги на прибыль',
  '1.41': 'Прочее',
};

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
