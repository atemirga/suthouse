// Сборка всех аномалий и подозрительных документов в одно место.
// Используется страницей /anomalies и API /api/anomalies.
//
// Категории:
//   • futureDates       — документы с датой > сегодня (опечатки в 1С)
//   • lossSales         — продажи где себестоимость > выручки (FIFO)
//   • zeroCostSales     — продажи без себестоимости (товар без закупки)
//   • unmappedArticles  — статьи ДДС с оборотом, но без opiuCategory
//   • ddsWithoutArticle — ДДС-документы без привязки к статье
//   • salesWithoutKontragent — реализации без контрагента
//   • zeroPriceSales    — продажи с ценой = 0
//   • zeroQtyItems      — позиции с количеством 0
//   • duplicateNumbers  — документы с одинаковым номером в одной таблице

import { prisma } from '@/lib/db';
import { endOfDay } from 'date-fns';

export interface AnomalyDoc {
  id: string;
  date?: Date | null;
  number?: string | null;
  amount?: number | null;
  detail?: string;
  link?: string;
}

export interface AnomalyCategory {
  key: string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  totalAmount?: number;
  docs: AnomalyDoc[]; // первые 100, чтобы страница не падала
  truncated: boolean;
}

export interface AnomaliesReport {
  generatedAt: Date;
  totalIssues: number;
  categories: AnomalyCategory[];
}

const TAKE = 100;

export async function buildAnomalies(): Promise<AnomaliesReport> {
  const now = new Date();
  // «Будущая дата» = строго после конца сегодняшнего дня. Иначе документы с
  // сегодняшней датой и временем позже текущей секунды попадают сюда —
  // а это не аномалия, это просто свежие проводки.
  const futureCutoff = endOfDay(now);
  const cats: AnomalyCategory[] = [];

  // ─── 1. Будущие даты в любых документах ──────────────────────────────
  const [futureRealiz, futureZakup, futureDds, futureOrders] = await Promise.all([
    prisma.realizacia.findMany({
      where: { date: { gt: futureCutoff } },
      orderBy: { date: 'desc' },
      take: TAKE,
      select: { id: true, date: true, number: true, totalAmount: true, kontragentName: true },
    }),
    prisma.zakupka.findMany({
      where: { date: { gt: futureCutoff } },
      orderBy: { date: 'desc' },
      take: TAKE,
      select: { id: true, date: true, number: true, totalAmount: true, kontragentName: true },
    }),
    prisma.ddsDocument.findMany({
      where: { date: { gt: futureCutoff } },
      orderBy: { date: 'desc' },
      take: TAKE,
      select: { id: true, date: true, number: true, amount: true, kontragentName: true, articleName: true, docType: true },
    }),
    prisma.orderBuyer.findMany({
      where: { date: { gt: futureCutoff } },
      orderBy: { date: 'desc' },
      take: TAKE,
      select: { id: true, date: true, number: true, totalAmount: true, kontragentName: true },
    }),
  ]);
  const futureDocs: AnomalyDoc[] = [
    ...futureRealiz.map((r) => ({ id: r.id, date: r.date, number: r.number, amount: r.totalAmount, detail: `Реализация · ${r.kontragentName || '—'}` })),
    ...futureZakup.map((z) => ({ id: z.id, date: z.date, number: z.number, amount: z.totalAmount, detail: `Закупка · ${z.kontragentName || '—'}` })),
    ...futureDds.map((d) => ({ id: d.id, date: d.date, number: d.number, amount: d.amount, detail: `ДДС (${d.docType}) · ${d.kontragentName || '—'} · ${d.articleName || 'без статьи'}` })),
    ...futureOrders.map((o) => ({ id: o.id, date: o.date, number: o.number, amount: o.totalAmount, detail: `Заказ · ${o.kontragentName || '—'}` })),
  ].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  const futureCount = futureRealiz.length + futureZakup.length + futureDds.length + futureOrders.length;
  cats.push({
    key: 'futureDates',
    title: 'Документы с датой в будущем',
    description: 'Дата документа позже сегодняшней. Чаще всего опечатка оператора в 1С (например, 2026 вместо 2025). Искажают периодные отчёты.',
    severity: 'high',
    count: futureCount,
    totalAmount: futureDocs.reduce((s, d) => s + (d.amount || 0), 0),
    docs: futureDocs.slice(0, TAKE),
    truncated: futureCount > TAKE,
  });

  // ─── 2. Убыточные продажи (cost > revenue) ───────────────────────────
  const lossItems = await prisma.$queryRaw<Array<{
    id: string; date: Date; number: string; nomenclatureName: string | null;
    quantity: number; price: number; amount: number; costPrice: number; costAmount: number; loss: number;
    kontragentName: string | null;
  }>>`
    SELECT ri.id, r.date, r.number, ri."nomenclatureName", ri.quantity, ri.price,
           ri.amount, ri."costPrice", ri."costAmount",
           (ri."costAmount" - ri.amount) AS loss,
           r."kontragentName"
    FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE ri."costAmount" > ri.amount AND ri.amount > 0 AND ri.quantity > 0
      AND r.posted = true
    ORDER BY (ri."costAmount" - ri.amount) DESC
    LIMIT ${TAKE}
  `;
  const lossCount = await prisma.$queryRaw<Array<{ n: bigint; total: number | null }>>`
    SELECT COUNT(*) AS n, SUM(ri."costAmount" - ri.amount)::float AS total
    FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE ri."costAmount" > ri.amount AND ri.amount > 0 AND ri.quantity > 0 AND r.posted = true
  `;
  cats.push({
    key: 'lossSales',
    title: 'Проданы ниже себестоимости',
    description: 'Себестоимость по FIFO выше выручки за позицию. Бывает легально (распродажа, акция, скидка), но если массово — пересмотрите цены.',
    severity: 'medium',
    count: Number(lossCount[0].n),
    totalAmount: lossCount[0].total || 0,
    docs: lossItems.map((i) => ({
      id: i.id,
      date: i.date,
      number: i.number,
      amount: i.loss,
      detail: `${i.nomenclatureName || '—'} · ${i.kontragentName || '—'} · qty ${i.quantity} × ${i.price.toLocaleString('ru-RU')} (cost ${i.costPrice.toLocaleString('ru-RU')})`,
    })),
    truncated: Number(lossCount[0].n) > TAKE,
  });

  // ─── 3. Продажи без себестоимости (товар без закупки) ────────────────
  const zeroCostItems = await prisma.$queryRaw<Array<{
    id: string; date: Date; number: string; nomenclatureName: string | null;
    quantity: number; amount: number; kontragentName: string | null;
  }>>`
    SELECT ri.id, r.date, r.number, ri."nomenclatureName", ri.quantity, ri.amount,
           r."kontragentName"
    FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE ri."costPrice" = 0 AND ri.amount > 0 AND ri.quantity > 0 AND r.posted = true
    ORDER BY r.date DESC, ri.amount DESC
    LIMIT ${TAKE}
  `;
  const zeroCostCount = await prisma.$queryRaw<Array<{ n: bigint; total: number | null }>>`
    SELECT COUNT(*) AS n, SUM(ri.amount)::float AS total
    FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE ri."costPrice" = 0 AND ri.amount > 0 AND ri.quantity > 0 AND r.posted = true
  `;
  cats.push({
    key: 'zeroCostSales',
    title: 'Продажи без себестоимости',
    description: 'Товар продан, но в БД нет ни одной закупки этой номенклатуры — costPrice=0. Завышает валовую прибыль. Причины: услуги, старые остатки, не подтянулись закупки за пределами окна синка.',
    severity: 'high',
    count: Number(zeroCostCount[0].n),
    totalAmount: zeroCostCount[0].total || 0,
    docs: zeroCostItems.map((i) => ({
      id: i.id,
      date: i.date,
      number: i.number,
      amount: i.amount,
      detail: `${i.nomenclatureName || '—'} · ${i.kontragentName || '—'} · qty ${i.quantity}`,
    })),
    truncated: Number(zeroCostCount[0].n) > TAKE,
  });

  // ─── 4. Активные ДДС-статьи без opiuCategory ─────────────────────────
  const unmappedActive = await prisma.$queryRaw<Array<{
    id: string; name: string; turnover: number; ndocs: bigint;
  }>>`
    SELECT a.id, a.name,
           COALESCE(SUM(d.amount), 0)::float AS turnover,
           COUNT(d.id) AS ndocs
    FROM "DdsArticle" a
    JOIN "DdsDocument" d ON d."articleId" = a.id
    WHERE a."opiuCategory" IS NULL AND a."isFolder" = false
    GROUP BY a.id, a.name
    HAVING COUNT(d.id) > 0
    ORDER BY turnover DESC
    LIMIT ${TAKE}
  `;
  cats.push({
    key: 'unmappedArticles',
    title: 'Статьи ДДС без категории ОПиУ',
    description: 'Эти статьи активны (есть документы), но не привязаны к разделу ОПиУ → их расходы НЕ попадают в P&L. Откройте «Настройки → Маппинг» и проставьте категорию.',
    severity: unmappedActive.length > 0 ? 'high' : 'low',
    count: unmappedActive.length,
    totalAmount: unmappedActive.reduce((s, u) => s + u.turnover, 0),
    docs: unmappedActive.map((u) => ({
      id: u.id,
      number: u.name,
      amount: u.turnover,
      detail: `${Number(u.ndocs)} документ(ов)`,
      link: '/settings/mapping',
    })),
    truncated: false,
  });

  // ─── 4b. Подозрительный маппинг статей ───────────────────────────────
  // Эвристики по ключевым словам в названии: если категория не соответствует
  // явным паттернам, помечаем. Это НЕ автомат — пользователь сам решит.
  type SuspiciousRule = {
    pattern: RegExp;
    wrongCats: string[]; // если статья сейчас в этой категории — подозрительно
    expectedCat: string;
    reason: string;
  };
  const RULES: SuspiciousRule[] = [
    {
      pattern: /комисс\w*\s+(банк|эквайринг)|эквайринг|банковск\w*\s+комисс/i,
      wrongCats: ['interest'],
      expectedCat: 'admin',
      reason: 'Банковские комиссии и эквайринг — это операционные расходы, а не проценты по кредитам',
    },
    {
      pattern: /положительн\w*\s+курсов\w*|курсов\w*.*разница.*(положит|доход)/i,
      wrongCats: ['other_expense'],
      expectedCat: 'other_income',
      reason: 'Положительная курсовая разница — это доход, не расход',
    },
    {
      pattern: /^займ\w*$|получ\w*\s+займ|получ\w*\s+кредит/i,
      wrongCats: ['interest', 'other_income', 'other_expense'],
      expectedCat: 'financing_in',
      reason: 'Получение займа/кредита — это финансирующее поступление, не процентный доход',
    },
    {
      pattern: /возврат\s+займ|погашен\w*\s+(займ|кредит)|выплат\w*\s+(займ|кредит)/i,
      wrongCats: ['interest', 'other_expense', 'admin'],
      expectedCat: 'financing_out',
      reason: 'Возврат тела займа — финансирующая выплата, не процентный расход',
    },
    {
      pattern: /дивиденд/i,
      wrongCats: ['other_expense', 'admin', 'payroll'],
      expectedCat: 'financing_out',
      reason: 'Дивиденды — финансирующая выплата, не операционный расход',
    },
    {
      pattern: /начальн\w*\s+остатк|ввод\w*\s+остатк/i,
      wrongCats: ['admin', 'other_expense', 'other_income', 'revenue', 'cogs'],
      expectedCat: 'null',
      reason: 'Ввод начальных остатков — техническая проводка, не должна попадать в P&L',
    },
    {
      pattern: /^прочее$|^прочие\s+расход|остатк\w*.*списан|списан\w*.*остатк/i,
      wrongCats: ['other_expense', 'admin'],
      expectedCat: 'null',
      reason: 'Статья «Прочее»/«Списание остатков» часто содержит технические проводки на огромные суммы — лучше не учитывать в P&L',
    },
  ];
  const allMapped = await prisma.$queryRaw<Array<{
    id: string; name: string; opiuCategory: string; turnover: number; ndocs: bigint;
  }>>`
    SELECT a.id, a.name, a."opiuCategory",
           COALESCE(SUM(d.amount), 0)::float AS turnover,
           COUNT(d.id) AS ndocs
    FROM "DdsArticle" a
    LEFT JOIN "DdsDocument" d ON d."articleId" = a.id
    WHERE a."opiuCategory" IS NOT NULL AND a."isFolder" = false
    GROUP BY a.id, a.name, a."opiuCategory"
  `;
  const suspicious: AnomalyDoc[] = [];
  for (const a of allMapped) {
    for (const rule of RULES) {
      if (rule.pattern.test(a.name) && rule.wrongCats.includes(a.opiuCategory)) {
        suspicious.push({
          id: a.id,
          number: a.name,
          amount: a.turnover,
          detail: `сейчас: ${a.opiuCategory} · надо: ${rule.expectedCat} · ${Number(a.ndocs)} док. · ${rule.reason}`,
          link: '/settings/mapping',
        });
        break;
      }
    }
  }
  suspicious.sort((a, b) => (b.amount || 0) - (a.amount || 0));
  cats.push({
    key: 'suspiciousMapping',
    title: 'Подозрительный маппинг статей',
    description:
      'Эвристика по ключевым словам в названии статьи. Например, «Комиссия Эквайринг» в категории «interest» — скорее ошибка: эквайринг не процентный расход, а операционная комиссия. Откройте /settings/mapping и проверьте предложенные категории. Это лишь подсказка — финальное решение за вами.',
    severity: suspicious.length > 0 ? 'medium' : 'low',
    count: suspicious.length,
    totalAmount: suspicious.reduce((s, d) => s + (d.amount || 0), 0),
    docs: suspicious.slice(0, TAKE),
    truncated: suspicious.length > TAKE,
  });

  // ─── 5. ДДС без привязки к статье ────────────────────────────────────
  const noArticle = await prisma.ddsDocument.findMany({
    where: { articleId: null, docType: { not: 'PeremeschenieDC' } },
    orderBy: { date: 'desc' },
    take: TAKE,
    select: { id: true, date: true, number: true, amount: true, kontragentName: true, docType: true, comment: true, paymentPurpose: true },
  });
  const noArticleCount = await prisma.ddsDocument.count({
    where: { articleId: null, docType: { not: 'PeremeschenieDC' } },
  });
  cats.push({
    key: 'ddsWithoutArticle',
    title: 'ДДС без статьи',
    description: 'Платёжки без указанной статьи ДДС. В 1С менеджер забыл выбрать статью → расход не попадает в ОПиУ. Проверьте назначение платежа в детали.',
    severity: noArticleCount > 0 ? 'medium' : 'low',
    count: noArticleCount,
    totalAmount: noArticle.reduce((s, d) => s + d.amount, 0),
    docs: noArticle.map((d) => ({
      id: d.id,
      date: d.date,
      number: d.number,
      amount: d.amount,
      detail: `${d.docType} · ${d.kontragentName || '—'}${d.paymentPurpose ? ' · ' + d.paymentPurpose.slice(0, 80) : ''}`,
    })),
    truncated: noArticleCount > TAKE,
  });

  // ─── 6. Реализации без контрагента ───────────────────────────────────
  const noKontr = await prisma.realizacia.findMany({
    where: { kontragentId: null, posted: true, totalAmount: { gt: 0 } },
    orderBy: { date: 'desc' },
    take: TAKE,
    select: { id: true, date: true, number: true, totalAmount: true },
  });
  const noKontrCount = await prisma.realizacia.count({
    where: { kontragentId: null, posted: true, totalAmount: { gt: 0 } },
  });
  cats.push({
    key: 'salesWithoutKontragent',
    title: 'Реализации без контрагента',
    description: 'Продажа без указанного покупателя. Не критично для финансов, но мешает аналитике по клиентам.',
    severity: 'low',
    count: noKontrCount,
    totalAmount: noKontr.reduce((s, r) => s + r.totalAmount, 0),
    docs: noKontr.map((r) => ({ id: r.id, date: r.date, number: r.number, amount: r.totalAmount })),
    truncated: noKontrCount > TAKE,
  });

  // ─── 7. Заказы покупателей без статуса ───────────────────────────────
  const ordersNoStatus = await prisma.orderBuyer.findMany({
    where: { status: null, posted: true },
    orderBy: { date: 'desc' },
    take: TAKE,
    select: { id: true, date: true, number: true, totalAmount: true, kontragentName: true },
  });
  const ordersNoStatusCount = await prisma.orderBuyer.count({
    where: { status: null, posted: true },
  });
  cats.push({
    key: 'ordersWithoutStatus',
    title: 'Заказы без статуса',
    description: 'Заказы покупателей не имеют поля «Статус». В РНП такие отображаются по ВидОперации, но это менее точно. Проверьте, что в 1С статусы заполняются.',
    severity: 'low',
    count: ordersNoStatusCount,
    totalAmount: ordersNoStatus.reduce((s, o) => s + o.totalAmount, 0),
    docs: ordersNoStatus.map((o) => ({
      id: o.id, date: o.date, number: o.number, amount: o.totalAmount,
      detail: o.kontragentName || '',
    })),
    truncated: ordersNoStatusCount > TAKE,
  });

  // ─── 8. Дубли номеров (внутри одной таблицы — потенциальные ошибки ввода) ─
  const dupRealiz = await prisma.$queryRaw<Array<{ number: string; n: bigint; ids: string[] }>>`
    SELECT number, COUNT(*) AS n, ARRAY_AGG(id) AS ids
    FROM "Realizacia" WHERE number != '' AND posted = true
    GROUP BY number HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT ${TAKE}
  `;
  const dupZakup = await prisma.$queryRaw<Array<{ number: string; n: bigint; ids: string[] }>>`
    SELECT number, COUNT(*) AS n, ARRAY_AGG(id) AS ids
    FROM "Zakupka" WHERE number != '' AND posted = true
    GROUP BY number HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT ${TAKE}
  `;
  const dupDocs: AnomalyDoc[] = [
    ...dupRealiz.map((d) => ({ id: d.ids.join(','), number: d.number, detail: `Реализация · ${Number(d.n)} документов с одинаковым номером` })),
    ...dupZakup.map((d) => ({ id: d.ids.join(','), number: d.number, detail: `Закупка · ${Number(d.n)} документов с одинаковым номером` })),
  ];
  cats.push({
    key: 'duplicateNumbers',
    title: 'Дубликаты номеров',
    description: 'Несколько проведённых документов имеют одинаковый номер. В 1С нумерация должна быть уникальной — это ручной ввод или сбой нумератора.',
    severity: dupDocs.length > 0 ? 'medium' : 'low',
    count: dupDocs.length,
    docs: dupDocs.slice(0, TAKE),
    truncated: dupDocs.length > TAKE,
  });

  const totalIssues = cats.reduce((s, c) => s + c.count, 0);
  return { generatedAt: now, totalIssues, categories: cats };
}
