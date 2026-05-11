import { NextRequest, NextResponse } from 'next/server';
import { runFullSync } from '@/lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const daysBack = url.searchParams.get('days') ? Number(url.searchParams.get('days')) : undefined;
  const skipCatalogs = url.searchParams.get('skipCatalogs') === '1';

  const r = await runFullSync({ daysBack, skipCatalogs });

  // Если запрос пришёл из формы (HTML) — редиректим обратно на дашборд
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/?synced=' + (r.ok ? '1' : '0'), req.url), 303);
  }
  return NextResponse.json(r);
}

export async function GET(req: NextRequest) {
  // Удобно для ручного теста через браузер
  return POST(req);
}
