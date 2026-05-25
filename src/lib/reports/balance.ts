// Управленческий баланс на дату: активы / пассивы / капитал.
//
// Активы:
//   - Деньги:           OpeningBalance(kind='cash') + изменения по DdsDocument до даты
//   - Запасы (товары):  InventoryBalance.quantity * последняя цена закупки
//   - Дебиторка:        непогашенные реализации − платежи от клиентов (FIFO) + opening('ar')
//   - Авансы выданные:  переплата поставщикам (мы заплатили, но товар не пришёл)
//   - Основные средства: FixedAsset.cost − накопленная амортизация на дату
//
// Пассивы:
//   - Кредиторка:        непогашенные закупки − платежи поставщикам (FIFO) + opening('ap')
//   - Авансы полученные: переплата от клиентов (получили деньги, но не отгрузили)
//
// Капитал = Активы − Пассивы. Это «то что осталось бы, если завтра все долги».

import { prisma } from '@/lib/db';
import { buildCostPriceMap } from '@/lib/sync/zakupki';
import { loadFixedAssetsFromSheet } from '@/lib/sync/fixed-assets-sheet';
import { buildReceivables } from './receivables';
import { buildPayables } from './payables';
import { buildCashPositions } from './cash-balances';

export interface BalanceCashPosition {
  id: string;
  name: string;
  type: 'kassa' | 'bank';
  balance: number;
}

export interface BalanceWarehouseRow {
  name: string;
  positions: number;
  quantity: number;
  costAmount: number;
}

export interface BalanceFixedAssetRow {
  id: string;
  name: string;
  cost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  startDate: string;
  usefulMonths: number;
  type?: string;
  location?: string;
  invNum?: string;
  responsible?: string;
  source: 'sheet' | 'manual';
}

export interface BalanceFixedAssetSummary {
  type: string;
  count: number;
  cost: number;
  netBookValue: number;
}

export interface BalanceReport {
  asOf: string;            // ISO
  assets: {
    cash: number;
    inventory: number;
    receivables: number;
    prepaymentsOut: number;   // авансы выданные поставщикам
    fixedAssets: number;
    total: number;
  };
  liabilities: {
    payables: number;
    prepaymentsIn: number;    // авансы полученные от клиентов
    total: number;
  };
  equity: number;
  // Детализация
  cashPositions: BalanceCashPosition[];
  warehouses: BalanceWarehouseRow[];
  fixedAssetsList: BalanceFixedAssetRow[];
  fixedAssetsByType: BalanceFixedAssetSummary[];
  fixedAssetsSource: 'sheet' | 'manual' | 'empty';
  topDebtors: { name: string; debt: number; oldestDays: number }[];
  topCreditors: { name: string; debt: number; oldestDays: number }[];
}

export async function buildBalance(opts: { asOf?: Date } = {}): Promise<BalanceReport> {
  const asOf = opts.asOf || new Date();

  // Основные средства тянем из Google-таблицы финансиста (помесячная NBV).
  // Если интеграция не настроена или вернула пусто — fallback на ручной список
  // prisma.fixedAsset (вводимый в /settings/fixed-assets).
  const sheetFaPromise = loadFixedAssetsFromSheet(asOf).catch((e) => {
    console.warn('[balance] FA sheet load failed:', e?.message || e);
    return [];
  });

  const [cashPositions, inventory, costMap, sheetFa, manualFa, receivables, payables] = await Promise.all([
    buildCashPositions(asOf),
    prisma.inventoryBalance.findMany({
      select: { warehouseId: true, warehouseName: true, nomenclatureId: true, quantity: true },
    }),
    buildCostPriceMap(),
    sheetFaPromise,
    prisma.fixedAsset.findMany({ orderBy: { startDate: 'desc' } }),
    buildReceivables({ asOf, minDebt: 1 }),
    buildPayables({ asOf, minDebt: 1 }),
  ]);

  // ── Cash ──
  const cashTotal = cashPositions.reduce((s, p) => s + p.balance, 0);

  // ── Inventory ──
  const wMap = new Map<string, BalanceWarehouseRow>();
  let inventoryTotal = 0;
  for (const r of inventory) {
    const wn = r.warehouseName || '—';
    let w = wMap.get(wn);
    if (!w) { w = { name: wn, positions: 0, quantity: 0, costAmount: 0 }; wMap.set(wn, w); }
    w.positions += 1;
    w.quantity += r.quantity;
    const cp = costMap.get(r.nomenclatureId) || 0;
    const cost = r.quantity * cp;
    w.costAmount += cost;
    inventoryTotal += cost;
  }
  const warehouses = Array.from(wMap.values()).sort((a, b) => b.costAmount - a.costAmount);

  // ── Fixed assets ──
  // Источник 1 (приоритет): Google-таблица «Ведомость по ОС» — финансист
  // ведёт её вручную, помесячная NBV уже посчитана.
  // Источник 2 (fallback): prisma.fixedAsset — старый ручной список.
  let faTotal = 0;
  let fixedAssetsList: BalanceFixedAssetRow[];
  let fixedAssetsSource: 'sheet' | 'manual' | 'empty';

  if (sheetFa.length > 0) {
    fixedAssetsList = sheetFa.map((fa, i) => ({
      id: `sheet:${fa.rowIndex}`,
      name: fa.name,
      cost: fa.cost,
      accumulatedDepreciation: fa.accumulatedDepreciation,
      netBookValue: fa.netBookValue,
      startDate: (fa.startDate || fa.purchaseDate || asOf.toISOString().slice(0, 10)) + 'T00:00:00.000Z',
      usefulMonths: fa.usefulMonths,
      type: fa.type,
      location: fa.location,
      invNum: fa.invNum,
      responsible: fa.responsible,
      source: 'sheet' as const,
    }));
    faTotal = fixedAssetsList.reduce((s, fa) => s + fa.netBookValue, 0);
    fixedAssetsSource = 'sheet';
  } else if (manualFa.length > 0) {
    // Линейная амортизация: cost / usefulMonths за каждый прошедший месяц от startDate.
    fixedAssetsList = manualFa.map((fa) => {
      const start = fa.startDate;
      const monthsElapsed = Math.max(0,
        (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()),
      );
      const months = Math.min(monthsElapsed, fa.usefulMonths);
      const perMonth = fa.usefulMonths > 0 ? fa.cost / fa.usefulMonths : 0;
      const accum = perMonth * months;
      const nbv = Math.max(0, fa.cost - accum);
      faTotal += nbv;
      return {
        id: fa.id,
        name: fa.name,
        cost: fa.cost,
        accumulatedDepreciation: accum,
        netBookValue: nbv,
        startDate: fa.startDate.toISOString(),
        usefulMonths: fa.usefulMonths,
        source: 'manual' as const,
      };
    });
    fixedAssetsSource = 'manual';
  } else {
    fixedAssetsList = [];
    fixedAssetsSource = 'empty';
  }

  // Сводка по типам ОС (Оргтехника / Мебель / Транспорт / …).
  const typeMap = new Map<string, BalanceFixedAssetSummary>();
  for (const fa of fixedAssetsList) {
    const t = fa.type || 'Без типа';
    let row = typeMap.get(t);
    if (!row) { row = { type: t, count: 0, cost: 0, netBookValue: 0 }; typeMap.set(t, row); }
    row.count += 1;
    row.cost += fa.cost;
    row.netBookValue += fa.netBookValue;
  }
  const fixedAssetsByType = Array.from(typeMap.values()).sort((a, b) => b.netBookValue - a.netBookValue);

  // ── Receivables & payables ──
  const receivablesTotal = receivables.totals.debt;
  const prepaymentsIn = receivables.totals.prepayments; // авансы от клиентов (мы должны отгрузить)
  const payablesTotal = payables.totals.debt;
  const prepaymentsOut = payables.totals.prepayments;   // авансы поставщикам (нам должны отгрузить)

  const topDebtors = receivables.rows
    .filter((r) => r.totalDebt > 0)
    .slice(0, 15)
    .map((r) => ({ name: r.kontragentName, debt: r.totalDebt, oldestDays: r.oldestDays }));
  const topCreditors = payables.rows
    .filter((r) => r.totalDebt > 0)
    .slice(0, 15)
    .map((r) => ({ name: r.kontragentName, debt: r.totalDebt, oldestDays: r.oldestDays }));

  const assetsTotal = cashTotal + inventoryTotal + receivablesTotal + prepaymentsOut + faTotal;
  const liabilitiesTotal = payablesTotal + prepaymentsIn;
  const equity = assetsTotal - liabilitiesTotal;

  return {
    asOf: asOf.toISOString(),
    assets: {
      cash: cashTotal,
      inventory: inventoryTotal,
      receivables: receivablesTotal,
      prepaymentsOut,
      fixedAssets: faTotal,
      total: assetsTotal,
    },
    liabilities: {
      payables: payablesTotal,
      prepaymentsIn,
      total: liabilitiesTotal,
    },
    equity,
    cashPositions,
    warehouses,
    fixedAssetsList,
    fixedAssetsByType,
    fixedAssetsSource,
    topDebtors,
    topCreditors,
  };
}
