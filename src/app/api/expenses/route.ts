import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { buildExpenses, drillExpenseCategory } from '@/lib/reports/expenses';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? startOfDay(parseISO(sp.get('from')!)) : startOfMonth(new Date());
    const to = sp.get('to') ? endOfDay(parseISO(sp.get('to')!)) : endOfMonth(new Date());
    const drill = sp.get('drill');
    if (drill) {
      const articleName = sp.get('article') || undefined;
      const docs = await drillExpenseCategory(drill, from, to, articleName);
      return NextResponse.json({ drill, article: articleName, docs });
    }
    const report = await buildExpenses({ from, to });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
